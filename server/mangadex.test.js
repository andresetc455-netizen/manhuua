// @vitest-environment node
// MangaDex nativo (backend): lista blanca de rutas y parámetros, validación de MangaDex@Home, SSRF,
// redirecciones, 429 con pausa, reportes y User-Agent. Sin red: `request` simulado.
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { sanitizeApi, atHomeHostOk, validateAtHome, createMangadex, mdConfig, pacer, UA } from './mangadex.mjs';
import { safeRequest } from './security.mjs';

const CH = '55555555-5555-4555-8555-000000000001';
const MID = '11111111-1111-4111-8111-000000000001';
const res = (status, body = '', headers = {}) => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: h, get: (n) => h[n.toLowerCase()], body: Readable.from([Buffer.from(typeof body === 'string' ? body : body)]) };
};
const PROD = mdConfig({}, { allowPrivate: false });
const goodAtHome = (baseUrl = 'https://abc123.xyz.mangadex.network:443') => ({ result: 'ok', baseUrl, chapter: { hash: 'a'.repeat(32), data: ['1-x.png', '2-y.png'], dataSaver: ['1-x.jpg', '2-y.jpg'] } });

/** Servidor HTTP simulado de pruebas: invoca el manejador y devuelve {status, headers, body}. */
async function call(md, path) {
  const u = new URL(path, 'http://localhost');
  const out = {};
  await md.handle({}, u, {}, { 'access-control-allow-origin': '*' }, (_, code, headers, body) => Object.assign(out, { status: code, headers, body }));
  if (/json/.test(out.headers['content-type'])) out.json = JSON.parse(out.body);
  return out;
}

describe('configuración', () => {
  it('en producción ignora los reemplazos de prueba (MD_API_BASE, MD_TEST_HOSTS)', () => {
    const c = mdConfig({ MD_API_BASE: 'http://127.0.0.1:1', MD_TEST_HOSTS: 'evil.test', MD_UPLOADS_BASE: 'http://x' }, { allowPrivate: false });
    expect(c).toMatchObject({ test: false, api: 'https://api.mangadex.org', uploads: 'https://uploads.mangadex.org', report: 'https://api.mangadex.network/report', testHosts: [] });
    expect(c.perSec).toBeLessThanOrEqual(5);
    expect(mdConfig({ MD_PER_SEC: '50' }).perSec).toBe(5);
  });
  it('User-Agent propio e identificable (no imita un navegador)', () => {
    expect(UA).toMatch(/^Manhuua\/\d/);
    expect(UA).not.toMatch(/Mozilla|Chrome|Safari/);
  });
});

describe('lista blanca de la API', () => {
  it('rutas permitidas y rechazadas', () => {
    expect(sanitizeApi('/manga', new URLSearchParams('title=x')).kind).toBe('list');
    expect(sanitizeApi(`/manga/${MID}`, new URLSearchParams()).kind).toBe('manga');
    expect(sanitizeApi(`/manga/${MID}/feed`, new URLSearchParams()).kind).toBe('feed');
    for (const p of ['/user/me', '/auth/login', '/manga/../user', `/manga/${MID}/../../x`, '/at-home/server/' + CH, 'https://evil.test/manga', '//evil.test/manga', '/manga?x=1', '/chapter', '/report'])
      expect(() => sanitizeApi(p, new URLSearchParams()), p).toThrow(/no permitida/);
  });
  it('parámetros: desconocidos o inválidos se rechazan; nunca contenido pornographic; safe+suggestive por defecto', () => {
    expect(() => sanitizeApi('/manga', new URLSearchParams('url=http://x'))).toThrow(/no permitido/);
    expect(() => sanitizeApi('/manga', new URLSearchParams('ids[]=no-uuid'))).toThrow(/no permitido/);
    expect(() => sanitizeApi('/manga', new URLSearchParams('order[title]=drop'))).toThrow();
    const a = new URLSearchParams(sanitizeApi('/manga', new URLSearchParams('contentRating[]=safe&contentRating[]=pornographic')).qs);
    expect(a.getAll('contentRating[]')).toEqual(['safe']);
    const b = new URLSearchParams(sanitizeApi('/manga', new URLSearchParams('title=x')).qs);
    expect(b.getAll('contentRating[]')).toEqual(['safe', 'suggestive']);
  });
  it('límites de paginación: limit ≤ 100 en /manga, ≤ 500 en feed; offset+limit ≤ 10000', () => {
    expect(new URLSearchParams(sanitizeApi('/manga', new URLSearchParams('limit=500')).qs).get('limit')).toBe('100');
    expect(new URLSearchParams(sanitizeApi(`/manga/${MID}/feed`, new URLSearchParams('limit=500')).qs).get('limit')).toBe('500');
    expect(() => sanitizeApi('/manga', new URLSearchParams('limit=24&offset=9990'))).toThrow(/10.000/);
  });
});

