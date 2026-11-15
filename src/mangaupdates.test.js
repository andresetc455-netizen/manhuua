// @vitest-environment happy-dom
// 25 plataformas: MangaUpdates (solo metadatos), enlaces de lectura oficial desde MangaDex, unión por
// ID externo, estados nuevos y directorio de plataformas. Pruebas SIMULADAS (fetch reemplazado).
import { describe, it, expect, vi, beforeEach } from 'vitest';

let U, X, M, P, calls, routes;
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
const rec = (id, extra = {}) => ({ series_id: id, title: `Serie ${id}`, url: `https://www.mangaupdates.com/series/${id.toString(36)}/serie`, description: 'Texto<br>con <b>HTML</b> <script>alert(1)</script>[i]bb[/i]', image: { url: { original: `https://cdn.mangaupdates.com/image/i${id}.jpg`, thumb: `https://cdn.mangaupdates.com/image/thumb/i${id}.jpg` } }, type: 'Manhwa', year: '2019', genres: [{ genre: 'Action' }, { genre: 'Fantasy' }], last_updated: { as_rfc3339: '2026-10-01T00:00:00+00:00' }, ...extra });
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('manhuua.settings', JSON.stringify({ proxy: 'https://be.test/proxy?url=' }));
  vi.resetModules();
  calls = []; routes = [];
  vi.stubGlobal('fetch', vi.fn(async (u) => { calls.push(String(u)); const url = new URL(String(u)); for (const [re, fn] of routes) if (re.test(url.pathname + url.search)) return fn(url); return json({ error: 'sin ruta' }, 404); }));
  U = await import('./sources/mangaupdates.js'); X = await import('./sources/extensions.js'); M = await import('./sources/mangadex.js'); P = await import('./sources/platforms.js');
});
const on = (re, fn) => routes.push([re, fn]);
const mu = () => X.getExtension(X.installNative('mangaupdates').id);

