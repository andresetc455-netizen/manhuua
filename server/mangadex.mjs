// MangaDex nativo (API oficial). MangaDex no envía CORS, no permite hotlinking y exige un User-Agent
// real: el backend hace de proxy SOLO hacia MangaDex, con rutas y parámetros en lista blanca, ritmo
// limitado (~4 peticiones/s, at-home ≤ 38/min), caché, unión de peticiones iguales en curso, pausa
// al recibir 429 y validación estricta de los servidores MangaDex@Home antes de pedir una imagen.
// Documentación: docs/MANGADEX.md. Reglas oficiales: https://api.mangadex.org/docs/
import { safeRequest, readLimited, parseHostPolicy, hostAllowed, rateLimiter } from './security.mjs';

export const UA = 'Manhuua/1.0 (lector personal; +https://manhuua.pages.dev)';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,150}(\.[A-Za-z0-9_-]{1,20})*\.(?:jpe?g|png|gif|webp)$/i;
const HASH = /^[0-9a-f]{32,64}$/i;
const LANG = /^[a-z]{2,3}(-[a-z]{2,4})?$/;
const QUALITY = ['data', 'data-saver'];
const SIZES = { 256: '.256.jpg', 512: '.512.jpg', orig: '' };

const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const num = (v, d) => (v != null && v !== '' && !Number.isNaN(+v) ? +v : d);

// ---------------- configuración ----------------
/**
 * Producción: siempre los dominios oficiales. Los reemplazos (MD_API_BASE, MD_UPLOADS_BASE,
 * MD_REPORT_URL, MD_TEST_HOSTS) existen solo para las pruebas automáticas con un MangaDex simulado y
 * se IGNORAN salvo que el backend permita IPs privadas (ALLOW_PRIVATE=true, nunca en Render).
 */
export function mdConfig(env = process.env, { allowPrivate = false } = {}) {
  const test = !!(allowPrivate && env.MD_API_BASE);
  return {
    test,
    api: test ? env.MD_API_BASE.replace(/\/+$/, '') : 'https://api.mangadex.org',
    uploads: (test && env.MD_UPLOADS_BASE?.replace(/\/+$/, '')) || 'https://uploads.mangadex.org',
    report: (test && env.MD_REPORT_URL) || 'https://api.mangadex.network/report',
    testHosts: test ? parseHostPolicy(env.MD_TEST_HOSTS || '') : [],
    perSec: Math.min(5, Math.max(0.5, num(env.MD_PER_SEC, 4))),
    atHomePerMin: Math.min(40, Math.max(1, num(env.MD_ATHOME_PER_MIN, 38))),
  };
}

/** ¿Es un servidor MangaDex@Home legítimo? HTTPS, puerto estándar, sin credenciales y dominio oficial. */
export function atHomeHostOk(raw, cfg = { testHosts: [] }) {
  let u; try { u = new URL(raw); } catch { return false; }
  if (u.username || u.password || u.search || u.hash) return false;
  if (cfg.testHosts?.length && hostAllowed(u.href, cfg.testHosts) && /^https?:$/.test(u.protocol)) return true;
  if (u.protocol !== 'https:' || u.port) return false;
  const h = u.hostname.toLowerCase();
  return h === 'uploads.mangadex.org' || (h.endsWith('.mangadex.network') && /^[a-z0-9.-]+$/.test(h) && !h.includes('..'));
}

/** Valida la respuesta de /at-home/server/{id}. Devuelve {baseUrl, hash, data, dataSaver} o lanza 502. */
export function validateAtHome(j, cfg) {
  const bad = (why) => err(502, `Respuesta de MangaDex@Home rechazada: ${why}`, { kind: 'policy' });
  if (!j || j.result !== 'ok') throw bad('resultado no válido');
  const baseUrl = String(j.baseUrl || '').replace(/\/+$/, '');
  if (!atHomeHostOk(baseUrl, cfg)) { let h = ''; try { h = new URL(baseUrl).host; } catch {} throw err(502, `Servidor de imágenes no autorizado (${h || 'URL inválida'}): solo uploads.mangadex.org o *.mangadex.network por HTTPS.`, { kind: 'policy', blocked: { url: baseUrl, reason: 'host' } }); }
  const c = j.chapter || {};
  if (!HASH.test(String(c.hash || ''))) throw bad('hash del capítulo inválido');
  const list = (a) => (Array.isArray(a) ? a.slice(0, 1000) : []);
  const data = list(c.data), dataSaver = list(c.dataSaver);
  if ([...data, ...dataSaver].some((f) => typeof f !== 'string' || !FILE.test(f))) throw bad('nombre de archivo inválido');
  return { baseUrl, hash: c.hash, data, dataSaver };
}

