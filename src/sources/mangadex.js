// MangaDex nativo (API oficial). Todo pasa por el backend propio (/mangadex/*): MangaDex no envía
// CORS, no permite hotlinking y exige un proxy con User-Agent real. El backend limita el ritmo,
// cachea y valida MangaDex@Home; acá se limita la concurrencia, se unen pedidos iguales, se respeta
// el 429 (Retry-After) y se normalizan los datos sin inventar nada. Ver docs/MANGADEX.md.
import { activeProxy } from './web.js';

export const MD_ID = 'native-mangadex';
export const MD_IDENTITY = 'native:mangadex';
export const MD_VERSION = '1.0.0';
/** Dominios de MangaDex (marcan las imágenes como "estrictas": nunca van a un img remoto). */
export const MD_HOSTS = ['api.mangadex.org', 'uploads.mangadex.org'];
export const MD_DEFAULTS = { langs: ['es-la', 'es'], quality: 'data-saver', adult: false, groups: 'one', order: 'number' };
export const MD_LANGS = { 'es-la': 'Español (Latinoamérica)', es: 'Español (España)', en: 'Inglés', 'pt-br': 'Portugués (Brasil)', fr: 'Francés', it: 'Italiano', de: 'Alemán', ja: 'Japonés', ko: 'Coreano', zh: 'Chino', 'zh-hk': 'Chino (HK)', ru: 'Ruso' };
export const MD_TYPES = { manga: ['ja'], manhwa: ['ko'], manhua: ['zh', 'zh-hk'] };
const STATUS = { ongoing: 'En curso', completed: 'Finalizado', hiatus: 'En pausa', cancelled: 'Cancelado' };
export const RATING = { safe: 'Apto', suggestive: 'Sugerente', erotica: 'Erótico', pornographic: 'Adulto explícito' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 24;

export const mdOptions = (ext) => ({ ...MD_DEFAULTS, ...(ext?.options || {}) });
export const mdExtensionBase = () => ({ type: 'mangadex', native: true, name: 'MangaDex', version: MD_VERSION, url: 'https://mangadex.org', searchUrl: 'native', icon: '' });
export const isMd = (url) => /^md:/.test(url || '');

/** Base del backend propio (BACKEND, mismo origen o un proxy de Ajustes que sea un backend Manhuua). */
export function mdBackend() {
  const m = activeProxy().match(/^(.*)\/proxy\?url=$/);
  return m ? m[1] : '';
}
const NO_BACKEND = 'MangaDex necesita el backend propio de Manhuua: su API no acepta pedidos directos desde el navegador (CORS) y exige un proxy. Configurá VITE_BACKEND_URL o usá npm run serve.';

// ---------------- red: concurrencia, caché, uniones y 429 ----------------
const MAX_ACTIVE = 3;
let active = 0; const queue = [];
const cache = new Map(); const inflight = new Map();
let coolUntil = 0;
export const mdCooling = () => Math.max(0, Math.ceil((coolUntil - Date.now()) / 1000));
function slot(signal) {
  return new Promise((res, rej) => {
    const go = () => { if (signal?.aborted) return rej(abortErr()); active++; res(); };
    if (active < MAX_ACTIVE) go(); else queue.push(go);
    signal?.addEventListener('abort', () => { const i = queue.indexOf(go); if (i >= 0) { queue.splice(i, 1); rej(abortErr()); } }, { once: true });
  });
}
const release = () => { active--; queue.shift()?.(); };
const abortErr = () => Object.assign(new Error('Cancelado'), { name: 'AbortError', aborted: true });

/** Una llamada al backend. as: 'json' | 'blob'. Registra el intento en `trace` (diagnóstico). */
export async function mdCall(route, params = {}, { as = 'json', ttl = 0, signal, trace } = {}) {
  const base = mdBackend();
  if (!base) { trace?.push({ via: 'backend MangaDex', ok: false, error: NO_BACKEND, source: 'backend' }); throw Object.assign(new Error(NO_BACKEND), { source: 'backend', noBackend: true }); }
  const qs = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v == null || v === '' ? [] : [[k, String(v)]])));
  const url = `${base}/mangadex/${route}?${qs}`;
  const hit = ttl && cache.get(url);
  if (hit && hit.exp > Date.now()) { trace?.push({ via: 'caché', ok: true, status: 200, ms: 0 }); return hit.v; }
  const wait = mdCooling();
  if (wait) { const e = Object.assign(new Error(`MangaDex limitó las peticiones: esperá ${wait} s antes de reintentar.`), { status: 429, source: 'site', retryAfter: wait }); trace?.push({ via: 'backend MangaDex', ok: false, status: 429, source: 'site', error: e.message }); throw e; }
  const key = as + ' ' + url;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    await slot(signal);
    const t0 = performance.now(); const rec = { via: 'backend MangaDex', ok: false };
    try {
      let res;
      try { res = await fetch(url, { signal }); }
      catch (e) { if (e.name === 'AbortError') throw abortErr(); rec.source = 'network'; throw Object.assign(new Error('El backend no respondió (sin conexión o dormido).'), { source: 'network' }); }
      rec.status = res.status;
      if (!res.ok) {
        let body = {}; try { body = await res.json(); } catch {}
        const own = !!res.headers.get('x-manhuua-error');
        rec.source = res.headers.get('x-manhuua-blocked-url') ? 'policy' : own ? 'backend' : 'site';
        const ra = +res.headers.get('retry-after') || body.retryAfter;
        if (res.status === 429 && ra) coolUntil = Math.max(coolUntil, Date.now() + Math.min(ra, 900) * 1000);
        throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, source: rec.source, retryAfter: ra, backend: own, policy: rec.source === 'policy' || undefined });
      }
      const out = as === 'blob' ? await res.blob() : await res.json();
      if (as === 'blob' && !/^image\//.test(out.type)) throw Object.assign(new Error('La respuesta no es una imagen.'), { source: 'site' });
      rec.ok = true; rec.bytes = out.size;
      if (ttl) { cache.set(url, { v: out, exp: Date.now() + ttl }); if (cache.size > 200) cache.delete(cache.keys().next().value); }
      return out;
    } catch (e) { rec.error = e.message; rec.source ??= e.source; throw e; }
    finally { rec.ms = Math.round(performance.now() - t0); trace?.push(rec); release(); }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Imágenes "md:page/…" y "md:cover/…" (las pide fetchVia). */
