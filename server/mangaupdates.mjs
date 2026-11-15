// MangaUpdates (API pública v1, https://api.mangaupdates.com): SOLO catálogo y metadatos.
// MangaUpdates no aloja capítulos; la app muestra la ficha y un enlace a la obra en su sitio.
// La API no envía CORS ("pensada para usarse desde un backend", según su equipo), por eso el
// navegador la consulta a través de estas rutas, con lista blanca, ritmo de 1 petición/s, caché,
// unión de pedidos iguales y pausa ante 429. Sin cuenta ni credenciales.
import { safeRequest, readLimited } from './security.mjs';
import { UA, pacer, ttlCache } from './mangadex.mjs';

const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const ID = /^\d{1,20}$/;

/** Producción: siempre la API oficial. MU_API_BASE / MU_IMG_HOST solo con ALLOW_PRIVATE (pruebas). */
export function muConfig(env = process.env, { allowPrivate = false } = {}) {
  const test = !!(allowPrivate && env.MU_API_BASE);
  return { test, api: test ? env.MU_API_BASE.replace(/\/+$/, '') : 'https://api.mangaupdates.com', imgHost: (test && env.MU_IMG_HOST) || 'cdn.mangaupdates.com' };
}

/** ¿Es una portada de MangaUpdates? HTTPS (o el host de prueba), sin credenciales, host fijo. */
export function coverUrlOk(raw, cfg) {
  let u; try { u = new URL(raw); } catch { return false; }
  if (u.username || u.password || u.hash) return false;
  if (cfg.test && u.host === cfg.imgHost && /^https?:$/.test(u.protocol)) return true;
  return u.protocol === 'https:' && !u.port && u.hostname === 'cdn.mangaupdates.com' && /^\/image\/[A-Za-z0-9/_.-]{1,200}$/.test(u.pathname);
}

/** Cuerpo de búsqueda permitido: texto, página y tamaño de página. */
export function searchBody(params) {
  const q = String(params.get('q') || '').slice(0, 200);
  const page = Math.max(1, Math.min(200, parseInt(params.get('page'), 10) || 1));
  const perpage = Math.max(1, Math.min(50, parseInt(params.get('perpage'), 10) || 24));
  if (!q.trim()) throw err(400, 'MangaUpdates necesita un texto de búsqueda');
  return { search: q, page, perpage };
}

