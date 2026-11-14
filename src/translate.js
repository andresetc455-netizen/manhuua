// Traductor de páginas: OCR (Tesseract.js, en el navegador) + traducción + texto superpuesto.
import { get, write } from './db.js';
import { loadSettings } from './settings.js';
import { proxied } from './sources/web.js';

let workerP = null;
async function getWorker(lang) {
  workerP ??= import('tesseract.js').then(({ createWorker }) => createWorker(lang === 'en' ? 'eng' : lang));
  return workerP;
}

const TILE = 2400, STEP = 2100;

/** OCR de una imagen (Blob/URL). Devuelve {w, h, items:[{x,y,w,h,text}]} en px de la imagen. */
async function ocr(src, lang) {
  const blob = typeof src === 'string' && !src.startsWith('blob:') ? await (await fetch(proxied(src))).blob() : await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const { width: W, height: H } = bmp;
  const worker = await getWorker(lang);
  const items = [];
  // Las tiras largas se procesan en tramos superpuestos
  for (let y0 = 0; y0 < H; y0 += STEP) {
    const h = Math.min(TILE, H - y0);
    const c = new OffscreenCanvas(W, h);
    c.getContext('2d').drawImage(bmp, 0, y0, W, h, 0, 0, W, h);
    const { data } = await worker.recognize(c, {}, { blocks: true, text: false });
    const lo = y0 === 0 ? 0 : (TILE - STEP) / 2, hi = y0 + h >= H ? h : h - (TILE - STEP) / 2;
    const lines = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) {
      const t = l.text.trim(), cy = (l.bbox.y0 + l.bbox.y1) / 2;
      if (t && l.confidence >= 45 && cy >= lo && cy < hi) lines.push({ ...l.bbox, text: t, conf: l.confidence });
    }
    for (const c of clusterLines(lines)) items.push({ ...c, y: c.y + y0 });
    if (y0 + h >= H) break;
  }
  bmp.close();
  return { w: W, h: H, items };
}

/** Agrupa líneas cercanas en globos de texto (Tesseract a veces une globos distintos). */
function clusterLines(lines) {
  lines.sort((a, b) => a.y0 - b.y0);
  const cl = [];
  for (const l of lines) {
    const lh = l.y1 - l.y0;
    const c = cl.find((c) => l.y0 - c.y1 < lh * 0.9 && l.y0 > c.y0 && Math.min(l.x1, c.x1) - Math.max(l.x0, c.x0) > -lh * 0.3 && Math.abs(lh - c.lh) < c.lh * 0.6);
    if (c) { Object.assign(c, { x0: Math.min(c.x0, l.x0), x1: Math.max(c.x1, l.x1), y1: Math.max(c.y1, l.y1) }); c.lines.push(l); }
    else cl.push({ x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1, lh, lines: [l] });
  }
  return cl.map((c) => {
    const text = c.lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
    const letters = (text.match(/[a-záéíóúñü]/gi) || []).length;
    const conf = c.lines.reduce((n, l) => n + l.conf, 0) / c.lines.length;
    return { x: c.x0, y: c.y0, w: c.x1 - c.x0, h: c.y1 - c.y0, lh: c.lh, text, letters, conf };
  }).filter((c) => c.letters >= 2 && c.letters / c.text.length >= 0.5 && c.conf >= 55)
    .map(({ letters, conf, ...c }) => c);
}

// Los cómics suelen estar en MAYÚSCULAS: pasarlo a oración mejora la traducción.
const sentence = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bi\b/g, 'I') : t);

async function translateTexts(texts) {
  const s = loadSettings();
  if (!texts.length) return [];
  if (s.trProvider === 'libre') {
    const r = await fetch(s.libreUrl.replace(/\/$/, '') + '/translate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: texts, source: s.trFrom, target: s.trTo, format: 'text', api_key: s.libreKey || undefined }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Error de LibreTranslate');
    return j.translatedText;
  }
  // MyMemory: gratis, sin clave (límite diario; con email el límite sube)
  return Promise.all(texts.map(async (q) => {
    const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q.slice(0, 480))}&langpair=${s.trFrom}|${s.trTo}${s.trEmail ? '&de=' + encodeURIComponent(s.trEmail) : ''}`;
    const j = await (await fetch(u)).json();
    if (j.responseStatus && j.responseStatus !== 200) throw new Error(j.responseDetails || 'Límite de traducción alcanzado');
    return j.responseData.translatedText;
  }));
}

/** Traduce (o devuelve de la caché) la página i de un capítulo. */
export async function translatePage(chapterId, i, src) {
  const key = [chapterId, i];
  const cached = await get('translations', key);
  if (cached) return cached;
  const s = loadSettings();
  const page = await ocr(src, s.trFrom);
  const out = await translateTexts(page.items.map((it) => sentence(it.text)));
  page.items.forEach((it, k) => (it.tr = out[k] || it.text));
  await write('translations', (o) => o.translations.put(page, key));
  return page;
}

export async function clearTranslations(chapterId) {
  await write('translations', (o) => o.translations.delete(IDBKeyRange.bound([chapterId, 0], [chapterId, Infinity])));
}

/** Tamaño de letra (px de la imagen) para que el texto entre en la caja. */
export function fitFont(it) {
  const area = it.w * 1.16 * it.h * 1.16;
  return Math.max(9, Math.min((it.lh || it.h) * 1.05, Math.sqrt(area / (0.75 * Math.max(4, it.tr.length)))));
}