describe('MangaUpdates (solo metadatos)', () => {
  it('instalar, identidad estable al reinstalar y desinstalar sin tocar la biblioteca', () => {
    const a = mu(); expect(a).toMatchObject({ type: 'mangaupdates', native: true, metadataOnly: true, name: 'MangaUpdates' });
    X.removeExtension(a.id); const b = mu(); expect(b.id).toBe(a.id);
    expect(X.installNative('mangaupdates').id).toBe(a.id); // no se duplica
  });
  it('sin texto no hay catálogo y no se pide nada', async () => {
    const r = await X.browse(mu(), {});
    expect(r.items).toEqual([]); expect(r.diag.searchOnly).toBe(true); expect(calls).toHaveLength(0);
  });
  it('búsqueda por el backend: obras con portada interna, tipo, géneros, total y paginación', async () => {
    on(/\/mangaupdates\/search/, (u) => json({ total_hits: 30, page: +u.searchParams.get('page'), per_page: 24, results: [{ record: rec(54154624357), hit_title: 'x' }, { record: rec(2) }, { record: { title: 'sin id' } }, {}] }));
    const r = await X.browse(mu(), { query: 'solo' });
    expect(calls[0]).toMatch(/^https:\/\/be\.test\/mangaupdates\/search\?q=solo&page=1&perpage=24$/);
    expect(r.diag.reasons).toEqual([]); expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ url: 'mu:series/54154624357', type: 'manhwa', year: 2019, genres: ['Action', 'Fantasy'], metadataOnly: true, ids: { mangaupdates: '54154624357' }, cover: 'mu:cover/' + encodeURIComponent('https://cdn.mangaupdates.com/image/thumb/i54154624357.jpg') });
    expect(r.items[0].description).toBe('Texto\ncon HTML alert(1)bb');
    expect(r.total).toBe(30); expect(r.next).toBe('mu:search/2');
    const r2 = await X.browse(mu(), { query: 'solo', page: 2 });
    expect(r2.next).toBeNull();
  });
  it('ficha: autores/artistas, editoriales, estado y enlace; nunca capítulos', async () => {
    on(/\/mangaupdates\/series\?id=7$/, () => json(rec(7, { status: '3 Volumes (Ongoing)', authors: [{ name: 'Autora', type: 'Author' }, { name: 'Dibujante', type: 'Artist' }], associated: [{ title: 'Alt 1' }], publishers: [{ publisher_name: 'Pub', type: 'Original' }] })));
    const d = await X.seriesDetail(mu(), 'mu:series/7', {});
    expect(d).toMatchObject({ author: 'Autora', artist: 'Dibujante', status: 'En curso', altTitles: ['Alt 1'], chapters: [], metadataOnly: true, link: 'https://www.mangaupdates.com/series/7/serie', publishers: [['Pub', 'Original']] });
    expect(d.cover).toContain(encodeURIComponent('https://cdn.mangaupdates.com/image/i7.jpg'));
    expect((await X.seriesDetail(mu(), 'mu:series/../x', {})).diag.incompatible).toBe(true);
  });
  it('enlace a la obra solo si es de mangaupdates.com', () => {
    expect(U.muWork(rec(1, { url: 'https://evil.test/x' })).link).toBe('https://www.mangaupdates.com');
    expect(U.muWork(rec(1, { url: 'javascript:alert(1)' })).link).toBe('https://www.mangaupdates.com');
    expect(U.muWork(rec(1, { image: { url: { original: 'javascript:alert(1)' } } })).cover).toBeNull(); // el backend valida el resto (solo https://cdn.mangaupdates.com)
  });
  it('estado: "Funcionando · solo metadatos" al comprobar (búsqueda de prueba)', async () => {
    on(/\/mangaupdates\/search/, () => json({ total_hits: 1, results: [{ record: rec(3) }] }));
    on(/\/mangaupdates\/series/, () => json(rec(3)));
    const st = await X.checkExtension(mu().id);
    expect(st).toMatchObject({ state: 'metadata', label: 'Funcionando · solo metadatos', works: 1 });
    expect(st.chapterError).toBeUndefined();
    routes = []; on(/\/mangaupdates\/search/, () => json({ total_hits: 0, results: [] }));
    vi.resetModules(); X = await import('./sources/extensions.js');
    expect((await X.checkExtension(mu().id)).state).toBe('metadata'); // API responde bien aunque no haya resultados
  });
  it('errores 403, 404, 429 y 503 se informan con su estado; 429 pausa los pedidos', async () => {
    const { classify } = await import('./sources/engine.js');
    for (const [code, state] of [[403, 'blocked'], [404, 'notfound'], [503, 'unavailable'], [401, 'auth']]) {
      vi.resetModules(); routes = [];
      X = await import('./sources/extensions.js');
      on(/\/mangaupdates\/search/, () => json({ error: 'x' }, code));
      expect(classify((await X.browse(mu(), { query: 'q' })).diag).state).toBe(state);
    }
    routes = [];
    on(/\/mangaupdates\/search/, () => json({ error: 'lento' }, 429, { 'retry-after': '20' }));
    const r = await X.browse(mu(), { query: 'z' });
    expect(classify(r.diag).state).toBe('limited');
    const n = calls.length;
    await X.browse(mu(), { query: 'otra' });
    expect(calls.length).toBe(n); // durante la pausa no se vuelve a pedir
  });
  it('portadas "mu:cover/…" siempre por el backend (fetchVia)', async () => {
    on(/\/mangaupdates\/cover/, () => new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const W = await import('./sources/web.js');
    const b = await W.fetchVia('mu:cover/' + encodeURIComponent('https://cdn.mangaupdates.com/image/i1.jpg'), 'blob');
    expect(b.type).toBe('image/jpeg');
    expect(calls.at(-1)).toBe('https://be.test/mangaupdates/cover?url=' + encodeURIComponent('https://cdn.mangaupdates.com/image/i1.jpg'));
  });
});

