// Seguridad del backend: configuración por variables de entorno, CORS por lista de orígenes,
// bloqueo de direcciones internas (SSRF), límite de peticiones por IP y lectura con tope de tamaño.
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

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
    // Descargas simultáneas del proxy (todo el servidor) y cola: evita que una lectura larga sature la instancia.
    proxyConcurrency: Math.max(1, num(env.PROXY_CONCURRENCY, 16)),
    proxyQueue: num(env.PROXY_QUEUE, 64),
    // Chromium: se cierra tras este tiempo sin uso y se recicla cada N renderizados (memoria estable).
    renderIdleMs: num(env.RENDER_IDLE_MS, 300000),
    renderRecycle: num(env.RENDER_RECYCLE, 40),
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

// ---------------------------------------------------------------------------------------------
// Clasificación de direcciones IP (SSRF). Se trabaja sobre la dirección normalizada (bytes), no
// sobre su texto: "::ffff:127.0.0.1", "::ffff:7f00:1" y "0:0:0:0:0:ffff:7f00:0001" son lo mismo.
// ---------------------------------------------------------------------------------------------
const V4_BLOCK = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) V4_BLOCK.addSubnet(a, p, 'ipv4');
/** Metadatos de proveedores cloud (también están dentro de rangos bloqueados; se listan para el motivo). */
export const METADATA_IPS = ['169.254.169.254', '169.254.170.2', '169.254.169.123', '100.100.100.200', '192.0.0.192', 'fd00:ec2::254'];
const METADATA_HOSTS = /^(metadata|metadata\.google\.internal|metadata\.azure\.com|instance-data|instance-data\.ec2\.internal|metadata\.tencentyun\.com|100-100-100-200\.alibaba)$/i;

/** IPv6 → 16 bytes (o null si no es IPv6 válida). Acepta "::", IPv4 incrustada y zona (%eth0). */
export function ipv6Bytes(ip) {
  let s = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  if (s.includes('%')) s = s.slice(0, s.indexOf('%'));
  if (!net.isIPv6(s)) return null;
  const tail4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail4) { const [a, b, c, d] = tail4[1].split('.').map(Number); s = s.slice(0, -tail4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16); }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [], t = tail != null ? (tail ? tail.split(':') : []) : null;
  const groups = t == null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  groups.forEach((g, i) => { const v = parseInt(g || '0', 16); out[2 * i] = v >> 8; out[2 * i + 1] = v & 255; });
  return out;
}
const v4of = (b, i) => `${b[i]}.${b[i + 1]}.${b[i + 2]}.${b[i + 3]}`;
const zero = (b, from, to) => b.slice(from, to).every((x) => x === 0);

/**
 * Clasifica una dirección: {blocked, reason, normalized}. Bloquea loopback, privadas, enlace-local,
 * CGNAT, multicast, reservadas, documentación, metadatos cloud e IPv4 incrustadas en IPv6
 * (mapeadas ::ffff:, compatibles ::a.b.c.d, NAT64 64:ff9b::, 6to4 2002::, Teredo 2001::).
 * En IPv6 solo se permite unicast global (2000::/3) fuera de rangos especiales.
 */
