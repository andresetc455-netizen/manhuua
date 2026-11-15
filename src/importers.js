// Importación de archivos locales: CBZ/ZIP, imágenes sueltas y carpetas.
import JSZip from 'jszip';

export const IMG_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
export const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const ext = (n) => (n.split('.').pop() || '').toLowerCase();
const base = (p) => p.split('/').filter(Boolean).pop() || p;
const dir = (p) => p.split('/').slice(0, -1).join('/');

export function guessSeries(name) {
  const clean = base(name).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  const t = clean
    .replace(/\s*[-–[(]?\s*(cap[ií]tulo|cap|chapter|ch|episodio|ep|c)\.?\s*\d+(\.\d+)?\b.*$/i, '')
    .replace(/\s+\d+(\.\d+)?\s*$/, '')
    .trim();
  return t || clean;
}
export function guessNumber(name) {
  const m = base(name).replace(/\.[^.]+$/, '').match(/(\d+(?:\.\d+)?)(?!.*\d)/);
  return m ? parseFloat(m[1]) : null;
}

/** Devuelve [{title, number, series, pages: Blob[]}] */
export async function parseFiles(fileList) {
  const files = [...fileList];
  const out = await parseNovels(files.filter((f) => NOVEL_RE.test(f.name)));
  const loose = new Map(); // carpeta -> [File]
  for (const f of files) {
    if (/\.(cbz|zip)$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(f);
      const groups = new Map();
      zip.forEach((path, e) => {
        if (e.dir || !IMG_RE.test(path) || path.includes('__MACOSX') || base(path).startsWith('.')) return;
        const d = dir(path);
        if (!groups.has(d)) groups.set(d, []);
        groups.get(d).push(e);
      });
      const multi = groups.size > 1;
      for (const [d, entries] of [...groups].sort((a, b) => natural(a[0], b[0]))) {
        entries.sort((a, b) => natural(a.name, b.name));
        const pages = await Promise.all(entries.map(async (e) => new Blob([await e.async('blob')], { type: MIME[ext(e.name)] || 'image/jpeg' })));
        const title = multi ? base(d) : f.name.replace(/\.[^.]+$/, '');
        out.push({ title, number: guessNumber(title), series: guessSeries(multi ? f.name : title), pages });
      }
    } else if (IMG_RE.test(f.name)) {
      const d = dir(f.webkitRelativePath || '') || '';
      if (!loose.has(d)) loose.set(d, []);
      loose.get(d).push(f);
    }
  }
  for (const [d, list] of [...loose].sort((a, b) => natural(a[0], b[0]))) {
    list.sort((a, b) => natural(a.name, b.name));
    const title = d ? base(d) : 'Capítulo';
    const parent = d.includes('/') ? base(dir(d)) : null;
    out.push({ title, number: guessNumber(title), series: parent || guessSeries(title), pages: list });
  }
  return out;
}

// ── Novelas propias (TXT / EPUB sin DRM) ─────────────────────────────────────────────────────
// Solo archivos del usuario: no se descarga texto de ningún sitio. El texto se guarda como
// párrafos (nunca HTML) y se muestra como texto plano, así un EPUB no puede inyectar código.
export const TEXT_TYPE = 'application/x-manhuua-text+json';
export const NOVEL_RE = /\.(txt|epub)$/i;
const textBlob = (title, paras) => new Blob([JSON.stringify({ title, paras })], { type: TEXT_TYPE });
const HEAD_RE = /^\s*(cap[ií]tulo|chapter|cap\.|prólogo|prologo|prologue|epílogo|epilogo|epilogue)\b[^\n]{0,80}$/i;

/** Texto plano → capítulos. Corta en líneas tipo "Capítulo 3"/"Chapter 3"; si no hay, uno solo. */
export function splitText(text, fallbackTitle) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const chapters = [];
  let cur = null, buf = [];
  const flush = () => { const paras = buf.join('\n').split(/\n\s*\n|\n(?=\s{2,}\S)/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).map((t) => ({ t })); if (cur || paras.length) chapters.push({ title: cur || fallbackTitle, paras }); buf = []; };
  for (const l of lines) { if (HEAD_RE.test(l) && l.trim().length < 90) { if (cur || buf.some((x) => x.trim())) flush(); cur = l.trim(); } else buf.push(l); }
  flush();
  return chapters.filter((c) => c.paras.length);
}

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dt,dd';
/** XHTML de un capítulo → párrafos de texto (sin etiquetas). */
export function htmlToParas(html) {
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
  const d = doc.querySelector('parsererror') ? new DOMParser().parseFromString(html, 'text/html') : doc;
  d.querySelectorAll('script,style,nav,head').forEach((e) => e.remove());
  const body = d.body || d.documentElement;
  const els = [...body.querySelectorAll(BLOCKS)].filter((e) => !e.parentElement?.closest(BLOCKS));
  const out = els.map((e) => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), ...(/^H\d$/i.test(e.tagName) ? { h: 1 } : {}) })).filter((p) => p.t);
  if (out.length) return out;
  return (body.textContent || '').split(/\n\s*\n/).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).map((t) => ({ t }));
}

