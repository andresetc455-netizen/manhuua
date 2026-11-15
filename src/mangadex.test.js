// @vitest-environment happy-dom
// MangaDex nativo (frontend): búsqueda, catálogo, ficha, capítulos (orden, decimales, especiales,
// idiomas, grupos), páginas, 429, errores, identidad estable y regresión del resto de extensiones.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const MID = '11111111-1111-4111-8111-000000000001';
const manga = (i, extra = {}) => ({ id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, type: 'manga', attributes: {
  title: { en: `Obra ${i}` }, altTitles: [{ 'es-la': `Obra ${i} ES` }], description: { 'es-la': `Desc **${i}** [link](https://x)`, en: 'EN' },
  status: 'ongoing', year: 2021, contentRating: 'safe', originalLanguage: 'ko', availableTranslatedLanguages: ['es-la', 'en'],
  tags: [{ attributes: { name: { en: 'Action' }, group: 'genre' } }, { attributes: { name: { en: 'Long Strip' }, group: 'format' } }], ...extra },
  relationships: [{ type: 'author', attributes: { name: 'Autora' } }, { type: 'artist', attributes: { name: 'Artista' } }, { type: 'cover_art', attributes: { fileName: `c${i}.png` } }] });
const chap = (n, num, lang = 'es-la', group = 'Grupo A', extra = {}) => ({ id: `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`, attributes: { chapter: num, translatedLanguage: lang, pages: 5, publishAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00+00:00`, ...extra }, relationships: group ? [{ type: 'scanlation_group', attributes: { name: group } }] : [] });

let M, X, W, calls, routes;
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('manhuua.settings', JSON.stringify({ proxy: 'https://be.test/proxy?url=' }));
  vi.resetModules();
  calls = []; routes = [];
  vi.stubGlobal('fetch', vi.fn(async (u) => { calls.push(String(u)); const url = new URL(String(u)); for (const [re, fn] of routes) if (re.test(url.pathname + url.search)) return fn(url); return json({ error: 'sin ruta' }, 404); }));
  M = await import('./sources/mangadex.js');
  X = await import('./sources/extensions.js');
  W = await import('./sources/web.js');
});
const on = (re, fn) => routes.push([re, fn]);
const ext = () => X.getExtension(X.installNative('mangadex').id);
const qp = (u) => Object.fromEntries([...new Set(u.searchParams.keys())].map((k) => [k, k.endsWith('[]') ? u.searchParams.getAll(k) : u.searchParams.get(k)]));

describe('instalación e identidad', () => {
  it('se instala sin JSON, con id estable; reinstalar recupera el mismo id y no duplica', () => {
    const a = X.installNative('mangadex');
    expect(a).toMatchObject({ id: 'native-mangadex', type: 'mangadex', name: 'MangaDex' });
    expect(X.installNative('mangadex').id).toBe(a.id);
    expect(X.useExtensions).toBeTypeOf('function');
    X.removeExtension(a.id);
    const b = X.installNative('mangadex');
    expect(b.id).toBe(a.id);
    expect(JSON.parse(localStorage.getItem('manhuua.extensions')).filter((e) => e.type === 'mangadex')).toHaveLength(1);
    expect(X.identityOf(b)).toBe('native:mangadex');
  });
  it('dominios: capítulos y portadas md: usan el camino estricto (nunca un img remoto)', () => {
    const e = ext();
    expect(X.extHosts(e)).toEqual(['api.mangadex.org', 'uploads.mangadex.org']);
    expect(X.chapterHosts('md:chapter/x', e.id)).toEqual(X.extHosts(e));
    expect(X.extensionForUrl('md:chapter/x').id).toBe(e.id);
  });
});

describe('catálogo y búsqueda (1, 2, 3, 6, 7)', () => {
  it('1. búsqueda por título: una sola petición con includes[] (portada, autor, artista) y clasificación segura', async () => {
    on(/\/mangadex\/api/, () => json({ result: 'ok', data: [manga(1)], total: 1 }));
    const r = await X.browse(ext(), { query: 'torre' });
    expect(calls).toHaveLength(1);
    const p = qp(new URL(calls[0]));
    expect(p).toMatchObject({ path: '/manga', title: 'torre', 'order[relevance]': 'desc', 'includes[]': ['cover_art', 'author', 'artist'], 'contentRating[]': ['safe', 'suggestive'], 'availableTranslatedLanguage[]': ['es-la', 'es'] });
    expect(new URL(calls[0]).origin + new URL(calls[0]).pathname).toBe('https://be.test/mangadex/api');
    const w = r.items[0];
    expect(w).toMatchObject({ url: `md:manga/${MID}`, title: 'Obra 1', altTitles: ['Obra 1 ES'], author: 'Autora', artist: 'Artista', status: 'En curso', year: 2021, genres: ['Action'], type: 'manhwa', cover: `md:cover/${MID}/c1.png/256` });
    expect(w.description).toBe('Desc 1 link');
  });
  it('2. búsqueda sin resultados: lista vacía con motivo claro (no es error de conexión)', async () => {
    on(/\/mangadex\/api/, () => json({ result: 'ok', data: [], total: 0 }));
    const r = await X.browse(ext(), { query: 'nada' });
    expect(r.items).toEqual([]);
    expect(r.diag.reasons[0]).toMatch(/no tiene resultados para "nada"/);
    const { classify } = await import('./sources/engine.js');
    expect(classify(r.diag).state).toBe('extraction');
  });
  it('búsqueda por UUID o enlace de MangaDex → ids[]', async () => {
    on(/\/mangadex\/api/, () => json({ result: 'ok', data: [manga(1)], total: 1 }));
    await X.browse(ext(), { query: `https://mangadex.org/title/${MID}/la-torre` });
    expect(qp(new URL(calls[0]))['ids[]']).toEqual([MID]);
  });
  it('3. catálogo paginado (offset) hasta el total, sin pasar de 10.000', async () => {
    on(/\/mangadex\/api/, (u) => json({ result: 'ok', data: Array.from({ length: 24 }, (_, k) => manga(+u.searchParams.get('offset') + k + 1)), total: 30 }));
    const p1 = await X.browse(ext(), {});
    expect(p1.items).toHaveLength(24); expect(p1.next).toBeTruthy();
    expect(qp(new URL(calls[0]))).toMatchObject({ offset: '0', limit: '24', 'order[latestUploadedChapter]': 'desc' });
    const p2 = await X.browse(ext(), { page: 2 });
    expect(qp(new URL(calls[1])).offset).toBe('24');
    expect(p2.next).toBeNull();
    on(/./, () => json({ result: 'ok', data: [manga(1)], total: 99999 }));
    routes.reverse();
    expect((await X.browse(ext(), { page: 416 })).next).toBeNull(); // 416*24 > 10000
  });
  it('filtros: género, estado, tipo, idioma, orden y autor (resuelto por /author)', async () => {
    on(/path=%2Fauthor/, () => json({ result: 'ok', data: [{ id: '22222222-2222-4222-8222-000000000001', attributes: { name: 'Autora 1' } }] }));
    on(/path=%2Fmanga/, () => json({ result: 'ok', data: [], total: 0 }));
    await X.browse(ext(), { filters: { tag: '77777777-7777-4777-8777-000000000001', status: 'completed', type: 'manhua', lang: 'en', order: 'title', author: 'autora' } });
    const p = qp(new URL(calls.at(-1)));
    expect(p).toMatchObject({ 'includedTags[]': ['77777777-7777-4777-8777-000000000001'], 'status[]': ['completed'], 'originalLanguage[]': ['zh', 'zh-hk'], 'availableTranslatedLanguage[]': ['en'], 'order[title]': 'asc', authorOrArtist: '22222222-2222-4222-8222-000000000001' });
  });
  it('contenido erótico solo con la opción; explícito nunca', async () => {
    on(/\/mangadex\/api/, () => json({ result: 'ok', data: [], total: 0 }));
    const e = ext(); X.updateExtension(e.id, { options: { ...e.options, adult: true } });
    await X.browse(X.getExtension(e.id), {});
    expect(qp(new URL(calls[0]))['contentRating[]']).toEqual(['safe', 'suggestive', 'erotica']);
  });
});