export function classifyIp(ip) {
  const raw = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(raw)) {
    if (METADATA_IPS.includes(raw)) return { blocked: true, reason: 'metadatos cloud', normalized: raw };
    return V4_BLOCK.check(raw, 'ipv4') ? { blocked: true, reason: 'dirección IPv4 interna o reservada', normalized: raw } : { blocked: false, normalized: raw };
  }
  if (raw.includes('%')) return { blocked: true, reason: 'IPv6 con zona (enlace local)', normalized: raw };
  const b = ipv6Bytes(raw);
  if (!b) return { blocked: true, reason: 'dirección no reconocida', normalized: raw };
  const norm = Array.from({ length: 8 }, (_, i) => ((b[2 * i] << 8) | b[2 * i + 1]).toString(16)).join(':');
  const embedded = (v4, kind) => { const c = classifyIp(v4); return c.blocked ? { blocked: true, reason: `${kind} de ${v4} (${c.reason})`, normalized: norm } : null; };
  if (METADATA_IPS.some((m) => m.includes(':') && ipv6Bytes(m).every((x, i) => x === b[i]))) return { blocked: true, reason: 'metadatos cloud', normalized: norm };
  // ::ffff:a.b.c.d (mapeada) y ::a.b.c.d (compatible, obsoleta): siempre bloqueadas como IPv6;
  // además se informa la IPv4 interna si corresponde.
  if (zero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) return embedded(v4of(b, 12), 'IPv4 mapeada') || { blocked: true, reason: 'IPv4 mapeada en IPv6 (no se usa para salir)', normalized: norm };
  if (zero(b, 0, 12)) return { blocked: true, reason: zero(b, 12, 15) && b[15] <= 1 ? 'loopback / no especificada' : 'IPv4 compatible (obsoleta)', normalized: norm };
  // NAT64 (64:ff9b::/96): se clasifica la IPv4 incrustada.
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(b, 4, 12)) return embedded(v4of(b, 12), 'NAT64') || { blocked: false, normalized: norm };
  if ((b[0] & 0xe0) !== 0x20) return { blocked: true, reason: 'IPv6 no global (loopback, ULA, enlace local, multicast o reservada)', normalized: norm };
  if (b[0] === 0x20 && b[1] === 0x02) return embedded(v4of(b, 2), '6to4') || { blocked: true, reason: '6to4 (obsoleto)', normalized: norm };
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) { const t = b.slice(12).map((x) => x ^ 0xff); return embedded(v4of(t, 0), 'Teredo') || { blocked: true, reason: 'Teredo', normalized: norm }; }
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] < 2) return { blocked: true, reason: 'IPv6 de uso especial (2001::/23)', normalized: norm };
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return { blocked: true, reason: 'IPv6 de documentación', normalized: norm };
  if (b[0] === 0x3f && (b[1] & 0xf0) === 0xf0) return { blocked: true, reason: 'IPv6 de documentación (3fff::/20)', normalized: norm };
  if (b[0] === 0x3f && b[1] === 0xfe) return { blocked: true, reason: 'IPv6 reservada (3ffe::/16)', normalized: norm };
  return { blocked: false, normalized: norm };
}
/** Compatibilidad: true si la IP no es pública. */
export const isPrivateIp = (ip) => classifyIp(ip).blocked;

/** Nombres que nunca se consultan: locales, de una sola palabra o de metadatos. */
export function blockedHostname(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  if (net.isIP(h.replace(/^\[|\]$/g, ''))) return null;
  if (METADATA_HOSTS.test(h)) return 'metadatos cloud';
  if (!h.includes('.')) return 'nombre local de una sola palabra';
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|private|localdomain)$|\.home\.arpa$/.test(h)) return 'nombre de red interna';
  return null;
}

const denied = (why) => Object.assign(new Error(`Destino interno no permitido (${why})`), { code: 403 });

/**
 * lookup seguro para http/https/net: resuelve UNA vez, valida TODAS las direcciones y entrega a la
 * conexión solo direcciones ya validadas (la conexión usa exactamente la IP validada: sin segunda
 * resolución, no hay DNS rebinding). Si la resolución falla, falla la conexión (nunca se relaja).
 */
export function safeLookup({ allowPrivate = false, resolver = dns.lookup, onResolve } = {}) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    const host = String(hostname).replace(/^\[|\]$/g, '');
    const done = (err, list) => {
      if (err) return cb(err);
      onResolve?.(host, list);
      if (options?.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    };
    const check = (list) => {
      if (!list?.length) return done(Object.assign(new Error(`No se pudo resolver ${host}`), { code: 502 }));
      if (!allowPrivate) {
        const bad = list.map((a) => [a.address, classifyIp(a.address)]).find(([, c]) => c.blocked);
        if (bad) return done(denied(`${host} → ${bad[0]}: ${bad[1].reason}`));
      }
      done(null, list.map((a) => ({ address: a.address, family: a.family || (net.isIPv6(a.address) ? 6 : 4) })));
    };
    if (net.isIP(host)) return check([{ address: host, family: net.isIP(host) }]);
    if (!allowPrivate) { const why = blockedHostname(host); if (why) return done(denied(why)); }
    Promise.resolve(resolver(host, { all: true, verbatim: true })).then(check, (e) => done(Object.assign(new Error(`No se pudo resolver ${host}: ${e.code || e.message}`), { code: 502 })));
  };
}