describe('MangaDex: lectura oficial e IDs externos', () => {
  const md = (links) => M.mdWork({ id: '11111111-1111-4111-8111-000000000001', attributes: { title: { en: 'Obra' }, links, tags: [{ attributes: { name: { en: 'Long Strip' }, group: 'format' } }] }, relationships: [] });
  it('enlaces oficiales: solo HTTPS, rotulados con la plataforma conocida', () => {
    const w = md({ engtl: 'https://www.webtoons.com/en/fantasy/x/list?title_no=1', raw: 'https://comic.naver.com/webtoon/list?titleId=2', amz: 'https://amazon.test/x' });
    expect(w.officialLinks).toEqual([
      { url: 'https://www.webtoons.com/en/fantasy/x/list?title_no=1', kind: 'traducción oficial', platform: 'WEBTOON' },
      { url: 'https://comic.naver.com/webtoon/list?titleId=2', kind: 'edición original', platform: 'Naver Webtoon' }]);
    expect(md({ engtl: 'http://mangaplus.shueisha.co.jp/x', raw: 'javascript:alert(1)' }).officialLinks).toEqual([]);
    expect(md({ engtl: 'https://mangaplus.shueisha.co.jp/titles/1' }).officialLinks[0].platform).toBe('MANGA Plus');
    expect(w.webtoon).toBe(true);
  });
  it('IDs externos: AniList, MAL y MangaUpdates (solo el id nuevo en base 36)', () => {
    expect(M.externalIds({ al: '123', mal: '456', mu: 'pb8uwds' })).toEqual({ anilist: '123', mal: '456', mangaupdates: String(parseInt('pb8uwds', 36)) });
    expect(M.externalIds({ mu: '12345' })).toEqual({}); // id viejo: no se usa
    expect(M.externalIds({ al: 'x"><script>' })).toEqual({});
  });
  it('unificación: la misma obra en MangaDex y MangaUpdates se une por ID; títulos iguales con IDs distintos no', async () => {
    const { groupWorks } = await import('./unify.js');
    const id = 54154624357, md1 = { ...md({ mu: id.toString(36) }), title: 'Solo Leveling' };
    const mu1 = { ...U.muWork(rec(id)), title: 'Na Honjaman Level Up' }, mu2 = { ...U.muWork(rec(9)), title: 'Solo Leveling' };
    const g = groupWorks([{ ext: { id: 'md' }, item: md1 }, { ext: { id: 'mu' }, item: mu1 }, { ext: { id: 'mu' }, item: mu2 }], { links: [], splits: [] });
    const both = g.find((w) => w.sources.length === 2);
    expect(both.sources.map((s) => s.ext.id).sort()).toEqual(['md', 'mu']);
    expect(both.sources.find((s) => s.ext.id === 'mu').item.remoteId).toBe(String(id));
    expect(both.metadataOnly).toBeUndefined(); // tiene una fuente con lectura
    expect(g.find((w) => w.sources[0].item === mu2).sources).toHaveLength(1);
  });
});

describe('directorio de las 25 plataformas', () => {
  it('25 plataformas, una por id, con clasificación A–D y URL oficial HTTPS', () => {
    expect(P.PLATFORMS).toHaveLength(25);
    expect(new Set(P.PLATFORMS.map((p) => p.id)).size).toBe(25);
    for (const p of P.PLATFORMS) { expect(['A', 'B', 'C', 'D']).toContain(p.cls); expect(p.url).toMatch(/^https:\/\//); }
    expect(P.PLATFORMS.filter((p) => p.cls === 'A').map((p) => p.id)).toEqual(['mangadex']);
    expect(P.PLATFORMS.filter((p) => p.cls === 'B').map((p) => p.id)).toEqual(['mangaupdates']);
  });
  it('reconoce dominios y subdominios sin falsos positivos', () => {
    expect(P.platformOf('https://m.webtoons.com/es/x')?.id).toBe('webtoon');
    expect(P.platformOf('https://webtoons.com.evil.test/x')).toBeUndefined();
    expect(P.platformOf('https://notwebtoons.com/x')).toBeUndefined();
  });
});

describe('estados de conexión', () => {
  it('401 → autenticación requerida; 5xx de la fuente → API no disponible; backend caído → conexión', async () => {
    const { classify, STATES } = await import('./sources/engine.js');
    const at = (a) => ({ attempts: [a] });
    expect(classify(at({ ok: false, status: 401, source: 'site' })).state).toBe('auth');
    expect(classify(at({ ok: false, status: 502, source: 'site' })).label).toBe('API no disponible (502)');
    expect(classify(at({ ok: false, status: 503, source: 'backend' })).state).toBe('conn');
    expect(classify({ ...at({ ok: false, status: 503, source: 'site' }), challenge: true }).state).toBe('blocked');
    for (const k of ['ok', 'blocked', 'limited', 'auth', 'unavailable', 'metadata', 'external', 'unauthorized', 'disabled']) expect(STATES[k]).toBeTruthy();
  });
});