/** EPUB → {title, author, chapters:[{title, paras}]}. Rechaza EPUB con DRM (no se descifra). */
export async function parseEpub(file) {
  const zip = await JSZip.loadAsync(file);
  // DRM: cualquier recurso cifrado que no sea una fuente tipográfica ofuscada (eso es legítimo en EPUB).
  const enc = await zip.file('META-INF/encryption.xml')?.async('text');
  if (enc && [...enc.matchAll(/URI="([^"]+)"/g)].some((m) => !/\.(otf|ttf|woff2?)$/i.test(m[1]))) throw new Error('El EPUB tiene DRM: no se puede importar.');
  const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const cont = zip.file('META-INF/container.xml');
  if (!cont) throw new Error('No es un EPUB válido (falta container.xml).');
  const opfPath = xml(await cont.async('text')).querySelector('rootfile')?.getAttribute('full-path');
  const opfFile = opfPath && zip.file(opfPath);
  if (!opfFile) throw new Error('No es un EPUB válido (falta el OPF).');
  const opf = xml(await opfFile.async('text'));
  const baseDir = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
  const ln = (e) => (e.localName || e.tagName || '').replace(/^.*:/, '').toLowerCase();
  const meta = (n) => [...opf.getElementsByTagName('*')].find((e) => ln(e) === n)?.textContent?.trim();
  const items = new Map([...opf.getElementsByTagName('*')].filter((e) => ln(e) === 'item').map((e) => [e.getAttribute('id'), e.getAttribute('href')]));
  const spine = [...opf.getElementsByTagName('*')].filter((e) => ln(e) === 'itemref' && e.getAttribute('linear') !== 'no').map((e) => items.get(e.getAttribute('idref'))).filter(Boolean);
  const chapters = [];
  for (const href of spine) {
    const path = decodeURIComponent(baseDir + href.split('#')[0]).replace(/[^/]+\/\.\.\//g, '');
    const f = zip.file(path);
    if (!f) continue;
    const paras = htmlToParas(await f.async('text'));
    if (!paras.length || paras.reduce((n, p) => n + p.t.length, 0) < 40) continue; // portadas, índices vacíos
    chapters.push({ title: paras.find((p) => p.h)?.t?.slice(0, 120) || `Capítulo ${chapters.length + 1}`, paras });
  }
  return { title: meta('title'), author: meta('creator'), chapters };
}

/** Texto de un archivo: UTF-8 (con o sin BOM) o, si no es UTF-8 válido, Windows-1252 (Latin-1). */
export async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

// Un capítulo enorme (un TXT sin encabezados, por ejemplo) se parte en partes para no crear
// decenas de miles de nodos en el lector.
export const MAX_PARAS = 400;
export function splitLong(chapters) {
  return chapters.flatMap((c) => {
    if (c.paras.length <= MAX_PARAS) return [c];
    const n = Math.ceil(c.paras.length / MAX_PARAS);
    return Array.from({ length: n }, (_, k) => ({ title: `${c.title} (parte ${k + 1} de ${n})`, paras: c.paras.slice(k * MAX_PARAS, (k + 1) * MAX_PARAS) }));
  });
}

/** Archivos de novela → grupos con el mismo formato que parseFiles (pages = [Blob de texto]). */
export async function parseNovels(files) {
  const out = [];
  for (const f of files) {
    const name = f.name.replace(/\.[^.]+$/, '');
    let book;
    if (/\.epub$/i.test(f.name)) book = await parseEpub(f);
    else book = { title: guessSeries(name), chapters: splitText(await readText(f), name) };
    book.chapters = splitLong(book.chapters);
    book.chapters.forEach((c, i) => out.push({ title: c.title, number: book.chapters.length > 1 ? i + 1 : guessNumber(name), series: book.title || name, author: book.author, kind: 'text', pages: [textBlob(c.title, c.paras)] }));
  }
  return out;
}