export function mdFetch(url, trace) {
  const [kind, ...rest] = url.slice(3).split('/');
  if (kind === 'page' && rest.length === 3) return mdCall('page', { chapter: rest[0], quality: rest[1], file: rest[2] }, { as: 'blob', trace });
  if (kind === 'cover' && rest.length === 3) return mdCall('cover', { manga: rest[0], file: rest[1], size: rest[2] }, { as: 'blob', trace });
  return Promise.reject(Object.assign(new Error('Dirección interna de MangaDex inválida.'), { source: 'policy' }));
}

// ---------------- normalización ----------------
const str = (v, n = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const pickLang = (o, langs) => { if (!o || typeof o !== 'object') return ''; for (const l of [...langs, 'en', 'ja-ro']) if (o[l]) return o[l]; return Object.values(o)[0] || ''; };
const plain = (md) => String(md || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1').replace(/^-{3,}\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
const rels = (x, t) => (x.relationships || []).filter((r) => r.type === t);
const names = (x, t) => [...new Set(rels(x, t).map((r) => str(r.attributes?.name, 80)).filter(Boolean))].slice(0, 4).join(', ');
const kindOf = (ol) => Object.entries(MD_TYPES).find(([, l]) => l.includes(ol))?.[0];

/** Obra de MangaDex → obra de Manhuua. */
export function mdWork(m, langs = MD_DEFAULTS.langs, size = 256) {
  const a = m.attributes || {};
  const title = str(Object.values(a.title || {})[0]) || str(pickLang(a.title, langs));
  const file = rels(m, 'cover_art')[0]?.attributes?.fileName;
  return {
    url: `md:manga/${m.id}`, remoteId: m.id, title,
    altTitles: [...new Set((a.altTitles || []).map((o) => str(Object.values(o || {})[0])).filter((t) => t && t !== title))].slice(0, 30),
    cover: file ? `md:cover/${m.id}/${file}/${size}` : null,
    description: plain(pickLang(a.description, langs)) || undefined,
    descriptionLangs: Object.keys(a.description || {}),
    author: names(m, 'author') || undefined, artist: names(m, 'artist') || undefined,
    status: STATUS[a.status], year: a.year || undefined,
    genres: (a.tags || []).filter((t) => ['genre', 'theme'].includes(t.attributes?.group)).map((t) => str(pickLang(t.attributes?.name, langs), 40)).filter(Boolean).slice(0, 20),
    contentRating: a.contentRating, rating: RATING[a.contentRating],
    languages: (a.availableTranslatedLanguages || []).filter(Boolean),
    originalLanguage: a.originalLanguage, type: kindOf(a.originalLanguage),
    ids: { mangadex: m.id }, link: `https://mangadex.org/title/${m.id}`,
    updatedAt: a.updatedAt?.slice(0, 10),
  };
}

const ratings = (o) => ['safe', 'suggestive', ...(o.adult ? ['erotica'] : [])];
const ORDERS = { latest: ['order[latestUploadedChapter]', 'desc'], title: ['order[title]', 'asc'], popular: ['order[followedCount]', 'desc'], new: ['order[createdAt]', 'desc'], year: ['order[year]', 'desc'] };
const errDiag = (diag, e) => Object.assign(diag, { count: 0, httpError: e.message, httpStatus: e.status, errorSource: e.source, reasons: [e.status === 429 ? `MangaDex limitó las peticiones (429)${e.retryAfter ? `: reintentá en ${e.retryAfter} s` : ''}.` : e.status === 403 ? 'MangaDex rechazó la petición (403). Si se repite, puede ser un bloqueo temporal por exceso de peticiones.' : e.message] });
/** Id de MangaDex si la búsqueda es un UUID o un enlace a una obra. */
export const mdIdFrom = (q = '') => q.trim().match(/(?:mangadex\.org\/title\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];

/** Catálogo y búsqueda: GET /manga con relaciones (portada, autor, artista) en una sola petición. */
export async function mdBrowse(ext, { query, page = 1, filters = {}, signal } = {}) {
  const o = mdOptions(ext);
  const trace = [];
  const diag = { url: 'MangaDex · /manga', kind: 'catalog', attempts: trace, via: 'API oficial de MangaDex (backend propio)' };
  const t0 = Date.now();
  const p = { path: '/manga', limit: PAGE, offset: (page - 1) * PAGE, 'includes[]': ['cover_art', 'author', 'artist'], 'contentRating[]': ratings(o) };
  const id = mdIdFrom(query);
  if (id) p['ids[]'] = [id];
  else {
    if (query?.trim()) { p.title = query.trim().slice(0, 200); p['order[relevance]'] = 'desc'; } else { const [k, v] = ORDERS[filters.order] || ORDERS.latest; p[k] = v; }
    const lang = filters.lang === 'any' ? null : filters.lang ? [filters.lang] : o.langs;
    if (lang?.length) p['availableTranslatedLanguage[]'] = lang;
    if (filters.status) p['status[]'] = [filters.status];
    if (filters.tag) p['includedTags[]'] = [filters.tag];
    if (filters.type && MD_TYPES[filters.type]) p['originalLanguage[]'] = MD_TYPES[filters.type];
  }
  try {
    if (!id && filters.author?.trim()) {
      const a = await mdCall('api', { path: '/author', name: filters.author.trim().slice(0, 100), limit: 5 }, { ttl: 3600e3, signal, trace });
      const aid = a.data?.[0]?.id;
      if (!aid) return { items: [], next: null, diag: Object.assign(diag, { count: 0, ms: Date.now() - t0, reasons: [`MangaDex no tiene un autor o artista llamado "${filters.author.trim()}".`] }) };
      p.authorOrArtist = aid; diag.author = a.data[0].attributes?.name;
    }
    const j = await mdCall('api', p, { ttl: 120e3, signal, trace });
    const items = (j.data || []).map((m) => mdWork(m, o.langs)).filter((w) => w.title);
    const total = Math.min(+j.total || 0, 10000);
    Object.assign(diag, { count: items.length, total: j.total, covers: items.filter((i) => i.cover).length, ms: Date.now() - t0, strategy: 'GET /manga con includes[] (portada, autor, artista)' });
    diag.reasons = items.length ? [] : [query ? `MangaDex no tiene resultados para "${query.trim()}" con los filtros elegidos.` : 'MangaDex no devolvió obras con estos filtros.'];
    const more = page * PAGE < total && page * PAGE + PAGE <= 10000; // MangaDex rechaza offset + limit > 10.000
    return { items, next: more ? `md:browse/${page + 1}` : null, nextPage: page + 1, total: j.total, diag };
  } catch (e) {
    if (e.aborted) throw e;
    errDiag(diag, e); diag.ms = Date.now() - t0;
    return { items: [], next: null, diag };
  }
}

/** Géneros y temas (GET /manga/tag), cacheados 7 días en el navegador. */
export async function mdTags() {
  try { const c = JSON.parse(localStorage.getItem('manhuua.md.tags')); if (c && Date.now() - c.at < 7 * 864e5) return c.tags; } catch {}
  const j = await mdCall('api', { path: '/manga/tag' }, { ttl: 864e5 });
  const tags = (j.data || []).map((t) => ({ id: t.id, name: str(pickLang(t.attributes?.name, ['es-la', 'es']), 40), group: t.attributes?.group })).filter((t) => t.name && ['genre', 'theme', 'format'].includes(t.group)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  try { localStorage.setItem('manhuua.md.tags', JSON.stringify({ at: Date.now(), tags })); } catch {}
  return tags;
}

/** Número de capítulo: "12", "12.5" → número; vacío o texto ("Extra") → null (especial). */
export const chapterNumber = (s) => (s != null && /^\d+(\.\d+)?$/.test(String(s).trim()) ? parseFloat(s) : null);
/**
 * Orden de capítulos: por número (decimales incluidos), luego volumen, idioma y grupo; los
 * especiales (sin número) van al final por fecha. Nunca se descartan por "duplicado": dos versiones
 * del mismo número (otro grupo u otro idioma) son capítulos distintos.
 */
export function sortChapters(list, order = 'number') {
  const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));
  if (order === 'date') return [...list].sort((a, b) => byDate(a, b) || (a.number ?? 1e9) - (b.number ?? 1e9));
  return [...list].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || (a.number == null && b.number == null ? byDate(a, b) : 0) || (+a.volume || 0) - (+b.volume || 0) || String(a.language).localeCompare(String(b.language)) || String(a.group).localeCompare(String(b.group)) || byDate(a, b));
}
/** "Un grupo por capítulo": por número e idioma se queda la versión del grupo con más capítulos. */
export function onePerNumber(list) {
  const score = new Map(); for (const c of list) score.set(c.group, (score.get(c.group) || 0) + 1);
  const best = new Map();
  for (const c of list) {
    if (c.number == null) continue;
    const k = c.number + '|' + c.language, b = best.get(k);
    if (!b || score.get(c.group) > score.get(b.group) || (score.get(c.group) === score.get(b.group) && String(c.date) < String(b.date))) best.set(k, c);
  }
  return list.filter((c) => c.number == null || best.get(c.number + '|' + c.language) === c);
}

/** Capítulo de MangaDex → capítulo de Manhuua (o null si no se puede leer en MangaDex). */
export function mdChapter(c) {
  const a = c.attributes || {};
  const number = chapterNumber(a.chapter);
  const head = a.chapter ? `Cap. ${str(a.chapter, 20)}` : 'Especial';
  const t = str(a.title, 160);
  return {
    url: `md:chapter/${c.id}`, remoteId: c.id, link: `https://mangadex.org/chapter/${c.id}`,
    number, volume: str(a.volume, 10) || undefined, rawNumber: str(a.chapter, 20) || undefined,
    title: (a.volume ? `Vol. ${str(a.volume, 10)} · ` : '') + (a.chapter ? head + (t ? `: ${t}` : '') : t || head),
    date: a.publishAt?.slice(0, 10) || null, language: a.translatedLanguage,
    group: names(c, 'scanlation_group') || 'Sin grupo', pages: a.pages,
    external: a.externalUrl || undefined,
  };
}

/**
 * Ficha + capítulos: GET /manga/{id} y GET /manga/{id}/feed (paginado, por idioma). Los capítulos
 * alojados fuera de MangaDex (externalUrl) o sin páginas no se ofrecen para leer y se informan.
 */
export async function mdDetail(ext, url, fallback = {}, { langs: forced, signal } = {}) {
  const o = mdOptions(ext);
  const id = String(url).replace(/^md:manga\//, '');
  const trace = [];
  const diag = { url: `MangaDex · /manga/${id}`, kind: 'series', attempts: trace, via: 'API oficial de MangaDex (backend propio)' };
  const t0 = Date.now();
  if (!UUID.test(id)) return { ...fallback, chapters: [], diag: Object.assign(diag, { count: 0, incompatible: true, reasons: ['Identificador de obra de MangaDex inválido.'] }) };
  const langs = forced?.length ? forced : o.langs;
  let w;
  try {
    const j = await mdCall('api', { path: `/manga/${id}`, 'includes[]': ['cover_art', 'author', 'artist'] }, { ttl: 600e3, signal, trace });
    w = mdWork(j.data, langs, 512);
  } catch (e) { if (e.aborted) throw e; errDiag(diag, e); diag.ms = Date.now() - t0; return { ...fallback, chapters: [], diag }; }
  const raw = []; let limit = 500, total = 0, pages = 0;
  try {
    for (let offset = 0; pages < 20 && offset + limit <= 10000; offset += limit) {
      const p = { path: `/manga/${id}/feed`, limit, offset, 'translatedLanguage[]': langs, 'order[volume]': 'asc', 'order[chapter]': 'asc', 'includes[]': ['scanlation_group'], 'contentRating[]': ratings(o) };
      let j;
      try { j = await mdCall('api', p, { ttl: 300e3, signal, trace }); }
      catch (e) { if (e.status === 400 && limit === 500 && offset === 0) { limit = 100; offset = -limit; continue; } throw e; } // si el feed no acepta 500, se usa 100
      pages++;
      raw.push(...(j.data || []));
      total = +j.total || 0;
      if (!j.data?.length || offset + limit >= total) break;
    }
  } catch (e) { if (e.aborted) throw e; errDiag(diag, e); diag.reasons.unshift('No se pudo cargar la lista de capítulos.'); }
  const all = raw.map(mdChapter);
  const external = all.filter((c) => c.external), empty = all.filter((c) => !c.external && !c.pages);
  let chapters = all.filter((c) => !c.external && c.pages > 0);
  if (o.groups === 'one') chapters = onePerNumber(chapters);
  chapters = sortChapters(chapters, o.order);
  Object.assign(diag, { ms: Date.now() - t0, pages, total, count: chapters.length, external: external.length, empty: empty.length, languages: langs, strategy: `GET /manga/{id}/feed · idiomas: ${langs.join(', ')} · ${o.groups === 'one' ? 'un grupo por número' : 'todas las versiones'}` });
  if (!diag.httpError) diag.reasons = chapters.length ? [] : [w.languages.length ? `No hay capítulos legibles en ${langs.map((l) => MD_LANGS[l] || l).join(' / ')}. Idiomas disponibles: ${w.languages.map((l) => MD_LANGS[l] || l).join(', ')}.` : 'MangaDex no tiene capítulos traducidos de esta obra.'];
  if (external.length) diag.reasons.push(`${external.length} capítulo(s) están publicados fuera de MangaDex (p. ej. en el sitio oficial de la editorial) y no se pueden leer en Manhuua.`);
  return { ...w, chapters, external: external.map((c) => ({ title: c.title, link: c.external, language: c.language })), diag };
}

/** Páginas de un capítulo: GET /mangadex/chapter (el backend valida MangaDex@Home). */
export async function mdPages(ext, chapterUrl) {
  const o = mdOptions(ext);
  const id = String(chapterUrl).replace(/^md:chapter\//, '');
  if (!UUID.test(id)) throw new Error('Capítulo de MangaDex inválido.');
  const j = await mdCall('chapter', { id });
  let q = o.quality === 'data' ? 'data' : 'data-saver';
  let files = q === 'data' ? j.data : j.dataSaver;
  if (!files?.length) { q = q === 'data' ? 'data-saver' : 'data'; files = q === 'data' ? j.data : j.dataSaver; }
  if (!files?.length) throw Object.assign(new Error('Este capítulo no tiene páginas en MangaDex (puede estar publicado en otro sitio).'), { kind: 'incompatible' });
  return files.map((f) => `md:page/${id}/${q}/${f}`);
}
