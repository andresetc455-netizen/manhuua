// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAt, getAllAt, fill, validateManifest, mBrowse, mDetail, mPages, normHost, allowedUrl } from './sources/manifest.js';
import { normTitle, compareWorks, groupWorks } from './unify.js';
import { classify } from './sources/engine.js';
import { equivalent, sourceKey } from './online.js';

const B = 'https://api.test';
const M = {
  manhuua: 1, id: 'demo', name: 'Demo', version: '1.0.0', baseUrl: B, hosts: ['cdn.test'],
  catalog: { url: '{base}/series?page={page}', list: 'data', limit: 2, total: 'total', fields: { id: 'id', title: 'attributes.title.es|attributes.title.en|attributes.title.*', altTitles: 'attributes.alt[]', cover: '{base}/covers/{.id}/{.relationships[type=cover].file}', author: 'relationships[type=author].name', status: 'attributes.status', genres: 'attributes.tags[].name', ids: { al: 'links.al' } } },
  search: { url: '{base}/series?q={q}&page={page}' },
  detail: { url: '{base}/series/{id}', root: 'data' },
  chapters: { url: '{base}/series/{id}/chapters?offset={offset}', limit: 2, list: 'data', total: 'total', filter: { lang: 'es' }, fields: { id: 'id', number: 'num', title: 'name', date: 'at' } },
  pages: { url: '{base}/at-home/{chapterId}', list: 'chapter.data[]', image: '{$.baseUrl}/data/{$.chapter.hash}/{.}' },
};
const ext = { id: 'x1', type: 'manifest', manifest: M, url: B, name: 'Demo', version: '1.0.0' };
const series = (id, title, extra = {}) => ({ id, attributes: { title: { en: title }, alt: extra.alt || [], status: 'ongoing', tags: [{ name: 'Acción' }] }, relationships: [{ type: 'cover', file: `${id}.jpg` }, { type: 'author', name: extra.author || 'Kim' }], links: extra.al ? { al: extra.al } : {} });
const routes = {
  '/series?page=1': { data: [series('s1', 'Jade Road', { alt: ['Camino de Jade'], al: '111' }), { id: 'bad id!', attributes: {} }], total: 3 },
  '/series?page=2': { data: [series('s2', 'Iron Sky')], total: 3 },
  '/series/s1': { data: series('s1', 'Jade Road', { alt: ['Camino de Jade'] }) },
  '/series/s1/chapters?offset=0': { data: [{ id: 'c1', num: '1', name: '', at: '2026-01-02T00:00:00Z', lang: 'es' }, { id: 'c1en', num: '1', lang: 'en' }], total: 4 },
  '/series/s1/chapters?offset=2': { data: [{ id: 'c2', num: '2', name: 'El paso', at: '2026-01-09', lang: 'es' }, { id: 'c3', num: '3', lang: 'es' }], total: 4 },
  '/at-home/c1': { baseUrl: 'https://cdn.test', chapter: { hash: 'h1', data: ['1.png', '2.png'] } },
};
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (u) => {
    const url = new URL(u);
    if (url.pathname === '/blocked') return new Response('no', { status: 403 });
    const body = routes[url.pathname + url.search];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nf', { status: 404 });
  }));
});

describe('rutas y plantillas', () => {
  it('rutas con [], filtros, alternativas y comodín', () => {
    const o = { a: [{ t: 'x', n: 1 }, { t: 'y', n: 2 }], m: { en: 'E' } };
    expect(getAllAt(o, 'a[].n')).toEqual([1, 2]);
    expect(getAt(o, 'a[t=y].n')).toBe(2);
    expect(getAt(o, 'm.es|m.*')).toBe('E');
    expect(fill('{base}/s/{.id}', { base: B }, { id: 'k' })).toBe(`${B}/s/k`);
    expect(fill('{base}/s/{.falta}', { base: B }, {})).toBe(null); // nunca inventa una URL
  });
  it('valida el manifiesto', () => {
    expect(validateManifest(M)).toEqual([]);
    expect(validateManifest({ manhuua: 1, id: 'X Y' }).length).toBeGreaterThan(3);
  });
});