describe('ficha y capítulos (4, 5, 6, 8, 9, 10, 7)', () => {
  const feed = [chap(1, '1'), chap(2, '2'), chap(3, '2.5'), chap(4, '10'), chap(5, '3'), chap(6, '3', 'es-la', 'Grupo B'), chap(7, null, 'es-la', 'Grupo A', { title: 'Especial' }), chap(8, 'Extra'), chap(9, '4', 'es-la', 'Oficial', { pages: 0, externalUrl: 'https://mangaplus.test/1' }), chap(10, '2', 'es', 'Grupo C')];
  const routesDetail = () => {
    on(/path=%2Fmanga%2F[^&]+%2Ffeed/, (u) => { const off = +u.searchParams.get('offset'); return json({ result: 'ok', data: feed.slice(off, off + +u.searchParams.get('limit')), total: feed.length }); });
    on(/path=%2Fmanga%2F/, () => json({ result: 'ok', data: manga(1) }));
  };
  it('4–6. ficha: título, alternativos, descripción en español, autor, artista, géneros, estado, año, clasificación y portada grande', async () => {
    routesDetail();
    const d = await X.seriesDetail(ext(), `md:manga/${MID}`);
    expect(d).toMatchObject({ title: 'Obra 1', author: 'Autora', artist: 'Artista', status: 'En curso', year: 2021, contentRating: 'safe', cover: `md:cover/${MID}/c1.png/512`, languages: ['es-la', 'en'], link: `https://mangadex.org/title/${MID}` });
    expect(d.description).toMatch(/^Desc 1/);
  });
  it('8–10. capítulos: decimales ordenados, especiales al final, externos excluidos e informados, un grupo por número', async () => {
    routesDetail();
    const d = await X.seriesDetail(ext(), `md:manga/${MID}`);
    const nums = d.chapters.map((c) => c.number);
    expect(nums.slice(0, 6)).toEqual([1, 2, 2, 2.5, 3, 10]); // 2 en es-la y 2 en es (otro idioma, no es duplicado)
    expect(nums.slice(6)).toEqual([null, null]); // especiales al final, ambos conservados
    expect(d.chapters.filter((c) => c.number === 3)).toHaveLength(1); // un grupo por número e idioma
    expect(d.chapters.find((c) => c.number === 3).group).toBe('Grupo A');
    expect(d.chapters.some((c) => c.number === 4)).toBe(false);
    expect(d.diag.reasons.join()).toMatch(/fuera de MangaDex/);
    const c1 = d.chapters[0];
    expect(c1).toMatchObject({ url: 'md:chapter/55555555-5555-4555-8555-000000000001', language: 'es-la', group: 'Grupo A', date: '2026-01-01', link: 'https://mangadex.org/chapter/55555555-5555-4555-8555-000000000001' });
    const feedCall = new URL(calls.find((c) => /feed/.test(decodeURIComponent(c))));
    expect(qp(feedCall)).toMatchObject({ limit: '500', 'translatedLanguage[]': ['es-la', 'es'], 'includes[]': ['scanlation_group'], 'order[volume]': 'asc', 'order[chapter]': 'asc' });
  });
  it('"todas las versiones" conserva cada grupo; elegir idioma filtra en la API', async () => {
    routesDetail();
    const e = ext(); X.updateExtension(e.id, { options: { ...e.options, groups: 'all' } });
    const d = await X.seriesDetail(X.getExtension(e.id), `md:manga/${MID}`);
    expect(d.chapters.filter((c) => c.number === 3).map((c) => c.group)).toEqual(['Grupo A', 'Grupo B']);
    calls.length = 0;
    await X.seriesDetail(X.getExtension(e.id), `md:manga/${MID}`, {}, { langs: ['en'] });
    expect(qp(new URL(calls.find((c) => /feed/.test(decodeURIComponent(c)))))['translatedLanguage[]']).toEqual(['en']);
  });
  it('feed paginado; si la API rechaza limit=500 se usa 100', async () => {
    const big = Array.from({ length: 230 }, (_, k) => chap(k + 1, String(k + 1), 'en', 'G'));
    on(/path=%2Fmanga%2F[^&]+%2Ffeed/, (u) => (+u.searchParams.get('limit') > 100 ? json({ result: 'error' }, 400) : json({ result: 'ok', data: big.slice(+u.searchParams.get('offset'), +u.searchParams.get('offset') + 100), total: 230 })));
    on(/path=%2Fmanga%2F/, () => json({ result: 'ok', data: manga(1) }));
    const d = await X.seriesDetail(ext(), `md:manga/${MID}`, {}, { langs: ['en'] });
    expect(d.chapters).toHaveLength(230);
    expect(d.diag.pages).toBe(3);
  });
  it('orden: números decimales y texto', () => {
    expect(M.chapterNumber('12.5')).toBe(12.5); expect(M.chapterNumber('Extra')).toBeNull(); expect(M.chapterNumber(null)).toBeNull(); expect(M.chapterNumber('1.2.3')).toBeNull();
    const s = M.sortChapters([{ number: 10 }, { number: 2.5 }, { number: null, date: '2026-02-01' }, { number: 2 }, { number: null, date: '2026-01-01' }]);
    expect(s.map((c) => c.number ?? c.date)).toEqual([2, 2.5, 10, '2026-01-01', '2026-02-01']);
  });
});

