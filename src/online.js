// Lectura en línea: guarda la obra y sus capítulos (solo datos, sin imágenes) para poder leer,
// navegar entre capítulos y recordar el progreso sin descargar. Las imágenes se piden al abrir.
import { get, getAll, byIndex, write } from './db.js';
import { uid } from './library.js';
import { analyze, fetchVia } from './sources/web.js';
import { setCover, needsCover } from './covers.js';
import { chapterImages } from './sources/extensions.js';

// Clave de capítulo: URL sin barra final (se conserva el #fragmento: los catálogos JSON lo usan).
export const normUrl = (u = '') => u.replace(/\/+(?=#|$)/, '');
const FRESH_MS = 6 * 3600e3; // las URLs de imágenes de algunos sitios caducan

/**
 * Crea o actualiza la obra en la biblioteca (modo "en línea") con los capítulos de la ficha.
 * No borra capítulos existentes ni duplica: se identifica cada capítulo por su URL de origen.
 * Devuelve { series, idByUrl, added }.
 */
export async function followSeries(ext, sourceUrl, detail, { seriesId } = {}) {
  const all = await getAll('series');
  const prev = (seriesId && all.find((s) => s.id === seriesId))
    || all.find((s) => s.sourceUrl === sourceUrl || s.sources?.some((x) => x.url === sourceUrl))
    || all.find((s) => s.extId === ext.id && s.title === detail.title);
  // Una obra puede tener varias fuentes: la primera queda como principal (extId/sourceUrl) y el
  // resto se suma a "sources". Los datos de la obra no se pisan si ya existían.
  const primary = !prev || !prev.extId || prev.extId === ext.id && prev.sourceUrl === sourceUrl;
  const meta = Object.fromEntries(Object.entries({
    description: detail.description, author: detail.author, artist: detail.artist, status: detail.status,
    genres: detail.genres?.length ? detail.genres : undefined, ...(primary ? { extId: ext.id, extName: ext.name, sourceUrl } : {}),
  }).filter(([, v]) => v != null && v !== ''));
  const base = prev
    ? { ...prev, ...(primary ? meta : Object.fromEntries(Object.entries(meta).filter(([k]) => prev[k] == null))), online: prev.online ?? true }
    : { id: uid(), title: (detail.title || 'Sin título').trim(), favorite: false, addedAt: Date.now(), source: 'local', online: true, ...meta };
  const srcEntry = { extId: ext.id, extName: ext.name, url: sourceUrl, chapterCount: detail.chapters?.length ?? 0, state: 'ok', lastCheck: Date.now() };
  const sources = [...seriesSources(base).filter((x) => !(x.extId === ext.id && x.url === sourceUrl)), srcEntry];
  const alts = [...new Set([...(base.altTitles || []), ...(detail.altTitles || []), ...(detail.title && detail.title !== base.title ? [detail.title] : [])])].slice(0, 30);
  const series = { ...base, sources, altTitles: alts, ids: { ...(detail.ids || {}), ...(base.ids || {}) }, activeSource: base.activeSource || ext.id };
  const existing = prev ? await byIndex('chapters', 'seriesId', prev.id) : [];
  const byUrl = new Map(existing.filter((c) => c.url).map((c) => [normUrl(c.url), c]));
  const idByUrl = new Map(), put = [];
  let added = 0;
  (detail.chapters || []).forEach((c, k) => {
    const key = normUrl(c.url);
    const old = byUrl.get(key);
    if (old) {
      idByUrl.set(key, old.id);
      const upd = { ...old, sourceId: old.sourceId || ext.id, title: old.online ? c.title || old.title : old.title, number: old.number ?? c.number ?? null, date: c.date || old.date || null, dateText: c.dateText || old.dateText || null };
      if (c.images?.length && old.online && !old.remotePages) Object.assign(upd, { remotePages: c.images, pageCount: c.images.length });
      put.push(upd);
      return;
    }
    const ch = { id: uid(), seriesId: series.id, sourceId: ext.id, sourceUrl, sourceChapterId: c.remoteId, link: c.link || undefined, title: c.title || `Capítulo ${c.number ?? k + 1}`, number: c.number ?? null, url: c.url, date: c.date || null, dateText: c.dateText || null, online: true, pageCount: c.images?.length || null, remotePages: c.images?.length ? c.images : null, addedAt: Date.now() + k };
    byUrl.set(key, ch); idByUrl.set(key, ch.id); put.push(ch); added++;
  });
  await write(['series', 'chapters'], (o) => { o.series.put(series); put.forEach((c) => o.chapters.put(c)); });
  if (detail.cover && needsCover(series)) {
    fetchVia(detail.cover, 'blob', /^https?:/.test(sourceUrl) ? sourceUrl : undefined)
      .then((b) => setCover(series.id, b, { provider: 'site', url: detail.cover, link: sourceUrl }))
      .catch(() => {});
  }
  return { series, idByUrl, added };
}

/** Fuentes de una obra (las obras anteriores a multifuente tienen solo extId/sourceUrl). */
export function seriesSources(s) {
  if (s?.sources?.length) return s.sources;
  return s?.extId && s.sourceUrl ? [{ extId: s.extId, extName: s.extName, url: s.sourceUrl }] : [];
}
/** Fuente de un capítulo: la suya, la principal de la obra o "local" (importado / descargado sin fuente). */
export const sourceKey = (c, s) => c.sourceId || (c.url && s?.extId) || 'local';

/**
 * Capítulo equivalente en otra fuente: mismo número y único en esa fuente → exacto.
 * Si no, el más cercano por número (exact: false, hay que confirmar) o null.
 */
export function equivalent(ch, list, s, target) {
  const pool = list.filter((c) => sourceKey(c, s) === target);
  if (!pool.length) return null;
  if (ch.number != null) {
    const same = pool.filter((c) => c.number === ch.number);
    if (same.length === 1) return { chapter: same[0], exact: true };
    if (same.length > 1) return { chapter: same[0], exact: false, reason: `hay ${same.length} capítulos con el número ${ch.number}` };
    const near = [...pool].filter((c) => c.number != null).sort((a, b) => Math.abs(a.number - ch.number) - Math.abs(b.number - ch.number))[0];
    return near ? { chapter: near, exact: false, reason: `no hay capítulo ${ch.number}; el más cercano es ${near.title}` } : { chapter: pool[0], exact: false, reason: 'los capítulos de esa fuente no tienen número' };
  }
  return { chapter: pool[0], exact: false, reason: 'este capítulo no tiene número para compararlo' };
}

/** URLs de las imágenes de un capítulo en línea (las pide a la página de origen si hace falta). */
export async function resolvePages(ch, { force = false } = {}) {
  const fresh = ch.remotePages?.length && (!ch.fetchedAt || Date.now() - ch.fetchedAt < FRESH_MS);
  if (fresh && !force) return ch.remotePages;
  if (/^mf:/.test(ch.url || '')) {
    let images;
    try { images = await chapterImages(ch.url, ch.sourceId); }
    catch (e) { throw Object.assign(new Error(e.message), { diag: e.diag }); }
    const latest = (await get('chapters', ch.id)) || ch;
    await write('chapters', (o) => o.chapters.put({ ...latest, remotePages: images, pageCount: latest.online ? images.length : latest.pageCount, fetchedAt: Date.now() }));
    return images;
  }
  if (!ch.url || !/^https?:/.test(ch.url) || (ch.remotePages?.length && !ch.fetchedAt)) {
    if (ch.remotePages?.length) return ch.remotePages;
    throw new Error('El capítulo no tiene dirección de origen.');
  }
  let info;
  try { info = await analyze(ch.url); }
  catch (e) { throw Object.assign(new Error(e.message), { diag: e.diag }); }
  if (info.kind !== 'chapter' || !info.images.length) throw new Error('La página del capítulo no tiene imágenes de lectura reconocibles.');
  await write('chapters', (o) => o.chapters.put({ ...ch, remotePages: info.images, pageCount: info.images.length, fetchedAt: Date.now() }));
  return info.images;
}