describe('extensión JSON (manifiesto)', () => {
  it('catálogo validado, con portada, autor, IDs y paginación', async () => {
    const r = await mBrowse(ext, { page: 1 });
    expect(r.items).toHaveLength(1); // el elemento sin id/título válido se descarta
    expect(r.items[0]).toMatchObject({ url: 'mf:demo/s/s1', title: 'Jade Road', altTitles: ['Camino de Jade'], cover: `${B}/covers/s1/s1.jpg`, author: 'Kim', status: 'En curso', genres: ['Acción'], ids: { al: '111' } });
    expect(r.diag.dropped).toBe(1);
    expect(r.next).toBeTruthy();
    expect((await mBrowse(ext, { page: 2 })).next).toBe(null); // total alcanzado
  });
  it('capítulos de varias páginas, filtrados por idioma, sin duplicar', async () => {
    const d = await mDetail(ext, 'mf:demo/s/s1');
    expect(d.chapters.map((c) => [c.number, c.url])).toEqual([[1, 'mf:demo/c/c1'], [2, 'mf:demo/c/c2'], [3, 'mf:demo/c/c3']]);
    expect(d.chapters[0].date).toBe('2026-01-02');
    expect(d.chapters[1].title).toBe('Capítulo 2: El paso');
    expect(d.diag.pages).toBe(2);
  });
  it('páginas con plantilla sobre la respuesta', async () => {
    expect(await mPages(ext, 'mf:demo/c/c1')).toEqual(['https://cdn.test/data/h1/1.png', 'https://cdn.test/data/h1/2.png']);
  });
  it('fuente 404 y dominio no permitido', async () => {
    const r = await mDetail(ext, 'mf:demo/s/nada');
    expect(r.chapters).toEqual([]);
    expect(classify(r.diag).state).toBe('notfound');
    const evil = { ...ext, manifest: { ...M, catalog: { ...M.catalog, url: 'https://otro.test/x' } } };
    const e = await mBrowse(evil);
    expect(classify(e.diag).state).toBe('incompatible');
  });
});

describe('clasificación de errores', () => {
  const at = (a) => ({ attempts: [a] });
  it('distingue bloqueo, no disponible, límite, backend, CORS e incompatibles', () => {
    expect(classify({ ...at({ ok: false, status: 403, source: 'site' }) })).toMatchObject({ state: 'blocked', label: 'Fuente bloqueada (403)', kind: 'source' });
    expect(classify({ ...at({ ok: false, status: 403, source: 'site', challenge: true }) }).kind).toBe('antibot');
    expect(classify({ ...at({ ok: false, status: 404, source: 'site' }) }).state).toBe('notfound');
    expect(classify({ ...at({ ok: false, status: 429, source: 'site' }) }).state).toBe('limited');
    expect(classify({ ...at({ ok: false, status: 503, source: 'backend' }) })).toMatchObject({ state: 'conn', kind: 'backend' });
    expect(classify({ ...at({ ok: false, via: 'directo', error: 'bloqueado (CORS o red)', source: 'network' }) }).kind).toBe('cors');
    expect(classify({ ...at({ ok: false, via: 'proxy propio', error: 'sin conexión', source: 'network' }) })).toMatchObject({ state: 'conn', kind: 'network' });
    expect(classify({ ...at({ ok: true, status: 200 }), incompatible: true }).state).toBe('incompatible');
    expect(classify({ ...at({ ok: true, status: 200 }), count: 4 }).state).toBe('ok');
  });
});

describe('duplicados', () => {
  it('normaliza títulos', () => expect(normTitle('¡Él, Rey  Dragón!')).toBe('el rey dragon'));
  it('misma obra en dos fuentes (título alternativo)', () => {
    expect(compareWorks({ title: 'Camino de Jade', author: 'Kim' }, { title: 'Jade Road', altTitles: ['Camino de Jade'], author: 'Kim' })).toBe('same');
  });
  it('títulos parecidos de obras distintas no se fusionan', () => {
    expect(compareWorks({ title: 'Tower of God' }, { title: 'Tower of God: Urek' })).toBe('maybe');
    expect(compareWorks({ title: 'Dragon King', author: 'Ana' }, { title: 'Dragon King', author: 'Bo' })).toBe('maybe');
    expect(compareWorks({ title: 'Jade', ids: { al: '1' } }, { title: 'Jade', ids: { al: '2' } })).toBe('different');
    expect(compareWorks({ title: 'Blue Lake' }, { title: 'Red Fire' })).toBe('different');
  });
  it('agrupa, conserva posibles duplicados y respeta correcciones manuales', () => {
    const A = { id: 'a', name: 'A' }, C = { id: 'c', name: 'C' };
    const e = [{ ext: A, item: { url: 'a1', title: 'Jade Road', author: 'Kim' } }, { ext: C, item: { url: 'c1', title: 'Camino de Jade', altTitles: ['Jade Road'], author: 'Kim' } }, { ext: C, item: { url: 'c2', title: 'Jade Road Returns' } }];
    const g = groupWorks(e, { links: [], splits: [] });
    expect(g).toHaveLength(2);
    expect(g[0].sources).toHaveLength(2);
    expect(g[0].maybe.map((m) => m.key)).toEqual(['c|c2']);
    expect(groupWorks(e, { links: [], splits: [['a|a1', 'c|c1']] })).toHaveLength(3);
    expect(groupWorks(e, { links: [['a|a1', 'c|c2']], splits: [] })[0].sources).toHaveLength(3);
  });
});