describe('lectura (11, 12)', () => {
  it('11. datos de MangaDex@Home → URLs internas md:page (calidad elegida, sin baseUrl en el navegador)', async () => {
    on(/\/mangadex\/chapter/, () => json({ hash: 'a'.repeat(32), data: ['1.png', '2.png'], dataSaver: ['1.jpg', '2.jpg'] }));
    const e = ext();
    const urls = await X.chapterImages('md:chapter/55555555-5555-4555-8555-000000000001', e.id);
    expect(urls).toEqual(['md:page/55555555-5555-4555-8555-000000000001/data-saver/1.jpg', 'md:page/55555555-5555-4555-8555-000000000001/data-saver/2.jpg']);
    X.updateExtension(e.id, { options: { ...e.options, quality: 'data' } });
    expect((await X.chapterImages('md:chapter/55555555-5555-4555-8555-000000000002', e.id))[0]).toMatch(/\/data\/1\.png$/);
  });
  it('12. fetchVia resuelve md:page por el backend propio (Blob), con la política estricta', async () => {
    on(/\/mangadex\/page/, () => new Response(new Blob(['img'], { type: 'image/png' })));
    const b = await W.fetchVia('md:page/55555555-5555-4555-8555-000000000001/data/1.png', 'blob', undefined, undefined, { hosts: ['api.mangadex.org'] });
    expect(b.type).toBe('image/png');
    expect(calls[0]).toBe('https://be.test/mangadex/page?chapter=55555555-5555-4555-8555-000000000001&quality=data&file=1.png');
    expect(calls.some((c) => /mangadex\.(org|network)/.test(c))).toBe(false); // nunca hotlink
  });
  it('capítulo externo / sin páginas: error claro', async () => {
    on(/\/mangadex\/chapter/, () => json({ hash: 'a'.repeat(32), data: [], dataSaver: [] }));
    await expect(X.chapterImages('md:chapter/55555555-5555-4555-8555-000000000003', ext().id)).rejects.toThrow(/no tiene páginas/);
  });
  it('desactivada o eliminada: no se lee en línea', async () => {
    const e = ext(); X.updateExtension(e.id, { enabled: false });
    await expect(X.chapterImages('md:chapter/x', e.id)).rejects.toThrow(/desactivada/);
    X.removeExtension(e.id);
    await expect(X.chapterImages('md:chapter/x', e.id)).rejects.toThrow(/ya no está instalada/);
  });
});

