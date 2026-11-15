// Operaciones de dominio sobre la biblioteca.
import { get, getAll, byIndex, write, pageRange } from './db.js';
import { natural } from './importers.js';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const byNumber = (a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || natural(a.title, b.title) || a.addedAt - b.addedAt;

/** Recorta/escala a 2:3 (600×900 por defecto, nítido en pantallas retina). */
export async function thumbnail(blob, W = 600, H = 900) {
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.max(W / bmp.width, H / bmp.height);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(bmp, (W - bmp.width * s) / 2, 0, bmp.width * s, bmp.height * s);
    return await new Promise((r) => c.toBlob((b) => r(b || blob), 'image/jpeg', 0.88));
  } catch { return blob; }
}

/** Busca (por título) o crea una serie. */
export async function ensureSeries(title, extra = {}) {
  const all = await getAll('series');
  const found = (extra.sourceUrl && all.find((s) => s.sourceUrl === extra.sourceUrl || s.sources?.some((x) => x.url === extra.sourceUrl)))
    || all.find((s) => s.title.trim().toLowerCase() === title.trim().toLowerCase() && (s.source || 'local') === (extra.source || 'local'));
  if (found) return found;
  const s = { id: uid(), title: title.trim() || 'Sin título', favorite: false, addedAt: Date.now(), source: 'local', ...extra };
  await write('series', (o) => o.series.put(s));
  return s;
}

/** Guarda un capítulo con sus páginas (Blobs) en una serie. */
export async function saveChapter(series, { title, number, pages, url, sourceId, kind }, { firstPageCover = true } = {}) {
  if (!pages.length) throw new Error('El capítulo no tiene imágenes');
  // Si el capítulo ya estaba "en línea" (sin descargar), se completa ese mismo registro: conserva
  // su id, el progreso de lectura y su lugar en la lista.
  const stub = url ? (await byIndex('chapters', 'seriesId', series.id)).find((c) => c.url === url) : null;
  const latest = (await get('series', series.id)) || series;
  // La procedencia queda fija desde que se guarda: la del capítulo en línea, la indicada por la
  // descarga o, si no hay, la fuente principal de la obra (o "local" para importados).
  const src = stub?.sourceId || sourceId || (url && latest.extId) || 'local';
  const ch = { ...(stub || {}), id: stub?.id || uid(), seriesId: series.id, title: title || stub?.title || `Capítulo ${number ?? ''}`.trim(), number: number ?? stub?.number ?? null, pageCount: pages.length, addedAt: stub?.addedAt || Date.now(), url, online: false, remotePages: null, sourceId: src, ...(kind ? { kind } : {}) };
  const cover = latest.cover || !firstPageCover || kind === 'text' ? null : await thumbnail(pages[0]);
  await write(['chapters', 'pages', 'series'], (o) => {
    o.chapters.put(ch);
    pages.forEach((p, i) => o.pages.put(p, [ch.id, i]));
    if (cover) o.series.put({ ...latest, cover, coverSource: { provider: 'page' } });
  });
  if (cover) series.cover = cover;
  navigator.storage?.persist?.().catch(() => {});
  return ch;
}

export async function importGroups(groups) {
  const out = [];
  for (const g of groups) {
    const s = await ensureSeries(g.series, g.kind ? { kind: g.kind, ...(g.author ? { author: g.author } : {}) } : {});
    for (const c of g.chapters) await saveChapter(s, c);
    out.push(s);
  }
  return out;
}

export async function deleteChapter(id) {
  const ch = await get('chapters', id);
  const s = ch && (await get('series', ch.seriesId));
  // En obras en línea, borrar la descarga deja el capítulo disponible para leer en línea.
  if (ch?.url && s?.online && !ch.online) {
    await write(['chapters', 'pages'], (o) => { o.pages.delete(pageRange(id)); o.chapters.put({ ...ch, online: true, pageCount: null }); });
    return;
  }
  await write(['chapters', 'pages', 'progress', 'translations'], (o) => {
    o.chapters.delete(id); o.pages.delete(pageRange(id)); o.progress.delete(id); o.translations.delete(pageRange(id));
  });
}

export async function deleteSeries(id) {
  const chs = await byIndex('chapters', 'seriesId', id);
  await write(['series', 'chapters', 'pages', 'progress', 'translations'], (o) => {
    o.series.delete(id);
    for (const c of chs) { o.chapters.delete(c.id); o.pages.delete(pageRange(c.id)); o.progress.delete(c.id); o.translations.delete(pageRange(c.id)); }
  });
}

