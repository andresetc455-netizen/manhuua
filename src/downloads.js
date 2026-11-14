// Cola de descargas: URL de capítulo -> imágenes -> guardado offline en la biblioteca.
import { useEffect, useState } from 'react';
import { analyze, fetchVia } from './sources/web.js';
import { ensureSeries, saveChapter, updateSeries } from './library.js';
import { setCover, autoCover, needsCover } from './covers.js';
import { loadSettings } from './settings.js';
import { byIndex, getAll } from './db.js';

const jobs = [];
const subs = new Set();
const emit = () => subs.forEach((f) => f([...jobs]));
let running = false;

export function useDownloads() {
  const [j, set] = useState([...jobs]);
  useEffect(() => (subs.add(set), () => subs.delete(set)), []);
  return j;
}

/** job: { url, series, title?, number?, images?, sourceUrl? } */
export function enqueue(list) {
  for (const x of [].concat(list)) {
    if (jobs.some((j) => j.url === x.url && j.status !== 'error' && j.status !== 'done')) continue;
    jobs.push({ id: Math.random().toString(36).slice(2), status: 'en cola', done: 0, total: 0, ...x });
  }
  emit();
  run();
}
export function clearFinished() {
  for (let i = jobs.length - 1; i >= 0; i--) if (['listo', 'error', 'omitido'].includes(jobs[i].status)) jobs.splice(i, 1);
  emit();
}
export function retry(id) {
  const j = jobs.find((x) => x.id === id);
  if (j) { Object.assign(j, { status: 'en cola', error: null, done: 0 }); emit(); run(); }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function isPage(blob) {
  if (!blob || !blob.type.startsWith('image/') && blob.size < 1000) return false;
  try { const b = await createImageBitmap(blob); const ok = b.width >= 200 && b.height >= 150; b.close(); return ok; } catch { return false; }
}

async function process(job) {
  const set = (p) => { Object.assign(job, p); emit(); };
  set({ status: 'analizando' });
  const series = await ensureSeries(job.series, job.sourceUrl ? { sourceUrl: job.sourceUrl } : {});
  if (job.sourceUrl && !series.sourceUrl) await updateSeries(series.id, { sourceUrl: job.sourceUrl });
  if (job.cover && needsCover(series)) {
    try {
      await setCover(series.id, await fetchVia(job.cover, 'blob', job.sourceUrl || job.url), { provider: 'site', url: job.cover, link: job.sourceUrl });
      series.cover = true;
    } catch {}
  }
  const existing = await byIndex('chapters', 'seriesId', series.id);
  if (existing.some((c) => c.url === job.url)) return set({ status: 'omitido', error: 'Ya estaba en la biblioteca' });

  let { images, title, number } = job;
  if (!images) {
    const info = await analyze(job.url);
    if (info.kind !== 'chapter') throw new Error('No se encontraron páginas en la URL');
    images = info.images; title ??= info.title; number ??= info.number;
  }
  set({ status: 'descargando', total: images.length, done: 0 });
  let n = 0;
  const blobs = await pool(images, 4, async (u) => {
    let b = null;
    for (let t = 0; t < 3 && !b; t++) { try { b = await fetchVia(u, 'blob', job.url); } catch (e) { if (t === 2) console.warn(u, e); } }
    set({ done: ++n });
    return b;
  });
  const checks = await Promise.all(blobs.map(isPage));
  let pages = blobs.filter((b, i) => b && checks[i]);
  if (!pages.length) pages = blobs.filter(Boolean);
  if (!pages.length) throw new Error('No se pudo descargar ninguna imagen');
  await saveChapter(series, { title, number, pages, url: job.url });
  set({ status: 'listo', missing: images.length - pages.length });
  if (loadSettings().coverAuto) autoCover(series.id).catch(() => {});
}

async function run() {
  if (running) return;
  running = true;
  let job;
  while ((job = jobs.find((j) => j.status === 'en cola'))) {
    try { await process(job); } catch (e) { job.status = 'error'; job.error = e.message; emit(); }
  }
  running = false;
}

/** Revisa una serie con sourceUrl y encola capítulos nuevos. Devuelve cantidad encolada. */
export async function checkUpdates(series) {
  if (!series.sourceUrl) return 0;
  const info = await analyze(series.sourceUrl);
  const have = new Set((await byIndex('chapters', 'seriesId', series.id)).map((c) => c.url));
  const fresh = info.chapters.filter((c) => !have.has(c.url));
  enqueue(fresh.map((c) => ({ url: c.url, title: c.title, number: c.number, series: series.title, sourceUrl: series.sourceUrl })));
  return fresh.length;
}
export async function checkAllUpdates() {
  let total = 0;
  for (const s of await getAll('series')) if (s.sourceUrl) { try { total += await checkUpdates(s); } catch {} }
  return total;
}
