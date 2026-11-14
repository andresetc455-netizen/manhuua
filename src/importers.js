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
  const out = [];
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
