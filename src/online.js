// Lectura en línea: guarda la obra y sus capítulos (solo datos, sin imágenes) para poder leer,
// navegar entre capítulos y recordar el progreso sin descargar. Las imágenes se piden al abrir.
import { get, getAll, byIndex, write } from './db.js';
import { uid } from './library.js';
import { analyze, fetchVia } from './sources/web.js';
import { setCover, needsCover } from './covers.js';
import { chapterImages, getExtension, identityOf, removedInfo, extHosts } from './sources/extensions.js';

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
  // Una fuente por URL: si había una entrada de una extensión ya eliminada con la misma URL, se reemplaza.
  // Se reemplaza la entrada de esta misma fuente, o la de una extensión eliminada con la MISMA identidad
  // (id + dominio). Una homónima de otro dominio no absorbe la fuente eliminada.
  const same = (x) => x.extId === ext.id || (!getExtension(x.extId) && removedInfo(x.extId)?.identity === identityOf(ext));
  const sources = [...seriesSources(base).filter((x) => !(x.url === sourceUrl && same(x))), srcEntry];
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
    // Extensiones JSON: la portada solo puede venir (y redirigir) a sus dominios; si no, no se guarda.
    fetchVia(detail.cover, 'blob', /^https?:/.test(sourceUrl) ? sourceUrl : undefined, undefined, { hosts: extHosts(ext) })
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
 * Migración (segura e idempotente): fija para siempre la fuente de los capítulos guardados antes
 * de la versión multifuente, con la misma regla con la que se mostraban (sourceKey). Solo agrega el
 * campo que falta: no borra ni cambia otros datos. También anota la fuente en su progreso.
 * Con seriesId migra una sola obra. Devuelve la cantidad de capítulos actualizados.
 */
export async function migrateSources(seriesId) {
  const series = seriesId ? [await get('series', seriesId)].filter(Boolean) : await getAll('series');
  let n = 0;
  for (const s of series) {
    // Lectura y escritura dentro de la MISMA transacción (cursor): si otra parte de la app guarda
    // el capítulo (por ejemplo, el lector abierto directamente), IndexedDB ordena las transacciones
    // y la migración nunca escribe una copia vieja; solo agrega sourceId a lo que no lo tiene.
    const src = new Map();
    await write(['chapters', 'progress'], (o) => {
      o.chapters.index('seriesId').openCursor(IDBKeyRange.only(s.id)).onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) {
          o.progress.index('seriesId').openCursor(IDBKeyRange.only(s.id)).onsuccess = (ev) => {
            const pc = ev.target.result; if (!pc) return;
            if (!pc.value.sourceId && src.has(pc.value.chapterId)) pc.update({ ...pc.value, sourceId: src.get(pc.value.chapterId) });
            pc.continue();
          };
          return;
        }
        const c = cur.value;
        const sid = c.sourceId || sourceKey(c, s);
        src.set(c.id, sid);
        if (!c.sourceId) { cur.update({ ...c, sourceId: sid }); n++; }
        cur.continue();
      };
    });
  }
  return n;
}

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

/**
 * Recupera la asociación de la biblioteca con extensiones reinstaladas que tienen otro id local
 * (datos anteriores a la identidad estable). Solo con evidencia exacta: misma identidad registrada
 * al eliminarla, o capítulos/obras "mf:<id-del-manifiesto>/" de esa misma extensión JSON. Nunca por
 * nombre ni por dominio. Además une entradas de fuente duplicadas (misma URL). No borra datos.
 * Devuelve {series, chapters, progress} actualizados.
 */