/** Valida que la URL sea http(s) pública. Lanza un error con .code=400/403 si no. */
export async function assertPublicUrl(raw, { allowPrivate = false, lookup = dns.lookup } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('URL inválida'), { code: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Solo se permiten URLs http/https'), { code: 400 });
  if (u.username || u.password) throw Object.assign(new Error('URL con credenciales no permitida'), { code: 400 });
  if (allowPrivate) return u;
  await new Promise((res, rej) => safeLookup({ resolver: lookup })(u.hostname, { all: true }, (e) => (e ? rej(e) : res())));
  return u;
}

// ---------------------------------------------------------------------------------------------
// Cliente HTTP con la IP fijada (sin dependencias): http/https de Node con el lookup seguro. TLS,
// SNI y la verificación del certificado usan el nombre del host (no la IP).
// ---------------------------------------------------------------------------------------------
/** Una petición (sin seguir redirecciones). Devuelve {status, headers, body(stream), remoteAddress}. */
export function safeRequest(raw, { method = 'GET', headers = {}, body, timeoutMs = 20000, allowPrivate = false, resolver } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(raw); } catch { return reject(Object.assign(new Error('URL inválida'), { code: 400 })); }
    if (!/^https?:$/.test(u.protocol)) return reject(Object.assign(new Error('Solo se permiten URLs http/https'), { code: 400 }));
    if (u.username || u.password) return reject(Object.assign(new Error('URL con credenciales no permitida'), { code: 400 }));
    // Node no llama a lookup cuando el host ya es una IP: se valida acá (mismas reglas).
    const lit = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(lit) && !allowPrivate) { const c = classifyIp(lit); if (c.blocked) return reject(denied(`${lit}: ${c.reason}`)); }
    if (!net.isIP(lit) && !allowPrivate) { const why = blockedHostname(lit); if (why) return reject(denied(why)); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method, headers: { 'accept-encoding': 'gzip, deflate, br', ...headers },
      lookup: safeLookup({ allowPrivate, resolver }), agent: false, timeout: timeoutMs,
      servername: net.isIP(u.hostname.replace(/^\[|\]$/g, '')) ? undefined : u.hostname,
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('Tiempo agotado'), { name: 'TimeoutError', code: 504 })), timeoutMs);
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tiempo agotado'), { name: 'TimeoutError', code: 504 })));
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('response', (res) => {
      clearTimeout(timer);
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc === 'gzip' || enc === 'x-gzip' ? res.pipe(zlib.createGunzip()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      if (stream !== res) res.on('error', (e) => stream.destroy(e));
      const h = { ...res.headers }; if (stream !== res) { delete h['content-encoding']; delete h['content-length']; }
      resolve({ status: res.statusCode, headers: h, body: stream, remoteAddress: res.socket?.remoteAddress, get: (n) => h[n.toLowerCase()] });
    });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Política de dominios para redirecciones (y la URL inicial) de extensiones JSON: "hosts" =
 * "a.com,cdn.a.com,*.img.org" (exactos con puerto, o comodín de subdominio). Sin lista = sin límite.
 */
export function parseHostPolicy(s = '') {
  const list = String(s).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 25);
  // Es una lista que RESTRINGE (nunca amplía lo permitido): el bloqueo de direcciones internas se aplica igual.
  for (const h of list) if (!/^((\*\.[a-z0-9-]+\.[a-z0-9.-]+)|[a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?$/.test(h) || h.includes('..')) throw Object.assign(new Error(`Dominio inválido en hosts: ${h.slice(0, 60)}`), { code: 400 });
  return list;
}
export function hostAllowed(url, list) {
  if (!list?.length) return true;
  const u = new URL(url); const host = u.host.toLowerCase(); const [hh, hp] = host.split(':');
  return list.some((a) => {
    if (!a.startsWith('*.')) return host === a;
    const [ah, ap] = a.slice(2).split(':');
    return hh.endsWith('.' + ah) && hp === ap;
  });
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
