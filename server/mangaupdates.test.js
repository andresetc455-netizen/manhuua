// @vitest-environment node
// MangaUpdates (backend, solo metadatos): rutas en lista blanca, cuerpo de búsqueda acotado, host
// fijo de portadas, sin redirecciones, 429 con pausa, caché y uniones. Sin red: `request` simulado.
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createMangaupdates, muConfig, coverUrlOk, searchBody } from './mangaupdates.mjs';
import { UA } from './mangadex.mjs';

const res = (status, body = '', headers = {}) => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: h, get: (n) => h[n.toLowerCase()], body: Readable.from([Buffer.from(body)]) };
};
async function call(mu, path) {
  const out = {};
  await mu.handle({}, new URL(path, 'http://localhost'), {}, {}, (_, code, headers, body) => Object.assign(out, { status: code, headers, body }));
  if (/json/.test(out.headers['content-type'])) out.json = JSON.parse(out.body);
  return out;
}
const PROD = muConfig({}, { allowPrivate: false });
const SEARCH = JSON.stringify({ total_hits: 1, page: 1, per_page: 24, results: [{ record: { series_id: 123, title: 'Obra' } }] });

describe('MangaUpdates: configuración y validación', () => {
  it('producción ignora MU_API_BASE / MU_IMG_HOST', () => {
    expect(muConfig({ MU_API_BASE: 'http://127.0.0.1:1', MU_IMG_HOST: 'evil.test' }, { allowPrivate: false })).toMatchObject({ test: false, api: 'https://api.mangaupdates.com', imgHost: 'cdn.mangaupdates.com' });
  });
  it('portadas: solo https://cdn.mangaupdates.com/image/…', () => {
    expect(coverUrlOk('https://cdn.mangaupdates.com/image/i123.jpg', PROD)).toBe(true);
    for (const u of ['http://cdn.mangaupdates.com/image/i1.jpg', 'https://cdn.mangaupdates.com:444/image/i1.jpg', 'https://evil.test/image/i1.jpg', 'https://cdn.mangaupdates.com.evil.test/image/i1.jpg', 'https://u:p@cdn.mangaupdates.com/image/i1.jpg', 'https://cdn.mangaupdates.com/../etc/passwd', 'https://169.254.169.254/image/x.jpg', 'https://[::ffff:7f00:1]/image/x.jpg', 'javascript:alert(1)'])
      expect(coverUrlOk(u, PROD)).toBe(false);
  });
  it('búsqueda: solo texto, página (1–200) y tamaño (1–50); sin texto → 400', () => {
    expect(searchBody(new URLSearchParams('q=solo&page=999&perpage=999&orderby=x&admin=1'))).toEqual({ search: 'solo', page: 200, perpage: 50 });
    expect(() => searchBody(new URLSearchParams('q=%20'))).toThrow(/texto/);
  });
});

describe('MangaUpdates: rutas', () => {
  it('search → POST JSON a /v1/series/search con UA propio; caché y unión de pedidos iguales', async () => {
    const calls = [];
    const mu = createMangaupdates({ cfg: PROD, request: async (url, o) => { calls.push({ url, ...o }); await new Promise((s) => setTimeout(s, 20)); return res(200, SEARCH, { 'content-type': 'application/json' }); } });
    const [a, b] = await Promise.all([call(mu, '/mangaupdates/search?q=obra'), call(mu, '/mangaupdates/search?q=obra')]);
    expect(a.status).toBe(200); expect(b.json.results[0].record.series_id).toBe(123);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://api.mangaupdates.com/v1/series/search', method: 'POST' });
    expect(JSON.parse(calls[0].body)).toEqual({ search: 'obra', page: 1, perpage: 24 });
    expect(calls[0].headers['user-agent']).toBe(UA); expect(calls[0].headers.via).toBeUndefined();
    await call(mu, '/mangaupdates/search?q=obra');
    expect(calls).toHaveLength(1); expect(mu.stats.cacheHits).toBe(1);
  });
  it('series: id numérico; otros → 400 sin pedir nada', async () => {
    const calls = [];
    const mu = createMangaupdates({ cfg: PROD, request: async (url) => { calls.push(url); return res(200, '{"series_id":5,"title":"X"}'); } });
    expect((await call(mu, '/mangaupdates/series?id=5')).json.series_id).toBe(5);
    for (const id of ['abc', '../v1/account', '5;1', '', '1'.repeat(21)]) expect((await call(mu, '/mangaupdates/series?id=' + encodeURIComponent(id))).status).toBe(400);
    expect(calls).toEqual(['https://api.mangaupdates.com/v1/series/5']);
    expect((await call(mu, '/mangaupdates/account')).status).toBe(404);
  });
  it('429: pausa con Retry-After y no vuelve a pedir durante la pausa', async () => {
    let n = 0;
    const mu = createMangaupdates({ cfg: PROD, request: async () => { n++; return res(429, '{"reason":"slow down"}', { 'retry-after': '30' }); } });
    const r = await call(mu, '/mangaupdates/search?q=a');
    expect(r.status).toBe(429); expect(r.headers['retry-after']).toBe('30'); expect(r.headers['x-upstream']).toBe('mangaupdates');
    expect((await call(mu, '/mangaupdates/search?q=b')).status).toBe(429);
    expect(n).toBe(1);
  });
  it('redirección de la API: no se sigue (502); 404 y 5xx se informan como de la fuente', async () => {
    const mk = (r) => createMangaupdates({ cfg: PROD, request: async () => r });
    expect((await call(mk(res(302, '', { location: 'http://169.254.169.254/' })), '/mangaupdates/series?id=1')).status).toBe(502);
    const nf = await call(mk(res(404, '{"reason":"not found"}')), '/mangaupdates/series?id=1');
    expect(nf.status).toBe(404); expect(nf.headers['x-upstream']).toBe('mangaupdates');
    expect((await call(mk(res(503, '<html>down</html>')), '/mangaupdates/series?id=1')).status).toBe(503);
  });
  it('portada: host fijo, sin redirecciones y solo image/*', async () => {
    const calls = [];
    const mu = createMangaupdates({ cfg: PROD, request: async (url) => { calls.push(url); return url.endsWith('ok.jpg') ? res(200, 'IMG', { 'content-type': 'image/jpeg' }) : url.endsWith('r.jpg') ? res(302, '', { location: 'http://127.0.0.1/' }) : res(200, '<html>', { 'content-type': 'text/html' }); } });
    const ok = await call(mu, '/mangaupdates/cover?url=' + encodeURIComponent('https://cdn.mangaupdates.com/image/ok.jpg'));
    expect(ok.status).toBe(200); expect(ok.headers['content-type']).toBe('image/jpeg'); expect(ok.headers['content-security-policy']).toMatch(/sandbox/);
    expect((await call(mu, '/mangaupdates/cover?url=' + encodeURIComponent('https://cdn.mangaupdates.com/image/r.jpg'))).status).toBe(502);
    expect((await call(mu, '/mangaupdates/cover?url=' + encodeURIComponent('https://cdn.mangaupdates.com/image/h.jpg'))).status).toBe(502);
    expect((await call(mu, '/mangaupdates/cover?url=' + encodeURIComponent('http://127.0.0.1:8080/image/ok.jpg'))).status).toBe(400);
    expect(calls.every((u) => u.startsWith('https://cdn.mangaupdates.com/'))).toBe(true);
  });
});