describe('cambio de fuente', () => {
  const s = { extId: 'A' };
  const list = [{ id: '1', number: 1, url: 'a/1' }, { id: '2', number: 2, url: 'a/2' }, { id: 'b1', number: 1, sourceId: 'B', url: 'b/1' }, { id: 'b3', number: 3, sourceId: 'B', url: 'b/3' }, { id: 'L', number: 9 }];
  it('equivalencia exacta por número y confirmación cuando no la hay', () => {
    expect(sourceKey(list[0], s)).toBe('A');
    expect(sourceKey(list[4], s)).toBe('local');
    expect(equivalent(list[0], list, s, 'B')).toMatchObject({ exact: true, chapter: { id: 'b1' } });
    const r = equivalent(list[1], list, s, 'B');
    expect(r.exact).toBe(false);
    expect(r.reason).toMatch(/no hay capítulo 2/);
  });
});

describe('seguridad: dominios autorizados (hosts)', () => {
  const base = { ...M };
  const errsFor = (hosts) => validateManifest({ ...base, hosts });
  it('rechaza hosts malformados o peligrosos', () => {
    for (const bad of ['com', '*', '*.com', '*.co.uk', 'co.uk', 'com.ar', 'localhost', '1.2.3.4', '*.1.2.3.4', 'http://x.com', 'x.com/ruta', 'a*b.com', '*.*.x.com', 'x..com', '-x.com', 'user@x.com', '', ' ', 'x.com:99999'])
      expect(errsFor([bad]).length, bad).toBeGreaterThan(0);
    for (const notList of ['cdn.x.com', 'com', 5, { a: 1 }, null]) expect(errsFor(notList).length, String(notList)).toBeGreaterThan(0);
    expect(errsFor(Array(21).fill('a.x.com')).length).toBeGreaterThan(0);
  });
  it('acepta y normaliza dominios completos y comodines seguros', () => {
    expect(errsFor(['cdn.x.com', 'CDN.Ejemplo.org.', '*.mangadex.network', 'img.x.com:8443', 'xn--fiq228c.com'])).toEqual([]);
    expect(normHost('CDN.Ejemplo.org.')).toEqual({ host: 'cdn.ejemplo.org', wildcard: false });
    expect(normHost('*.mangadex.network')).toEqual({ host: 'mangadex.network', wildcard: true });
  });
  it('valida baseUrl, referer e icon', () => {
    expect(validateManifest({ ...base, baseUrl: 'javascript:alert(1)' }).length).toBeGreaterThan(0);
    expect(validateManifest({ ...base, baseUrl: 'https://u:p@api.test' }).length).toBeGreaterThan(0);
    expect(validateManifest({ ...base, baseUrl: '/relativa' }).length).toBeGreaterThan(0);
    expect(validateManifest({ ...base, referer: 'file:///etc/passwd' }).length).toBeGreaterThan(0);
    expect(validateManifest({ ...base, icon: 'data:image/svg+xml,<svg onload=alert(1)>' }).length).toBeGreaterThan(0);
  });
  it('solo permite el dominio de baseUrl y los de hosts (exactos o comodín de subdominio)', () => {
    const m = { baseUrl: 'https://api.x.com', hosts: ['cdn.x.com', '*.img.org', 'p.x.com:8443'] };
    expect(allowedUrl(m, 'https://api.x.com/a')).toBe(true);
    expect(allowedUrl(m, 'https://cdn.x.com/a.png')).toBe(true);
    expect(allowedUrl(m, 'https://s1.img.org/a.png')).toBe(true);
    expect(allowedUrl(m, 'https://p.x.com:8443/a')).toBe(true);
    expect(allowedUrl(m, 'https://img.org/a.png')).toBe(false); // el comodín no incluye el dominio raíz
    expect(allowedUrl(m, 'https://p.x.com/a')).toBe(false); // otro puerto
    expect(allowedUrl(m, 'https://otro.x.com/a')).toBe(false); // subdominio no declarado
    expect(allowedUrl(m, 'https://api.x.com.evil.com/a')).toBe(false);
    expect(allowedUrl(m, 'https://evilapi.x.com/a')).toBe(false);
    expect(allowedUrl(m, 'https://u:p@api.x.com/a')).toBe(false);
    expect(allowedUrl(m, 'javascript:alert(1)')).toBe(false);
    expect(allowedUrl(m, 'http://api.x.com/a')).toBe(false); // fuente HTTPS: no se baja a HTTP
    expect(allowedUrl(m, 'http://cdn.x.com/a.png')).toBe(false);
    expect(allowedUrl({ baseUrl: 'http://api.y.com' }, 'http://api.y.com/a')).toBe(true);
    expect(allowedUrl({ ...m, hosts: 'com' }, 'https://evil.com/')).toBe(false); // hosts inválido guardado: se ignora
    expect(allowedUrl({ ...m, hosts: ['com', '*'] }, 'https://evil.com/')).toBe(false);
  });
  it('bloquea peticiones, paginación, portadas e imágenes hacia dominios no autorizados', async () => {
    const noCdn = { ...ext, manifest: { ...M, hosts: [] } };
    await expect(mPages(noCdn, 'mf:demo/c/c1')).rejects.toThrow(/dominio no autorizado/);
    const evilCover = { ...ext, manifest: { ...M, catalog: { ...M.catalog, fields: { ...M.catalog.fields, cover: 'https://evil.test/{.id}.jpg' } } } };
    expect((await mBrowse(evilCover)).items[0].cover).toBe(null);
    routes['/series/s9'] = { data: series('s9', 'Nueve') };
    routes['/series/s9/chapters?offset=0'] = { data: [{ id: 'n1', num: 1, lang: 'es' }], next: 'https://evil.test/steal?offset=2' };
    const nextEvil = { ...ext, manifest: { ...M, chapters: { ...M.chapters, next: 'next' } } };
    const d = await mDetail(nextEvil, 'mf:demo/s/s9');
    expect(d.chapters).toHaveLength(1);
    expect(d.diag.pageError).toMatch(/otro dominio/);
    expect(fetch.mock.calls.some(([u]) => String(u).includes('evil.test'))).toBe(false);
  });
});