// ---------------- parámetros permitidos ----------------
const one = (re) => (v) => re.test(v);
const oneOf = (...l) => (v) => l.includes(v);
const VALID = {
  title: (v) => v.length <= 200, name: (v) => v.length <= 100,
  limit: one(/^\d{1,3}$/), offset: one(/^\d{1,5}$/),
  'includes[]': oneOf('cover_art', 'author', 'artist', 'scanlation_group'),
  'contentRating[]': oneOf('safe', 'suggestive', 'erotica', 'pornographic'),
  'status[]': oneOf('ongoing', 'completed', 'hiatus', 'cancelled'),
  'publicationDemographic[]': oneOf('shounen', 'shoujo', 'josei', 'seinen', 'none'),
  'includedTags[]': one(UUID), 'excludedTags[]': one(UUID), 'ids[]': one(UUID), 'authors[]': one(UUID), 'artists[]': one(UUID), authorOrArtist: one(UUID),
  includedTagsMode: oneOf('AND', 'OR'), excludedTagsMode: oneOf('AND', 'OR'),
  'availableTranslatedLanguage[]': one(LANG), 'translatedLanguage[]': one(LANG), 'originalLanguage[]': one(LANG),
  hasAvailableChapters: oneOf('true', 'false', '1', '0'),
  includeExternalUrl: oneOf('0', '1'), includeEmptyPages: oneOf('0', '1'), includeFuturePublishAt: oneOf('0', '1'), includeFutureUpdates: oneOf('0', '1'),
};
for (const k of ['title', 'year', 'createdAt', 'updatedAt', 'latestUploadedChapter', 'followedCount', 'relevance', 'volume', 'chapter', 'publishAt', 'readableAt']) VALID[`order[${k}]`] = oneOf('asc', 'desc');
const ROUTES = [
  [/^\/manga$/, 'list', 100], [new RegExp(`^/manga/${UUID.source.slice(1, -1)}$`, 'i'), 'manga', 0],
  [new RegExp(`^/manga/${UUID.source.slice(1, -1)}/feed$`, 'i'), 'feed', 500], [/^\/manga\/tag$/, 'tag', 0], [/^\/author$/, 'author', 20],
];

/**
 * Ruta y parámetros de una consulta a la API: solo lo de la lista blanca. Nunca se pide contenido
 * "pornographic"; sin clasificación explícita se usa safe + suggestive. Devuelve {path, kind, qs}.
 */
export function sanitizeApi(path, params) {
  const r = ROUTES.find(([re]) => re.test(path));
  if (!r) throw err(400, 'Ruta de MangaDex no permitida');
  const [, kind, maxLimit] = r;
  const out = new URLSearchParams();
  let n = 0;
  for (const [k, v] of params) {
    if (k === 'path') continue;
    if (++n > 60) throw err(400, 'Demasiados parámetros');
    if (!VALID[k] || !VALID[k](v)) throw err(400, `Parámetro no permitido: ${k.slice(0, 40)}`);
    if (k === 'contentRating[]' && v === 'pornographic') continue;
    out.append(k, v);
  }
  if (['list', 'feed'].includes(kind) && !out.has('contentRating[]')) { out.append('contentRating[]', 'safe'); out.append('contentRating[]', 'suggestive'); }
  if (maxLimit) {
    const limit = Math.min(+(out.get('limit') || 10), maxLimit), offset = +(out.get('offset') || 0);
    if (limit < 1) throw err(400, 'limit inválido');
    if (offset + limit > 10000) throw err(400, 'MangaDex no permite paginar más allá de 10.000 resultados');
    out.set('limit', String(limit));
  }
  return { path, kind, qs: out.toString() };
}

