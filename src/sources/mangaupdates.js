// MangaUpdates (API pública v1) a través del backend propio (/mangaupdates/*): SOLO metadatos.
// Búsqueda por título y ficha (autores, géneros, estado, año, tipo, sinopsis, portada). No hay
// capítulos para leer: MangaUpdates no aloja contenido. La ficha enlaza a la obra en su sitio.
// Ver docs/FUENTES.md.
import { mdCall } from './mangadex.js';

export const MU_ID = 'native-mangaupdates';
export const MU_IDENTITY = 'native:mangaupdates';
export const MU_VERSION = '1.0.0';
export const MU_HOSTS = ['api.mangaupdates.com', 'cdn.mangaupdates.com'];
export const muExtensionBase = () => ({ type: 'mangaupdates', native: true, metadataOnly: true, name: 'MangaUpdates', version: MU_VERSION, url: 'https://www.mangaupdates.com', searchUrl: 'native', icon: '' });
export const isMu = (url) => /^mu:/.test(url || '');
const PAGE = 24;
const SEARCH_ONLY = 'MangaUpdates solo permite buscar: escribí un título.';
export const METADATA_NOTE = 'Solo metadatos: MangaUpdates es una base de datos de obras y no aloja capítulos. Para leer, usá la plataforma oficial o una fuente con lectura autorizada.';