describe('MangaDex@Home', () => {
  it('solo uploads.mangadex.org o *.mangadex.network por HTTPS', () => {
    for (const ok of ['https://uploads.mangadex.org', 'https://a1b2.c3d4.mangadex.network', 'https://x.mangadex.network/']) expect(atHomeHostOk(ok, PROD), ok).toBe(true);
    for (const bad of ['http://uploads.mangadex.org', 'https://uploads.mangadex.org:8443', 'https://mangadex.network.evil.test', 'https://evilmangadex.network', 'https://uploads.mangadex.org.evil.test',
      'https://user:pw@x.mangadex.network', 'https://169.254.169.254', 'http://127.0.0.1', 'https://[::1]', 'https://x.mangadex.network?u=http://evil', 'javascript:alert(1)', 'nada'])
      expect(atHomeHostOk(bad, PROD), bad).toBe(false);
  });
  it('valida hash y archivos; un servidor no autorizado se rechaza con el destino', () => {
    expect(validateAtHome(goodAtHome('https://x.mangadex.network'), PROD).hash).toBe('a'.repeat(32));
    expect(() => validateAtHome({ ...goodAtHome(), baseUrl: 'https://evil.test' }, PROD)).toThrow(/no autorizado \(evil\.test\)/);
    expect(() => validateAtHome({ ...goodAtHome('https://x.mangadex.network'), chapter: { hash: '../../etc', data: [] } }, PROD)).toThrow(/hash/);
    expect(() => validateAtHome({ ...goodAtHome('https://x.mangadex.network'), chapter: { hash: 'a'.repeat(32), data: ['../x.png'] } }, PROD)).toThrow(/archivo/);
    expect(() => validateAtHome({ result: 'error' }, PROD)).toThrow();
  });
});