describe('seguridad: redirecciones en el navegador', async () => {
  const { fetchVia } = await import('./sources/web.js');
  const hosts = ['api.test', 'cdn.test'];
  it('acceso directo: una redirección no verificable se rechaza (no se sigue)', async () => {
    const f = vi.fn(async (u, o) => (o?.redirect === 'manual' ? { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } : new Response('{}')));
    vi.stubGlobal('fetch', f);
    await expect(fetchVia('https://api.test/a', 'text', undefined, undefined, { hosts })).rejects.toThrow(/redirecci[oó]n/i);
    expect(f.mock.calls[0][1]).toEqual({ redirect: 'manual' });
    expect(f.mock.calls.some(([u]) => /corsproxy|allorigins|codetabs/.test(u))).toBe(false); // sin proxies públicos
  });
  it('URL final fuera de la política o URL inicial no autorizada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Object.assign(new Response('{}'), {}) ));
    await expect(fetchVia('https://evil.test/a', 'text', undefined, undefined, { hosts })).rejects.toThrow(/no autorizado/);
    const r = new Response('{}'); Object.defineProperty(r, 'url', { value: 'https://evil.test/x' });
    vi.stubGlobal('fetch', vi.fn(async () => r));
    await expect(fetchVia('https://api.test/a', 'text', undefined, undefined, { hosts })).rejects.toThrow(/no declarado/);
  });
  it('diagnóstico: URL original, dominio de destino, motivo y dominio a agregar', async () => {
    const r = new Response('{}'); Object.defineProperty(r, 'url', { value: 'https://img.cdn2.test/p.png' });
    vi.stubGlobal('fetch', vi.fn(async () => r));
    const e = await fetchVia('https://cdn.test/p.png', 'blob', undefined, undefined, { hosts }).catch((x) => x);
    expect(e).toMatchObject({ policy: true, from: 'https://cdn.test/p.png', toHost: 'img.cdn2.test', reason: 'host', suggest: 'img.cdn2.test' });
    expect(e.message).toMatch(/https:\/\/cdn\.test\/p\.png → img\.cdn2\.test/);
    expect(e.message).toMatch(/agregá "img\.cdn2\.test" a "hosts"/);
  });
  it('sin política (extensiones web anteriores) el comportamiento no cambia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hola')));
    expect(await fetchVia('https://cualquiera.test/a')).toBe('hola');
  });
});