export async function relinkSources(installed, { confirmed = {} } = {}) {
  const byIdentity = new Map(installed.map((x) => [identityOf(x), x.id]));
  const live = new Set(installed.map((x) => x.id));
  // Automático solo con evidencia de identidad (lápida con el mismo id + dominio). Datos antiguos sin
  // lápida: solo si el usuario lo autorizó (confirmed: {idViejo: idNuevo}, ver legacyCandidates).
  const target = (oldId) => {
    if (!oldId || live.has(oldId) || oldId === 'local') return null;
    if (confirmed[oldId] && live.has(confirmed[oldId])) return confirmed[oldId];
    const gone = removedInfo(oldId);
    if (gone?.identity && byIdentity.has(gone.identity)) return byIdentity.get(gone.identity);
    return null;
  };
  const stats = { series: 0, chapters: 0, progress: 0 };
  for (const s of await getAll('series')) {
    const map = new Map();
    for (const x of seriesSources(s)) { const t = target(x.extId); if (t) map.set(x.extId, t); }
    const t0 = target(s.extId); if (t0) map.set(s.extId, t0);
    const srcs = seriesSources(s).map((x) => (map.has(x.extId) ? { ...x, extId: map.get(x.extId), extName: getExtension(map.get(x.extId))?.name || x.extName } : x));
    const dedup = [];
    for (const x of srcs) { const i = dedup.findIndex((y) => y.url === x.url && y.extId === x.extId); if (i < 0) dedup.push(x); else dedup[i] = { ...dedup[i], ...x }; }
    const changedSeries = map.size || dedup.length !== seriesSources(s).length;
    // Capítulos y progreso: se reasigna solo el id viejo → nuevo de la MISMA extensión, en la misma transacción.
    const chMap = new Map(map);
    const chs = await byIndex('chapters', 'seriesId', s.id);
    for (const c of chs) if (c.sourceId && !chMap.has(c.sourceId)) { const t = target(c.sourceId); if (t) chMap.set(c.sourceId, t); }
    if (!changedSeries && !chMap.size) continue;
    await write(['series', 'chapters', 'progress'], (o) => {
      o.series.get(s.id).onsuccess = (e) => {
        const cur = e.target.result; if (!cur || !changedSeries) return;
        o.series.put({ ...cur, sources: dedup, ...(map.has(cur.extId) ? { extId: map.get(cur.extId), extName: getExtension(map.get(cur.extId))?.name || cur.extName } : {}), ...(map.has(cur.activeSource) ? { activeSource: map.get(cur.activeSource) } : {}) });
        stats.series++;
      };
      if (!chMap.size) return;
      o.chapters.index('seriesId').openCursor(IDBKeyRange.only(s.id)).onsuccess = (e) => {
        const cur = e.target.result; if (!cur) return;
        if (chMap.has(cur.value.sourceId)) { cur.update({ ...cur.value, sourceId: chMap.get(cur.value.sourceId) }); stats.chapters++; }
        cur.continue();
      };
      o.progress.index('seriesId').openCursor(IDBKeyRange.only(s.id)).onsuccess = (e) => {
        const cur = e.target.result; if (!cur) return;
        if (chMap.has(cur.value.sourceId)) { cur.update({ ...cur.value, sourceId: chMap.get(cur.value.sourceId) }); stats.progress++; }
        cur.continue();
      };
    });
  }
  return stats;
}

/**
 * Fuentes eliminadas de una obra sin evidencia de identidad (datos de versiones anteriores) para las
 * que hay una extensión instalada con el mismo id de manifiesto. No se reasocian solas: la ficha
 * ofrece hacerlo y el usuario confirma (puede ser otra fuente del mismo id en otro dominio).
 */
export function legacyCandidates(series, chapters, installed) {
  const live = new Set(installed.map((x) => x.id));
  const out = [];
  const ids = new Set([...seriesSources(series).map((x) => x.extId), ...chapters.map((c) => c.sourceId)].filter((k) => k && k !== 'local' && !live.has(k)));
  for (const old of ids) {
    const gone = removedInfo(old);
    if (gone?.identity && installed.some((x) => identityOf(x) === gone.identity)) continue; // se reasocia sola
    const mid = chapters.find((c) => c.sourceId === old && /^mf:/.test(c.url || ''))?.url.slice(3).split('/')[0] || gone?.manifestId;
    const cands = installed.filter((x) => mid && x.manifest?.id === mid);
    if (cands.length) out.push({ oldId: old, oldName: gone?.name || seriesSources(series).find((x) => x.extId === old)?.extName, oldDomain: gone?.domain, candidates: cands });
  }
  return out;
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
