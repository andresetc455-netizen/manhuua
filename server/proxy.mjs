// Servidor de Manhuua: proxy CORS (/proxy?url=&referer=), renderizador (/render?url=&kind=),
// estado (/health) y, si existe dist/, la app compilada.
// Local:  npm run serve  (PORT=8787). Producción (Render): ver Dockerfile y DEPLOY.md.
// Configuración por variables de entorno: ver server/security.mjs (loadConfig) y .env.example.
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { render, renderAvailable, closeBrowser } from './render.mjs';
import { loadConfig, originAllowed, assertPublicUrl, rateLimiter, clientIp, readLimited, limiter } from './security.mjs';

const C = loadConfig();
const DIST = path.resolve(import.meta.dirname, '../dist');
const STATIC = C.serveStatic && existsSync(DIST);
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const limits = { proxy: rateLimiter(C.proxyPerMin), render: rateLimiter(C.renderPerMin) };
const renderSlot = limiter(C.renderConcurrency, C.renderQueue);
const log = (...a) => console.log(new Date().toISOString(), ...a);

function corsHeaders(req) {
  const o = req.headers.origin;
  const expose = { 'access-control-expose-headers': 'x-final-url, x-manhuua-error, retry-after' };
  if (!C.origins.length) return { 'access-control-allow-origin': '*', ...expose };
  return o && originAllowed(o, C.origins) ? { 'access-control-allow-origin': o, vary: 'Origin', ...expose } : { vary: 'Origin' };
}
const send = (res, code, headers, body) => { if (!res.headersSent) res.writeHead(code, headers); res.end(body); };
const sendJson = (res, code, cors, obj, extra = {}) => send(res, code, { ...cors, ...extra, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, JSON.stringify(obj));

/** Descarga siguiendo redirecciones a mano para validar cada salto (evita SSRF por redirección). */
async function fetchPublic(raw, referer) {
  let url = raw;
  for (let hop = 0; hop < 6; hop++) {
    const u = await assertPublicUrl(url, { allowPrivate: C.allowPrivate });
    const r = await fetch(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(C.fetchTimeoutMs),
      headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'es,en;q=0.8', referer: referer || u.origin + '/' },
    });
    const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
    if (!loc) return { r, finalUrl: u.href };
    url = new URL(loc, u).href;
  }
  throw Object.assign(new Error('Demasiadas redirecciones'), { code: 508 });
}

async function proxy(req, u, res, cors) {
  const target = u.searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) return send(res, 400, cors, 'manhuua-proxy: parámetro url inválido');
  try {
    const { r, finalUrl } = await fetchPublic(target, u.searchParams.get('referer'));
    const buf = await readLimited(r, C.maxBytes);
    send(res, r.status, {
      ...cors,
      'content-type': r.headers.get('content-type') || 'application/octet-stream',
      'cache-control': r.ok ? 'public, max-age=1800' : 'no-store',
      'x-final-url': finalUrl,
      // El contenido ajeno nunca se ejecuta en el origen del backend.
      'content-security-policy': "sandbox; default-src 'none'",
      'x-content-type-options': 'nosniff',
    }, buf);
  } catch (e) {
    const code = e.code && e.code >= 400 ? e.code : e.name === 'TimeoutError' ? 504 : 502;
    send(res, code, { ...cors, 'content-type': 'text/plain; charset=utf-8', 'x-manhuua-error': '1' }, 'manhuua-proxy: ' + e.message);
  }
}

async function renderRoute(req, u, res, cors) {
  const target = u.searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) return send(res, 400, cors, 'manhuua-render: parámetro url inválido');
  try {
    await assertPublicUrl(target, { allowPrivate: C.allowPrivate });
    const kind = u.searchParams.get('kind') === 'chapter' ? 'chapter' : 'catalog';
    const out = await renderSlot(() => render(target, kind, { maxMs: C.renderTimeoutMs, allowPrivate: C.allowPrivate }));
    sendJson(res, 200, cors, out);
  } catch (e) {
    const code = [400, 403, 501, 503].includes(e.code) ? e.code : 502;
    sendJson(res, code, cors, { error: e.message }, code === 503 ? { 'retry-after': '10' } : {});
  }
}

async function serveStatic(u, res) {
  let file = path.join(DIST, decodeURIComponent(u.pathname));
  if (!file.startsWith(DIST)) return send(res, 403, {}, '');
  try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html'); }
  catch { file = path.join(DIST, 'index.html'); }
  try { send(res, 200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }, await fs.readFile(file)); }
  catch { send(res, 404, {}, 'Ejecutá primero: npm run build'); }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const cors = corsHeaders(req);
  const api = u.pathname.endsWith('/proxy') ? 'proxy' : u.pathname.endsWith('/render') ? 'render' : u.pathname.endsWith('/health') ? 'health' : null;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, { ...cors, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*', 'access-control-max-age': '86400' });
    if (api && req.headers.origin && !originAllowed(req.headers.origin, C.origins)) return sendJson(res, 403, cors, { error: 'Origen no permitido' });
    if (api === 'health') return sendJson(res, 200, cors, { ok: true, service: 'manhuua-backend', render: await renderAvailable(), uptime: Math.round(process.uptime()) });
    if (api && req.method !== 'GET') return sendJson(res, 405, cors, { error: 'Método no permitido' });
    if (api) {
      const rl = limits[api](clientIp(req, C.trustProxy));
      if (!rl.ok) return sendJson(res, 429, cors, { error: 'Demasiadas peticiones, esperá un momento' }, { 'retry-after': String(rl.retryAfter), 'x-manhuua-error': '1' });
      return api === 'proxy' ? await proxy(req, u, res, cors) : await renderRoute(req, u, res, cors);
    }
    if (STATIC) return await serveStatic(u, res);
    return sendJson(res, 404, cors, { error: 'No encontrado' });
  } catch (e) {
    log('error', req.method, u.pathname, e.message);
    sendJson(res, 500, cors, { error: 'Error interno' });
  }
});
server.requestTimeout = 60000;
server.headersTimeout = 15000;
server.listen(C.port, '0.0.0.0', () => log(`Manhuua backend en :${C.port} · orígenes: ${C.origins.join(', ') || 'cualquiera'} · IPs privadas: ${C.allowPrivate ? 'permitidas' : 'bloqueadas'} · app estática: ${STATIC ? 'sí' : 'no'}`));

const stop = async () => { log('cerrando…'); server.close(); await closeBrowser(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