const call = (route, params, opts) => mdCall(route, params, { ...opts, service: 'mangaupdates' });
const str = (v, n = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
/** Texto plano desde el HTML/BBCode de las descripciones (se muestra como texto, nunca como HTML). */
export function plainText(v) {
  const s = String(v || '').replace(/<br\s*\/?>/gi, '\n').replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '');
  const t = typeof DOMParser !== 'undefined' ? new DOMParser().parseFromString(`<body>${s}</body>`, 'text/html').body.textContent : s.replace(/<[^>]+>/g, '');
  return (t || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}
const TYPES = { manga: 'manga', manhwa: 'manhwa', manhua: 'manhua', novel: 'novel', 'oel': 'manga' };
const STATUS = [[/ongoing/i, 'En curso'], [/complete/i, 'Finalizado'], [/hiatus/i, 'En pausa'], [/cancel|discontinued/i, 'Cancelado']];
const statusOf = (r) => (r.completed === true ? 'Finalizado' : STATUS.find(([re]) => re.test(r.status || ''))?.[1]);
const coverOf = (r, big) => { const u = big ? r.image?.url?.original || r.image?.url?.thumb : r.image?.url?.thumb || r.image?.url?.original; return typeof u === 'string' && /^https?:\/\//.test(u) ? `mu:cover/${encodeURIComponent(u)}` : null; }; // el backend solo acepta https://cdn.mangaupdates.com
const linkOf = (r) => (typeof r.url === 'string' && /^https:\/\/(www\.)?mangaupdates\.com\//.test(r.url) ? r.url : 'https://www.mangaupdates.com');

/** Registro de MangaUpdates (búsqueda o ficha) → obra de Manhuua. */
export function muWork(r, big = false) {
  const id = String(r.series_id ?? '');
  const people = (t) => [...new Set((r.authors || []).filter((a) => a?.type === t).map((a) => str(a.name, 80)).filter(Boolean))].slice(0, 4).join(', ') || undefined;
  const year = parseInt(r.year, 10);
  return {
    url: `mu:series/${id}`, remoteId: id, title: str(r.title),
    altTitles: [...new Set((r.associated || []).map((a) => str(a?.title)).filter(Boolean))].slice(0, 30),
    cover: coverOf(r, big), description: plainText(r.description) || undefined,
    author: people('Author'), artist: people('Artist'), status: statusOf(r), year: year > 1800 ? year : undefined,
    genres: (r.genres || []).map((g) => str(g?.genre, 40)).filter(Boolean).slice(0, 20),
    type: TYPES[String(r.type || '').toLowerCase()], typeLabel: str(r.type, 30) || undefined,
    publishers: (r.publishers || []).map((p) => [str(p?.publisher_name, 80), str(p?.type, 20)]).filter(([n]) => n).slice(0, 6),
    ids: id ? { mangaupdates: id } : {}, link: linkOf(r), metadataOnly: true,
    updatedAt: typeof r.last_updated?.as_rfc3339 === 'string' ? r.last_updated.as_rfc3339.slice(0, 10) : undefined,
  };
}

const errDiag = (diag, e) => Object.assign(diag, { count: 0, httpError: e.message, httpStatus: e.status, errorSource: e.source, reasons: [e.status === 429 ? `MangaUpdates limitó las peticiones (429)${e.retryAfter ? `: reintentá en ${e.retryAfter} s` : ''}.` : e.message] });

/** Búsqueda (POST /v1/series/search a través del backend). Sin texto no hay catálogo: lo informa sin pedir nada. */
export async function muBrowse(ext, { query, page = 1, signal } = {}) {
  const diag = { url: 'mu:search', kind: 'catalog', attempts: [], via: 'API oficial de MangaUpdates (solo metadatos)' };
  if (!query?.trim()) return { items: [], next: null, diag: Object.assign(diag, { count: 0, searchOnly: true, reasons: [SEARCH_ONLY] }) };
  const t0 = Date.now();
  try {
    const j = await call('search', { q: query.trim(), page, perpage: PAGE }, { ttl: 120e3, signal, trace: diag.attempts });
    if (!Array.isArray(j?.results)) { Object.assign(diag, { count: 0, incompatible: true, reasons: ['La respuesta de MangaUpdates no tiene el formato esperado (results).'] }); return { items: [], next: null, diag }; }
    const items = j.results.map((x) => x?.record).filter((r) => r && r.series_id != null && r.title).map((r) => muWork(r));
    const total = Number.isFinite(+j.total_hits) ? +j.total_hits : undefined;
    Object.assign(diag, { count: items.length, covers: items.filter((i) => i.cover).length, ms: Date.now() - t0, reasons: items.length ? [] : ['MangaUpdates no encontró obras con ese título.'] });
    const more = total != null ? page * PAGE < total && page < 200 : items.length === PAGE;
    return { items, next: more ? `mu:search/${page + 1}` : null, nextPage: page + 1, total, diag };
  } catch (e) { if (e.aborted) throw e; errDiag(diag, e); return { items: [], next: null, diag }; }
}

/** Ficha (GET /v1/series/{id}). Nunca devuelve capítulos. */
export async function muDetail(ext, url, fallback = {}) {
  const diag = { url, kind: 'series', attempts: [], via: 'API oficial de MangaUpdates (solo metadatos)' };
  const id = String(url).match(/^mu:series\/(\d{1,20})$/)?.[1];
  if (!id) return { ...fallback, chapters: [], metadataOnly: true, diag: Object.assign(diag, { count: 0, incompatible: true, reasons: ['Identificador de MangaUpdates inválido.'] }) };
  try {
    const r = await call('series', { id }, { ttl: 600e3, trace: diag.attempts });
    if (r?.series_id == null) throw Object.assign(new Error('La respuesta de MangaUpdates no tiene el formato esperado.'), { source: 'site' });
    Object.assign(diag, { count: 0, metadata: true, reasons: [METADATA_NOTE] });
    return { ...fallback, ...muWork(r, true), chapters: [], diag };
  } catch (e) { errDiag(diag, e); return { ...fallback, chapters: [], metadataOnly: true, diag }; }
}

/** Portadas "mu:cover/<url>" (las pide fetchVia, siempre por el backend). */
export function muFetch(url, trace) {
  const m = url.match(/^mu:cover\/(.+)$/);
  if (!m) return Promise.reject(Object.assign(new Error('Dirección interna de MangaUpdates inválida.'), { source: 'policy' }));
  return mdCall('cover', { url: decodeURIComponent(m[1]) }, { as: 'blob', trace, service: 'mangaupdates' });
}
