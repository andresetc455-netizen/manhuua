// Seguridad del backend: configuración por variables de entorno, CORS por lista de orígenes,
// bloqueo de direcciones internas (SSRF), límite de peticiones por IP y lectura con tope de tamaño.
import dns from 'node:dns/promises';
import net from 'node:net';

const num = (v, d) => (v != null && v !== '' && !Number.isNaN(+v) ? +v : d);
const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes|si|sí)$/i.test(v));

export function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  return {
    port: num(env.PORT, 8787),
    prod,
    // Orígenes permitidos (coma). Vacío = cualquiera (solo para uso local).
    origins: parseOrigins(env.ALLOWED_ORIGINS),
    // En producción se bloquean IPs privadas/locales salvo que se permita explícitamente.
    allowPrivate: bool(env.ALLOW_PRIVATE, !prod),
    trustProxy: bool(env.TRUST_PROXY, prod),
    serveStatic: bool(env.SERVE_STATIC, true),
    proxyPerMin: num(env.RATE_LIMIT_PROXY, 240),
    renderPerMin: num(env.RATE_LIMIT_RENDER, 12),
    maxBytes: num(env.MAX_BYTES, 25 * 1024 * 1024),
    fetchTimeoutMs: num(env.FETCH_TIMEOUT_MS, 20000),
    renderTimeoutMs: num(env.RENDER_TIMEOUT_MS, 25000),
    renderConcurrency: Math.max(1, num(env.RENDER_CONCURRENCY, 1)),
    renderQueue: num(env.RENDER_QUEUE, 6),
  };
}

/** "https://a.pages.dev, https://*.a.pages.dev" → lista de matchers. */
export function parseOrigins(s = '') {
  return String(s).split(',').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean);
}
export function originAllowed(origin, list) {
  if (!list.length) return true;
  if (!origin) return true; // sin Origin: no es un navegador haciendo CORS (el límite por IP sigue aplicando)
  return list.some((o) => {
    if (o === '*') return true;
    if (!o.includes('*')) return o === origin;
    const re = new RegExp('^' + o.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+') + '$', 'i');
    return re.test(origin);
  });
}

/** IPv4/IPv6 privadas, locales, enlace-local, metadatos de nube, etc. */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

/** Valida que la URL sea http(s) pública. Lanza un error con .code=400/403 si no. */
export async function assertPublicUrl(raw, { allowPrivate = false, lookup = dns.lookup } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('URL inválida'), { code: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Solo se permiten URLs http/https'), { code: 400 });
  if (u.username || u.password) throw Object.assign(new Error('URL con credenciales no permitida'), { code: 400 });
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw Object.assign(new Error('Destino interno no permitido'), { code: 403 });
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw Object.assign(new Error(`No se pudo resolver ${host}`), { code: 502 }); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw Object.assign(new Error('Destino interno no permitido'), { code: 403 });
  return u;
}

/** Límite por ventana fija de 60 s. Devuelve {ok, remaining, retryAfter}. */
export function rateLimiter(perMin, now = () => Date.now()) {
  const hits = new Map();
  return (key) => {
    if (!perMin) return { ok: true, remaining: Infinity };
    const t = now();
    let h = hits.get(key);
    if (!h || t - h.start >= 60000) { h = { start: t, n: 0 }; hits.set(key, h); }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start >= 60000) hits.delete(k);
    return h.n > perMin ? { ok: false, remaining: 0, retryAfter: Math.ceil((h.start + 60000 - t) / 1000) } : { ok: true, remaining: perMin - h.n };
  };
}

export function clientIp(req, trustProxy) {
  const fwd = trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'desconocida';
}

/** Lee el cuerpo con tope de tamaño (lanza .code=413 si lo supera). */
export async function readLimited(res, max) {
  const len = +res.headers.get('content-length');
  if (len && len > max) throw Object.assign(new Error(`Respuesta demasiado grande (${len} bytes)`), { code: 413 });
  const chunks = []; let n = 0;
  for await (const c of res.body ?? []) {
    n += c.length;
    if (n > max) throw Object.assign(new Error('Respuesta demasiado grande'), { code: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/** Semáforo simple con cola acotada (para el navegador, que usa mucha memoria). */
export function limiter(concurrency, maxQueue) {
  let active = 0; const q = [];
  const next = () => { if (active < concurrency && q.length) { active++; q.shift()(); } };
  return async (fn) => {
    if (active >= concurrency && q.length >= maxQueue) throw Object.assign(new Error('Servidor ocupado, probá de nuevo en unos segundos'), { code: 503 });
    await new Promise((r) => { q.push(r); next(); });
    try { return await fn(); } finally { active--; next(); }
  };
}
