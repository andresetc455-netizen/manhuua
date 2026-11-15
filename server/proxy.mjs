// Servidor de Manhuua: proxy CORS (/proxy?url=&referer=), renderizador (/render?url=&kind=),
// estado (/health) y, si existe dist/, la app compilada.
// Local:  npm run serve  (PORT=8787). Producción (Render): ver Dockerfile y DEPLOY.md.
// Configuración por variables de entorno: ver server/security.mjs (loadConfig) y .env.example.
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { render, renderAvailable, closeBrowser } from './render.mjs';
import { loadConfig, originAllowed, assertPublicUrl, rateLimiter, clientIp, readLimited, limiter, safeRequest, parseHostPolicy, hostAllowed } from './security.mjs';

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
  const expose = { 'access-control-expose-headers': 'x-final-url, x-manhuua-error, x-manhuua-blocked-url, x-manhuua-blocked-reason, x-upstream-server, x-upstream-challenge, retry-after' };
  if (!C.origins.length) return { 'access-control-allow-origin': '*', ...expose };
  return o && originAllowed(o, C.origins) ? { 'access-control-allow-origin': o, vary: 'Origin', ...expose } : { vary: 'Origin' };
}
const send = (res, code, headers, body) => { if (!res.headersSent) res.writeHead(code, headers); res.end(body); };
const sendJson = (res, code, cors, obj, extra = {}) => send(res, code, { ...cors, ...extra, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, JSON.stringify(obj));

/**
 * Descarga siguiendo redirecciones a mano. Cada salto: URL http(s) sin credenciales, conexión a una IP
 * validada en el mismo momento de conectar (sin DNS rebinding) y, si la extensión declaró dominios
 * (hosts), el destino tiene que estar entre ellos y no se baja de HTTPS a HTTP.
 */
async function fetchPublic(raw, referer, policy = []) {
  let url = raw;
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(url);
    if (policy.length && !hostAllowed(u.href, policy)) throw Object.assign(new Error(`${hop ? 'Redirección' : 'Petición'} a un dominio no autorizado por la extensión (${u.host})`), { code: 403, blocked: { url: u.href, reason: 'host' } });
    const r = await safeRequest(u.href, {
      timeoutMs: C.fetchTimeoutMs, allowPrivate: C.allowPrivate,
      headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'es,en;q=0.8', referer: referer || u.origin + '/' },
    });
    const loc = r.status >= 300 && r.status < 400 && r.get('location');
    if (!loc) return { r: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: r.get }, body: r.body }, finalUrl: u.href };
    r.body.resume(); // descartar el cuerpo de la redirección
    const nextUrl = new URL(loc, u);
    if (policy.length && u.protocol === 'https:' && nextUrl.protocol === 'http:') throw Object.assign(new Error(`Redirección de HTTPS a HTTP rechazada (${nextUrl.host})`), { code: 403, blocked: { url: nextUrl.href, reason: 'downgrade' } });
    url = nextUrl.href;
  }
  throw Object.assign(new Error('Demasiadas redirecciones'), { code: 508 });
}

async function proxy(req, u, res, cors) {
  const target = u.searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) return send(res, 400, cors, 'manhuua-proxy: parámetro url inválido');
  try {
    const policy = parseHostPolicy(u.searchParams.get('hosts') || '');
    const { r, finalUrl } = await fetchPublic(target, u.searchParams.get('referer'), policy);
    const buf = await readLimited(r, C.maxBytes);
    send(res, r.status, {
      ...cors,
      'content-type': r.headers.get('content-type') || 'application/octet-stream',
      'cache-control': r.ok ? 'public, max-age=1800' : 'no-store',
      'x-final-url': finalUrl,
      // Para el diagnóstico: quién atendió en el sitio y si respondió con una verificación antibots.
      'x-upstream-server': (r.headers.get('server') || '').slice(0, 40),
      ...(!r.ok && (r.headers.get('cf-mitigated') === 'challenge' || /just a moment|attention required|captcha|challenge-platform/i.test(buf.subarray(0, 4000).toString('latin1'))) ? { 'x-upstream-challenge': '1' } : {}),
      // El contenido ajeno nunca se ejecuta en el origen del backend.
      'content-security-policy': "sandbox; default-src 'none'",
      'x-content-type-options': 'nosniff',
    }, buf);
  } catch (e) {
    const code = Number.isInteger(e.code) && e.code >= 400 ? e.code : e.name === 'TimeoutError' ? 504 : 502;
    // Diagnóstico de política: a qué URL se intentó ir y por qué se rechazó.
    const blocked = e.blocked ? { 'x-manhuua-blocked-url': e.blocked.url, 'x-manhuua-blocked-reason': e.blocked.reason } : {};
    send(res, code, { ...cors, 'content-type': 'text/plain; charset=utf-8', 'x-manhuua-error': '1', ...blocked }, 'manhuua-proxy: ' + e.message);
  }
}

async function renderRoute(req, u, res, cors) {
  const target = u.searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) return send(res, 400, cors, 'manhuua-render: parámetro url inválido');
  try {
    await assertPublicUrl(target, { allowPrivate: C.allowPrivate });
    const kind = ['chapter', 'series'].includes(u.searchParams.get('kind')) ? u.searchParams.get('kind') : 'catalog';
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
    // Origen no permitido: se responde legible para que la app explique qué configurar (no expone datos).
    if (api && req.headers.origin && !originAllowed(req.headers.origin, C.origins)) return sendJson(res, 403, { 'access-control-allow-origin': req.headers.origin, vary: 'Origin', 'access-control-expose-headers': 'x-manhuua-error' }, { error: `Origen no permitido: ${req.headers.origin}` }, { 'x-manhuua-error': '1' });
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