describe('errores y límites (19, 20, 21)', () => {
  it('19. 429: diagnóstico "limitada", y el navegador espera Retry-After sin volver a pedir', async () => {
    on(/\/mangadex\/api/, () => json({ error: 'MangaDex limitó', retryAfter: 30 }, 429, { 'retry-after': '30', 'x-upstream': 'mangadex' }));
    const r = await X.browse(ext(), { query: 'x' });
    const { classify } = await import('./sources/engine.js');
    expect(classify(r.diag)).toMatchObject({ state: 'limited', httpStatus: 429 });
    expect(r.diag.reasons[0]).toMatch(/30 s/);
    const n = calls.length;
    const r2 = await X.browse(ext(), { query: 'y' });
    expect(calls.length).toBe(n);
    expect(r2.diag.reasons[0]).toMatch(/429/);
    expect(M.mdCooling()).toBeGreaterThan(25);
  });
  it('20. 403 de MangaDex: "bloqueada por la fuente", no falla de Manhuua', async () => {
    on(/\/mangadex\/api/, () => json({ error: 'MangaDex HTTP 403' }, 403, { 'x-upstream': 'mangadex' }));
    const r = await X.browse(ext(), {});
    const { classify } = await import('./sources/engine.js');
    expect(classify(r.diag)).toMatchObject({ state: 'blocked', kind: 'source' });
  });
  it('21. API o backend caídos: conexión, sin excepción', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const r = await X.browse(ext(), {});
    expect(r.items).toEqual([]);
    const { classify } = await import('./sources/engine.js');
    expect(classify(r.diag).state).toBe('conn');
  });
  it('sin backend propio: mensaje explicativo (MangaDex no permite CORS)', async () => {
    localStorage.setItem('manhuua.settings', JSON.stringify({ proxy: '' }));
    const r = await X.browse(ext(), {});
    expect(r.diag.reasons[0]).toMatch(/necesita el backend propio/);
  });
  it('22. redirección/servidor no autorizado informado por el backend → error de política', async () => {
    on(/\/mangadex\/page/, () => json({ error: 'Servidor de imágenes no autorizado (evil.test)' }, 502, { 'x-manhuua-error': '1', 'x-manhuua-blocked-url': 'https://evil.test', 'x-manhuua-blocked-reason': 'host' }));
    await expect(W.fetchVia('md:page/55555555-5555-4555-8555-000000000001/data/1.png', 'blob')).rejects.toMatchObject({ policy: true, status: 502 });
  });
  it('pedidos iguales simultáneos se unen; concurrencia máxima 3; una búsqueda cancelada no sale', async () => {
    let active = 0, peak = 0;
    on(/\/mangadex\/api/, async () => { active++; peak = Math.max(peak, active); await new Promise((s) => setTimeout(s, 20)); active--; return json({ result: 'ok', data: [], total: 0 }); });
    await Promise.all([M.mdCall('api', { path: '/manga', title: 'a' }), M.mdCall('api', { path: '/manga', title: 'a' })]);
    expect(calls).toHaveLength(1);
    await Promise.all(Array.from({ length: 8 }, (_, i) => M.mdCall('api', { path: '/manga', title: 'q' + i })));
    expect(peak).toBeLessThanOrEqual(3);
    const ctl = new AbortController();
    const ps = Array.from({ length: 6 }, (_, i) => M.mdCall('api', { path: '/manga', title: 'z' + i }, { signal: ctl.signal }).catch((e) => e));
    ctl.abort();
    const out = await Promise.all(ps);
    expect(out.filter((e) => e?.aborted).length).toBeGreaterThanOrEqual(3);
  });
});

describe('25. regresión: extensiones existentes', () => {
  it('manifiestos JSON siguen por su camino (mf:) y HTML no se toca', async () => {
    const man = { manhuua: 1, id: 'demo', name: 'Demo', version: '1.0.0', baseUrl: 'https://api.demo.test', catalog: { url: '{base}/s', list: 'data', fields: { id: 'id', title: 'title' } }, detail: { url: '{base}/s/{id}' }, chapters: { url: '{base}/s/{id}/c', list: 'data', fields: { id: 'id', number: 'n' } }, pages: { url: '{base}/p/{chapterId}', list: 'images[]' } };
    const a = await X.installManifest(man);
    expect(a.id).toBe('mf-demo');
    expect(X.extensionForUrl('mf:demo/c/1').id).toBe('mf-demo');
    expect(X.chapterHosts('mf:demo/c/1')).toEqual(['api.demo.test']);
    expect(X.chapterHosts('https://sitio.test/cap-1')).toBeUndefined();
    ext();
    expect(X.extensionForUrl('mf:demo/c/1').id).toBe('mf-demo');
  });
});