export async function updateSeries(id, patch) {
  const s = await get('series', id);
  if (s) await write('series', (o) => o.series.put({ ...s, ...patch }));
}

export async function saveProgress(chapter, page, total) {
  const [prev, s] = await Promise.all([get('progress', chapter.id), get('series', chapter.seriesId)]);
  const done = !!prev?.done || page >= total - 1;
  await write(['progress', 'series'], (o) => {
    o.progress.put({ chapterId: chapter.id, seriesId: chapter.seriesId, sourceId: chapter.sourceId || prev?.sourceId, page, total, done, updatedAt: Date.now() });
    if (s) o.series.put({ ...s, lastReadAt: Date.now(), lastChapterId: chapter.id });
  });
}

export async function markChapters(chapters, done) {
  await write('progress', (o) => chapters.forEach((c) =>
    done ? o.progress.put({ chapterId: c.id, seriesId: c.seriesId, sourceId: c.sourceId, page: (c.pageCount || 1) - 1, total: c.pageCount, done: true, updatedAt: Date.now() })
         : o.progress.delete(c.id)));
}

/** URLs de las páginas de un capítulo: blob: si está descargado; si no, las de la fuente (en línea). */
export async function loadPages(chapter, { force = false } = {}) {
  if (chapter.pageUrls) return { urls: chapter.pageUrls, dispose() {} };
  const blobs = await getAll('pages', pageRange(chapter.id));
  if (blobs.length || !(chapter.url || chapter.remotePages)) {
    const urls = blobs.map((b) => URL.createObjectURL(b));
    return { urls, dispose: () => urls.forEach(URL.revokeObjectURL) };
  }
  const { resolvePages } = await import('./online.js');
  const { chapterHosts } = await import('./sources/extensions.js');
  const urls = await resolvePages(chapter, { force });
  return { urls, online: true, referer: /^https?:/.test(chapter.url || '') ? chapter.url : undefined, hosts: chapterHosts(chapter.url, chapter.sourceId), dispose() {} };
}

/** Siguiente capítulo a leer en una serie. */
export function nextToRead(chapters, progress, lastChapterId) {
  const done = new Set(progress.filter((p) => p.done).map((p) => p.chapterId));
  const last = chapters.find((c) => c.id === lastChapterId);
  if (last && !done.has(last.id)) return last;
  return chapters.find((c) => !done.has(c.id)) || chapters[0];
}

/** Serie de demostración generada con canvas (contenido original). */
export async function loadDemo() {
  const s = await ensureSeries('El Jardín de Niebla (demo)', { description: 'Serie de ejemplo generada localmente para probar el lector.' });
  const palettes = [['#1d2b53', '#7e2553', '#ff004d'], ['#0b3d2e', '#2a9d8f', '#e9c46a'], ['#2b2d42', '#8d99ae', '#ef233c']];
  for (let ch = 1; ch <= 3; ch++) {
    const pages = [];
    for (let p = 1; p <= 6; p++) {
      const c = document.createElement('canvas');
      c.width = 720; c.height = 1500;
      const x = c.getContext('2d'), pal = palettes[(ch + p) % 3];
      const g = x.createLinearGradient(0, 0, 0, 1500);
      g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]);
      x.fillStyle = g; x.fillRect(0, 0, 720, 1500);
      for (let i = 0; i < 14; i++) {
        x.globalAlpha = 0.15 + ((i * 37) % 10) / 30;
        x.fillStyle = pal[2];
        x.beginPath(); x.arc((i * 151 + p * 60) % 720, (i * 211 + ch * 90) % 1500, 30 + ((i * 53) % 90), 0, 7); x.fill();
      }
      x.globalAlpha = 1;
      x.fillStyle = 'rgba(255,255,255,.92)';
      x.beginPath(); x.roundRect(60, 1180, 600, 200, 40); x.fill();
      x.fillStyle = '#111'; x.font = 'bold 44px system-ui'; x.textAlign = 'center';
      x.fillText(`Capítulo ${ch} · Página ${p}`, 360, 1265);
      x.font = '30px system-ui'; x.fillText(p === 6 ? 'Continuará…' : '— la niebla se mueve —', 360, 1325);
      pages.push(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)));
    }
    await saveChapter(s, { title: `Capítulo ${ch}`, number: ch, pages }, { firstPageCover: false });
  }
  return s;
}
