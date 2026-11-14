// Lectura en línea: guarda la obra y sus capítulos (solo datos, sin imágenes) para poder leer,
// navegar entre capítulos y recordar el progreso sin descargar. Las imágenes se piden al abrir.
import { getAll, byIndex, write } from './db.js';
import { uid } from './library.js';
import { analyze, fetchVia } from './sources/web.js';
import { setCover, needsCover } from './covers.js';

// Clave de capítulo: URL sin barra final (se conserva el #fragmento: los catálogos JSON lo usan).
export const normUrl = (u = '') => u.replace(/\/+(?=#|$)/, '');
const FRESH_MS = 6 * 3600e3; // las URLs de imágenes de algunos sitios caducan

/**
 * Crea o actualiza la obra en la biblioteca (modo "en línea") con los capítulos de la ficha.
 * No borra capítulos existentes ni duplica: se identifica cada capítulo por su URL de origen.
 * Devuelve { series, idByUrl, added }.
 */
export async function followSeries(ext, sourceUrl, detail) {
  const all = await getAll('series');
  const prev = all.find((s) => s.sourceUrl === sourceUrl) || all.find((s) => s.extId === ext.id && s.title === detail.title);
  const meta = Object.fromEntries(Object.entries({
    description: detail.description, author: detail.author, artist: detail.artist, status: detail.status,
    genres: detail.genres?.length ? detail.genres : undefined, extId: ext.id, extName: ext.name, sourceUrl,
  }).filter(([, v]) => v != null && v !== ''));
  const series = prev
    ? { ...prev, ...meta, online: prev.online ?? true }
    : { id: uid(), title: (detail.title || 'Sin título').trim(), favorite: false, addedAt: Date.now(), source: 'local', online: true, ...meta };
  const existing = prev ? await byIndex('chapters', 'seriesId', prev.id) : [];
  const byUrl = new Map(existing.filter((c) => c.url).map((c) => [normUrl(c.url), c]));
  const idByUrl = new Map(), put = [];
  let added = 0;
  (detail.chapters || []).forEach((c, k) => {
    const key = normUrl(c.url);
    const old = byUrl.get(key);
    if (old) {
      idByUrl.set(key, old.id);
      const upd = { ...old, title: old.online ? c.title || old.title : old.title, number: old.number ?? c.number ?? null, date: c.date || old.date || null, dateText: c.dateText || old.dateText || null };
      if (c.images?.length && old.online && !old.remotePages) Object.assign(upd, { remotePages: c.images, pageCount: c.images.length });
      put.push(upd);
      return;
    }
    const ch = { id: uid(), seriesId: series.id, title: c.title || `Capítulo ${c.number ?? k + 1}`, number: c.number ?? null, url: c.url, date: c.date || null, dateText: c.dateText || null, online: true, pageCount: c.images?.length || null, remotePages: c.images?.length ? c.images : null, addedAt: Date.now() + k };
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

/** URLs de las imágenes de un capítulo en línea (las pide a la página de origen si hace falta). */
export async function resolvePages(ch, { force = false } = {}) {
  const fresh = ch.remotePages?.length && (!ch.fetchedAt || Date.now() - ch.fetchedAt < FRESH_MS);
  if (fresh && !force) return ch.remotePages;
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