export function createMangaupdates({ cfg = muConfig(), request = safeRequest, allowPrivate = false, timeoutMs = 20000, log = () => {} } = {}) {
  const gate = pacer({ perSec: 1, concurrency: 2, maxQueue: 30 });
  const cache = ttlCache(300, 16 * 1024 * 1024, (v) => v.n || 0), covers = ttlCache(200, 16 * 1024 * 1024, (v) => v.buf.length);
  const inflight = new Map();
  const stats = { upstream: 0, cacheHits: 0, coalesced: 0, limited: 0, coolUntil: 0 };
  const once = (key, fn) => { if (inflight.has(key)) { stats.coalesced++; return inflight.get(key); } const p = fn().finally(() => inflight.delete(key)); inflight.set(key, p); return p; };
  const cooling = () => { const s = Math.ceil((stats.coolUntil - Date.now()) / 1000); if (s > 0) throw err(429, `MangaUpdates pidió esperar. Reintentá en ${s} s.`, { retryAfter: s, upstream: true }); };

  async function call(method, path, body, ttl) {
    const key = method + path + (body ? JSON.stringify(body) : '');
    const hit = cache.get(key);
    if (hit) { stats.cacheHits++; return hit.j; }
    return once(key, () => gate(async () => {
      cooling();
      stats.upstream++;
      const data = body ? JSON.stringify(body) : undefined;
      const r = await request(`${cfg.api}${path}`, { method, timeoutMs, allowPrivate, body: data, headers: { 'user-agent': UA, accept: 'application/json', ...(data ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)) } : {}) } });
      if (r.status >= 300 && r.status < 400) { r.body.resume?.(); throw err(502, 'MangaUpdates respondió con una redirección inesperada (no se sigue)'); }
      const buf = await readLimited({ headers: { get: r.get }, body: r.body }, 4 * 1024 * 1024);
      if (r.status === 429) { const ra = +r.get('retry-after') || 60; stats.coolUntil = Date.now() + Math.min(ra, 900) * 1000; stats.limited++; throw err(429, 'MangaUpdates limitó las peticiones (429).', { retryAfter: Math.min(ra, 900), upstream: true }); }
      let j; try { j = JSON.parse(buf.toString('utf8')); } catch { throw err(r.status >= 400 ? r.status : 502, `MangaUpdates respondió HTTP ${r.status} sin JSON`, { upstream: true }); }
      if (r.status >= 400) throw err(r.status, `MangaUpdates HTTP ${r.status}: ${String(j?.reason || '').slice(0, 200)}`, { upstream: true });
      cache.set(key, { j, n: buf.length }, ttl);
      return j;
    }));
  }

  async function cover(url) {
    const hit = covers.get(url);
    if (hit) { stats.cacheHits++; return hit; }
    return once('c:' + url, () => gate(async () => {
      const r = await request(url, { timeoutMs, allowPrivate, headers: { 'user-agent': UA, accept: 'image/*' } });
      if (r.status >= 300 && r.status < 400) { r.body.resume?.(); throw err(502, 'Redirección no permitida en la portada'); }
      if (r.status >= 400) { r.body.resume?.(); throw err(r.status, `Portada HTTP ${r.status}`, { upstream: true }); }
      const ct = String(r.get('content-type') || '');
      if (!/^image\//i.test(ct)) { r.body.resume?.(); throw err(502, 'La portada no es una imagen'); }
      const v = { buf: await readLimited({ headers: { get: r.get }, body: r.body }, 4 * 1024 * 1024), ct };
      covers.set(url, v, 6 * 3600e3);
      return v;
    }));
  }

  async function handle(req, u, res, cors, send) {
    const route = u.pathname.replace(/^.*\/mangaupdates\//, '');
    const json = (code, obj, extra = {}) => send(res, code, { ...cors, 'content-type': 'application/json; charset=utf-8', ...extra }, JSON.stringify(obj));
    try {
      if (route === 'search') return json(200, await call('POST', '/v1/series/search', searchBody(u.searchParams), 10 * 60e3), { 'cache-control': 'private, max-age=60' });
      if (route === 'series') {
        const id = u.searchParams.get('id') || '';
        if (!ID.test(id)) throw err(400, 'Identificador de MangaUpdates inválido');
        return json(200, await call('GET', `/v1/series/${id}`, null, 60 * 60e3), { 'cache-control': 'private, max-age=300' });
      }
      if (route === 'cover') {
        const url = u.searchParams.get('url') || '';
        if (!coverUrlOk(url, cfg)) throw err(400, 'Portada no permitida: solo cdn.mangaupdates.com por HTTPS', { kind: 'policy' });
        const { buf, ct } = await cover(url);
        return send(res, 200, { ...cors, 'content-type': ct, 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" }, buf);
      }
      if (route === 'status') return json(200, { ok: true, cooling: Math.max(0, Math.ceil((stats.coolUntil - Date.now()) / 1000)), ...stats, cache: cache.size, cacheBytes: cache.bytes, covers: covers.size }, { 'cache-control': 'no-store' });
      throw err(404, 'Ruta de MangaUpdates desconocida');
    } catch (e) {
      const code = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : e.name === 'TimeoutError' ? 504 : 502;
      if (code >= 500) log('mangaupdates', route, code, e.message);
      const extra = { 'cache-control': 'no-store', ...(e.upstream ? { 'x-upstream': 'mangaupdates' } : { 'x-manhuua-error': '1' }), ...(e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {}) };
      return json(code, { error: e.message, kind: e.kind || (code === 429 ? 'limited' : undefined), retryAfter: e.retryAfter }, extra);
    }
  }
  return { handle, stats };
}