describe('manejador /mangadex/*', () => {
  const mk = (handler, cfg = PROD) => { const log = []; const md = createMangadex({ cfg: { ...cfg, perSec: 1000 }, request: async (url, o) => { log.push({ url, ...o }); return handler(url, o, log); } }); return { md, log }; };

  it('página: pide at-home, valida y descarga con User-Agent propio; reporta en servidores *.mangadex.network', async () => {
    const { md, log } = mk((url) => (/at-home/.test(url) ? res(200, JSON.stringify(goodAtHome('https://n1.mangadex.network'))) : /report/.test(url) ? res(200, '{}') : res(200, Buffer.from('img'), { 'content-type': 'image/png', 'x-cache': 'HIT from x' })));
    const r = await call(md, `/mangadex/page?chapter=${CH}&quality=data&file=1-x.png`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(log[0].url).toBe(`https://api.mangadex.org/at-home/server/${CH}`);
    expect(log[1].url).toBe(`https://n1.mangadex.network/data/${'a'.repeat(32)}/1-x.png`);
    expect(log.every((l) => l.headers['user-agent'] === UA && !l.headers.via)).toBe(true);
    await new Promise((s) => setTimeout(s, 10));
    const rep = log.find((l) => /report/.test(l.url));
    expect(rep.url).toBe('https://api.mangadex.network/report');
    expect(rep.method).toBe('POST');
    expect(JSON.parse(rep.body)).toMatchObject({ url: log[1].url, success: true, cached: true, bytes: 3 });
    // segunda página del mismo capítulo: at-home cacheado (no se gasta el límite de 40/min)
    await call(md, `/mangadex/page?chapter=${CH}&quality=data&file=2-y.png`);
    expect(log.filter((l) => /at-home/.test(l.url)).length).toBe(1);
  });
  it('archivo que no está en la lista del capítulo → 404 sin pedir nada al servidor de imágenes', async () => {
    const { md, log } = mk(() => res(200, JSON.stringify(goodAtHome('https://n1.mangadex.network'))));
    const r = await call(md, `/mangadex/page?chapter=${CH}&quality=data&file=9-z.png`);
    expect(r.status).toBe(404);
    expect(log.filter((l) => /network\/data/.test(l.url))).toHaveLength(0);
  });
  it('parámetros inválidos (archivo con ruta, calidad, UUID) → 400', async () => {
    const { md } = mk(() => res(500));
    for (const q of [`chapter=${CH}&quality=data&file=../../x.png`, `chapter=${CH}&quality=raw&file=1.png`, 'chapter=abc&quality=data&file=1.png', `chapter=${CH}&quality=data&file=x.svg`])
      expect((await call(md, '/mangadex/page?' + q)).status, q).toBe(400);
  });
  it('servidor at-home no autorizado o redirección de la imagen → rechazado (no se sigue)', async () => {
    const evil = mk((url) => (/at-home/.test(url) ? res(200, JSON.stringify({ ...goodAtHome(), baseUrl: 'https://169.254.169.254' })) : res(200, 'x', { 'content-type': 'image/png' })));
    const a = await call(evil.md, `/mangadex/page?chapter=${CH}&quality=data&file=1-x.png`);
    expect(a.status).toBe(502); expect(a.json.error).toMatch(/no autorizado/); expect(a.headers['x-manhuua-blocked-url']).toBe('https://169.254.169.254');
    expect(evil.log.some((l) => /169\.254/.test(l.url))).toBe(false);
    const red = mk((url) => (/at-home/.test(url) ? res(200, JSON.stringify(goodAtHome('https://n1.mangadex.network'))) : /report/.test(url) ? res(200) : res(302, '', { location: 'http://evil.test/x.png' })));
    const b = await call(red.md, `/mangadex/page?chapter=${CH}&quality=data&file=1-x.png`);
    expect(b.status).toBe(502); expect(b.json.error).toMatch(/Redirección no permitida/);
    expect(red.log.some((l) => /evil/.test(l.url))).toBe(false);
    // tras la falla se pide un servidor nuevo una sola vez
    expect(red.log.filter((l) => /at-home/.test(l.url)).length).toBe(2);
  });
  it('429 de MangaDex: respeta X-RateLimit-Retry-After y no vuelve a consultar durante la pausa', async () => {
    const until = Math.floor(Date.now() / 1000) + 40;
    const { md, log } = mk(() => res(429, '{"result":"error"}', { 'x-ratelimit-retry-after': String(until) }));
    const a = await call(md, '/mangadex/api?path=/manga&title=a');
    expect(a.status).toBe(429); expect(+a.headers['retry-after']).toBeGreaterThan(30); expect(a.headers['x-upstream']).toBe('mangadex');
    const b = await call(md, '/mangadex/api?path=/manga&title=b');
    expect(b.status).toBe(429);
    expect(log).toHaveLength(1);
  });
  it('403 y API caída se informan como respuesta de MangaDex (no del backend)', async () => {
    const f = mk(() => res(403, '{"result":"error","errors":[{"detail":"banned"}]}'));
    const a = await call(f.md, '/mangadex/api?path=/manga');
    expect(a.status).toBe(403); expect(a.headers['x-upstream']).toBe('mangadex'); expect(a.headers['x-manhuua-error']).toBeUndefined();
    const g = mk(() => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); });
    expect((await call(g.md, '/mangadex/api?path=/manga')).status).toBe(502);
  });
  it('obra pornographic → 451; en listas se filtra; respuestas cacheadas y pedidos iguales unidos', async () => {
    const list = { result: 'ok', data: [{ id: MID, attributes: { contentRating: 'safe' } }, { id: CH, attributes: { contentRating: 'pornographic' } }], total: 2 };
    const { md, log } = mk((url) => res(200, JSON.stringify(/\/manga\?/.test(url) ? list : { result: 'ok', data: { id: MID, attributes: { contentRating: 'pornographic' } } })));
    expect((await call(md, `/mangadex/api?path=/manga/${MID}`)).status).toBe(451);
    const [a, b] = await Promise.all([call(md, '/mangadex/api?path=/manga&title=z'), call(md, '/mangadex/api?path=/manga&title=z')]);
    expect(a.json.data.map((x) => x.id)).toEqual([MID]); expect(b.json.data).toHaveLength(1);
    await call(md, '/mangadex/api?path=/manga&title=z');
    expect(log.filter((l) => /title=z/.test(l.url))).toHaveLength(1);
  });
  it('portadas: solo uploads.mangadex.org/covers/{id}/{archivo}[.256|.512.jpg], sin redirecciones', async () => {
    const { md, log } = mk(() => res(200, 'c', { 'content-type': 'image/jpeg' }));
    expect((await call(md, `/mangadex/cover?manga=${MID}&file=abc.png&size=256`)).status).toBe(200);
    expect(log[0].url).toBe(`https://uploads.mangadex.org/covers/${MID}/abc.png.256.jpg`);
    expect((await call(md, `/mangadex/cover?manga=${MID}&file=abc.png&size=999`)).status).toBe(400);
    const r = mk(() => res(301, '', { location: 'https://evil.test/c.png' }));
    expect((await call(r.md, `/mangadex/cover?manga=${MID}&file=abc.png&size=512`)).status).toBe(502);
  });
  it('SSRF: con la petición real (safeRequest) un destino interno se bloquea aunque venga de una configuración de prueba', async () => {
    const md = createMangadex({ cfg: { ...PROD, api: 'http://169.254.169.254' }, request: safeRequest, allowPrivate: false, timeoutMs: 2000 });
    const r = await call(md, '/mangadex/api?path=/manga');
    expect(r.status).toBe(403);
  });
});

describe('ritmo', () => {
  it('pacer: respeta peticiones por segundo y concurrencia; cola llena → 503', async () => {
    const p = pacer({ perSec: 20, concurrency: 2, maxQueue: 3 });
    const t = []; let act = 0, peak = 0;
    const job = () => p(async () => { act++; peak = Math.max(peak, act); t.push(Date.now()); await new Promise((s) => setTimeout(s, 30)); act--; });
    const all = [job(), job(), job()];
    await expect(Promise.all([job(), job()])).rejects.toMatchObject({ code: 503 });
    await Promise.allSettled(all);
    expect(peak).toBeLessThanOrEqual(2);
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(45);
  });
});