// ---------------- ritmo, caché y uniones ----------------
/** Cola con ritmo (peticiones/s) y concurrencia máximos. Cola llena → 503. */
export function pacer({ perSec, concurrency, maxQueue }) {
  let active = 0, last = 0, timer = null; const q = [];
  const pump = () => {
    while (q.length && active < concurrency) {
      const wait = last + 1000 / perSec - Date.now();
      if (wait > 0) { if (!timer) timer = setTimeout(() => { timer = null; pump(); }, wait); return; }
      last = Date.now(); active++;
      const { fn, res, rej } = q.shift();
      Promise.resolve().then(fn).then(res, rej).finally(() => { active--; pump(); });
    }
  };
  return (fn) => {
    if (q.length >= maxQueue) return Promise.reject(err(503, 'MangaDex: demasiadas peticiones en espera, probá en unos segundos', { retryAfter: 5 }));
    return new Promise((res, rej) => { q.push({ fn, res, rej }); pump(); });
  };
}
/** Caché con vencimiento, máximo de entradas y (opcional) de bytes en total (portadas). */
function ttlCache(max, maxBytes = Infinity, sizeOf = () => 0) {
  const m = new Map(); let bytes = 0;
  const drop = (k) => { const e = m.get(k); if (e) { bytes -= e.n; m.delete(k); } };
  return {
    get(k) { const e = m.get(k); if (!e) return undefined; if (e.exp < Date.now()) { drop(k); return undefined; } m.delete(k); m.set(k, e); return e.v; },
    set(k, v, ttl) { drop(k); const n = sizeOf(v); if (n > maxBytes / 4) return; m.set(k, { v, n, exp: Date.now() + ttl }); bytes += n; while (m.size > max || bytes > maxBytes) drop(m.keys().next().value); },
    delete: drop, get size() { return m.size; }, get bytes() { return bytes; },
  };
}
const TTL = { list: 120e3, manga: 600e3, feed: 300e3, tag: 86400e3, author: 3600e3 };

/** Crea el manejador de las rutas /mangadex/*. `request` se puede reemplazar en las pruebas. */
export function createMangadex({ cfg = mdConfig(), request = safeRequest, allowPrivate = false, timeoutMs = 20000, log = () => {} } = {}) {
  const gate = pacer({ perSec: cfg.perSec, concurrency: 4, maxQueue: 60 });
  const imgGate = pacer({ perSec: 10, concurrency: 6, maxQueue: 120 });
  const atHomeLimit = rateLimiter(cfg.atHomePerMin);
  const SIZE = Symbol('bytes');
  const cache = ttlCache(400, 32 * 1024 * 1024, (j) => j?.[SIZE] || 0), atCache = ttlCache(300), covers = ttlCache(300, 24 * 1024 * 1024, (v) => v.buf.length); // portadas: ≤ 24 MB en memoria
  const inflight = new Map();
  const stats = { upstream: 0, cacheHits: 0, coalesced: 0, limited: 0, reports: 0, coolUntil: 0 };

  const cooling = () => { const s = Math.ceil((stats.coolUntil - Date.now()) / 1000); if (s > 0) throw err(429, `MangaDex pidió esperar (límite de peticiones). Reintentá en ${s} s.`, { retryAfter: s, upstream: true }); };
  const cool = (get) => {
    const ts = +get('x-ratelimit-retry-after'), ra = +get('retry-after');
    const until = ts > 1e9 ? ts * 1000 : ra > 0 ? Date.now() + ra * 1000 : Date.now() + 60e3;
    stats.coolUntil = Math.max(stats.coolUntil, Math.min(until, Date.now() + 15 * 60e3)); stats.limited++;
  };
  const headers = (accept) => ({ 'user-agent': UA, accept }); // sin Via ni cabeceras de navegador falsas
  const once = (key, fn) => {
    if (inflight.has(key)) { stats.coalesced++; return inflight.get(key); }
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  };

  /** GET JSON a la API oficial (con ritmo, pausa por 429 y sin seguir redirecciones). */
  async function apiJson(path, qs, ttl) {
    const key = path + '?' + qs;
    const hit = cache.get(key);
    if (hit) { stats.cacheHits++; return hit; }
    return once(key, () => gate(async () => {
      cooling();
      stats.upstream++;
      const r = await request(`${cfg.api}${path}${qs ? '?' + qs : ''}`, { timeoutMs, allowPrivate, headers: headers('application/json') });
      if (r.status >= 300 && r.status < 400) { r.body.resume?.(); throw err(502, 'MangaDex respondió con una redirección inesperada (no se sigue)'); }
      const buf = await readLimited({ headers: { get: r.get }, body: r.body }, 8 * 1024 * 1024);
      if (r.status === 429) { cool(r.get); throw err(429, 'MangaDex limitó las peticiones (429). Esperá antes de reintentar.', { retryAfter: Math.max(1, Math.ceil((stats.coolUntil - Date.now()) / 1000)), upstream: true }); }
      let j; try { j = JSON.parse(buf.toString('utf8')); } catch { throw err(r.status >= 400 ? r.status : 502, `MangaDex respondió HTTP ${r.status} sin JSON`, { upstream: true }); }
      if (r.status >= 400) throw err(r.status, `MangaDex HTTP ${r.status}: ${String(j?.errors?.[0]?.detail || j?.errors?.[0]?.title || '').slice(0, 200)}`, { upstream: true });
      if (ttl) { Object.defineProperty(j, SIZE, { value: buf.length }); cache.set(key, j, ttl); }
      return j;
    }));
  }

  /** Servidor MangaDex@Home de un capítulo, validado (caché < 15 min garantizados por MangaDex). */
  async function atHome(chapter, { force = false } = {}) {
    if (!force) { const c = atCache.get(chapter); if (c) { stats.cacheHits++; return c; } }
    return once('at:' + chapter + (force ? ':f' : ''), async () => {
      const rl = atHomeLimit('global');
      if (!rl.ok) throw err(429, `Límite de MangaDex@Home (40 por minuto). Reintentá en ${rl.retryAfter} s.`, { retryAfter: rl.retryAfter });
      const j = await apiJson(`/at-home/server/${chapter}`, '', 0);
      const v = validateAtHome(j, cfg);
      atCache.set(chapter, v, 10 * 60e3);
      return v;
    });
  }

  /** Reporte obligatorio a MangaDex@Home (solo servidores fuera de mangadex.org). No bloquea. */
  function report(url, { success, cached = false, bytes = 0, duration }) {
    let host = ''; try { host = new URL(url).hostname; } catch {}
    if (!host || host.includes('mangadex.org')) return;
    stats.reports++;
    const body = JSON.stringify({ url, success, cached, bytes, duration: Math.round(duration) });
    request(cfg.report, { method: 'POST', timeoutMs: 10000, allowPrivate, headers: { 'user-agent': UA, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body })
      .then((r) => r.body.resume?.()).catch(() => {});
  }

  /** Una imagen desde una URL ya validada; sin redirecciones; solo image/*. */
  async function image(url, max) {
    return imgGate(async () => {
      cooling();
      const t0 = Date.now();
      let r;
      try { r = await request(url, { timeoutMs, allowPrivate, headers: headers('image/*') }); }
      catch (e) { report(url, { success: false, duration: Date.now() - t0 }); throw e; }
      if (r.status >= 300 && r.status < 400) {
        r.body.resume?.(); report(url, { success: false, duration: Date.now() - t0 });
        throw err(502, `Redirección no permitida desde el servidor de imágenes (${(() => { try { return new URL(r.get('location'), url).host; } catch { return '?'; } })()})`, { blocked: { url: String(r.get('location') || '').slice(0, 300), reason: 'host' } });
      }
      if (r.status === 429) { r.body.resume?.(); cool(r.get); throw err(429, 'MangaDex limitó las imágenes (429).', { retryAfter: 60, upstream: true }); }
      if (r.status >= 400) { r.body.resume?.(); report(url, { success: false, duration: Date.now() - t0 }); throw err(r.status, `Servidor de imágenes HTTP ${r.status}`, { upstream: true }); }
      const ct = String(r.get('content-type') || '');
      if (!/^image\//i.test(ct)) { r.body.resume?.(); report(url, { success: false, duration: Date.now() - t0 }); throw err(502, 'El servidor de imágenes no devolvió una imagen'); }
      const buf = await readLimited({ headers: { get: r.get }, body: r.body }, max);
      report(url, { success: true, cached: /^HIT/i.test(String(r.get('x-cache') || '')), bytes: buf.length, duration: Date.now() - t0 });
      return { buf, ct };
    });
  }

  async function page(chapter, quality, file) {
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ah = await atHome(chapter, { force: attempt > 0 });
      if (!(quality === 'data' ? ah.data : ah.dataSaver).includes(file)) throw err(404, 'La página no pertenece a ese capítulo');
      try { return await image(`${ah.baseUrl}/${quality}/${ah.hash}/${encodeURIComponent(file)}`, 15 * 1024 * 1024); }
      catch (e) { last = e; if (e.code === 429 || e.code === 404) break; atCache.delete(chapter); } // falla: se pide otro servidor una vez
    }
    throw last;
  }

  // ---------------- rutas ----------------
  async function handle(req, u, res, cors, send) {
    const route = u.pathname.replace(/^.*\/mangadex\//, '');
    const json = (code, obj, extra = {}) => send(res, code, { ...cors, 'content-type': 'application/json; charset=utf-8', ...extra }, JSON.stringify(obj));
    try {
      if (route === 'api') {
        const { path, kind, qs } = sanitizeApi(u.searchParams.get('path') || '', u.searchParams);
        const j = await apiJson(path, qs, TTL[kind]);
        if (kind === 'manga' && j?.data?.attributes?.contentRating === 'pornographic') throw err(451, 'Esta obra está clasificada como contenido adulto explícito y Manhuua no la muestra.');
        const out = kind === 'list' && Array.isArray(j?.data) ? { ...j, data: j.data.filter((m) => m?.attributes?.contentRating !== 'pornographic') } : j;
        return json(200, out, { 'cache-control': 'private, max-age=60' });
      }
      if (route === 'chapter') {
        const id = u.searchParams.get('id') || '';
        if (!UUID.test(id)) throw err(400, 'Capítulo inválido');
        const ah = await atHome(id);
        return json(200, { hash: ah.hash, data: ah.data, dataSaver: ah.dataSaver }, { 'cache-control': 'no-store' });
      }
      if (route === 'page') {
        const ch = u.searchParams.get('chapter') || '', q = u.searchParams.get('quality') || 'data', f = u.searchParams.get('file') || '';
        if (!UUID.test(ch) || !QUALITY.includes(q) || !FILE.test(f)) throw err(400, 'Parámetros de página inválidos');
        const { buf, ct } = await page(ch, q, f);
        return send(res, 200, { ...cors, 'content-type': ct, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" }, buf);
      }
      if (route === 'cover') {
        const m = u.searchParams.get('manga') || '', f = u.searchParams.get('file') || '', size = u.searchParams.get('size') || '512';
        if (!UUID.test(m) || !FILE.test(f) || !(size in SIZES)) throw err(400, 'Parámetros de portada inválidos');
        const url = `${cfg.uploads}/covers/${m}/${encodeURIComponent(f)}${SIZES[size]}`;
        let hit = covers.get(url);
        if (hit) stats.cacheHits++;
        else { hit = await once(url, () => image(url, 8 * 1024 * 1024)); covers.set(url, hit, 6 * 3600e3); }
        return send(res, 200, { ...cors, 'content-type': hit.ct, 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" }, hit.buf);
      }
      if (route === 'status') return json(200, { ok: true, cooling: Math.max(0, Math.ceil((stats.coolUntil - Date.now()) / 1000)), ...stats, cache: cache.size, cacheBytes: cache.bytes, covers: covers.size, coverBytes: covers.bytes }, { 'cache-control': 'no-store' });
      throw err(404, 'Ruta de MangaDex desconocida');
    } catch (e) {
      const code = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : e.name === 'TimeoutError' ? 504 : 502;
      if (code >= 500) log('mangadex', route, code, e.message);
      // x-manhuua-error: el error es del backend (validación, política, ritmo propio). Sin ella, lo respondió MangaDex.
      const extra = { 'cache-control': 'no-store', ...(e.upstream ? { 'x-upstream': 'mangadex' } : { 'x-manhuua-error': '1' }), ...(e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {}), ...(e.blocked ? { 'x-manhuua-blocked-url': e.blocked.url, 'x-manhuua-blocked-reason': e.blocked.reason } : {}) };
      return json(code, { error: e.message, kind: e.kind || (code === 429 ? 'limited' : undefined), retryAfter: e.retryAfter }, extra);
    }
  }
  return { handle, stats, apiJson, atHome, page };
}

