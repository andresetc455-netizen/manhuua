// Fuente "Web": analiza una URL (capítulo o serie) y extrae imágenes / enlaces a capítulos.
// Úsalo solo con contenido que tengas derecho a descargar.
import { loadSettings } from '../settings.js';
import { guessSeries, guessNumber, IMG_RE } from '../importers.js';
import { loadDoc } from './engine.js';
import { BACKEND, wakeBackend } from '../backend.js';

let autoProxy = '';
/** Detecta el proxy del servidor incluido (server/proxy.mjs) si la app se sirve desde él. */
export async function detectProxy() {
  if (BACKEND) { autoProxy = `${BACKEND}/proxy?url=`; wakeBackend(); return autoProxy; }
  try {
    const r = await fetch('./proxy?url=', { cache: 'no-store' });
    if (r.status === 400 && (await r.text()).includes('manhuua-proxy')) autoProxy = './proxy?url=';
  } catch {}
  return autoProxy;
}
export const activeProxy = () => loadSettings().proxy?.trim() || autoProxy;

export function proxied(url, referer) {
  const p = activeProxy();
  if (!p) return url;
  if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
  return p + encodeURIComponent(url) + (referer ? '&referer=' + encodeURIComponent(referer) : '');
}

// Proxies CORS públicos que se usan automáticamente si no hay uno propio configurado.
const PUBLIC = [
  (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
];
let preferred = 0;
export const usingPublicProxy = () => !activeProxy() && loadSettings().publicProxy !== false;


/**
 * Descarga una URL como texto o Blob. Si se pasa `trace` (array), registra cada intento
 * {via, ok, status, error, ms, bytes, finalUrl} para el diagnóstico.
 */
export async function fetchVia(url, as = 'text', referer, trace) {
  const attempt = async (via, target) => {
    const t0 = performance.now();
    const rec = { via, ok: false };
    try {
      const res = await fetch(target);
      rec.status = res.status;
      if (!res.ok && res.headers.get('x-manhuua-error')) rec.backend = true; // error del backend, no del sitio
      if (res.redirected && via === 'directo') rec.finalUrl = res.url;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = as === 'blob' ? await res.blob() : await res.text();
      if (as === 'blob' && out.type.startsWith('text/') && out.size < 2000) throw new Error('respuesta inválida (no es imagen)');
      rec.ok = true; rec.bytes = out.size ?? out.length;
      return out;
    } catch (e) {
      rec.error = e.message === 'Failed to fetch' || e.name === 'TypeError' ? (via === 'directo' ? 'bloqueado (CORS o red)' : 'sin conexión') : e.message;
      throw Object.assign(new Error(rec.error), { status: rec.status, backend: rec.backend });
    } finally { rec.ms = Math.round(performance.now() - t0); trace?.push(rec); }
  };
  if (activeProxy()) {
    try { return await attempt('proxy propio', proxied(url, referer)); }
    catch (e) {
      // Con el backend configurado al compilar: si no responde, está ocupado o limitado, se sigue
      // con los caminos de siempre (directo / proxies públicos). Un proxy elegido en Ajustes no cambia.
      const fallback = BACKEND && !loadSettings().proxy?.trim() && (!e.status || (e.backend && [429, 502, 503, 504].includes(e.status)));
      if (!fallback) throw new Error(`Proxy propio: ${e.message} en ${new URL(url).hostname}`);
    }
  }
  let last;
  try { return await attempt('directo', url); } catch (e) {
    last = e;
    if (e.status) throw new Error(`HTTP ${e.status} en ${new URL(url).hostname}`); // el sitio respondió: un proxy no cambia el resultado
    if (!usingPublicProxy()) throw new Error('Bloqueado por CORS: activá el proxy automático o configurá uno en Ajustes');
  }
  for (let k = 0; k < PUBLIC.length; k++) {
    const i = (preferred + k) % PUBLIC.length;
    try { const out = await attempt(`proxy público ${new URL(PUBLIC[i]('x')).hostname}`, PUBLIC[i](url)); preferred = i; return out; }
    catch (e) { last = e; }
  }
  throw new Error(`No se pudo leer ${new URL(url).hostname} (${last?.message || 'sin respuesta'}).`);
}

const IMG_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-cfsrc', 'data-srcset', 'srcset', 'src'];
const JUNK = /(logo|avatar|icon|favicon|banner|sprite|emoji|badge|loading|placeholder|spinner|\/ads?\/|pixel)/i;
const CH_RE = /(cap[ií]tulo|chapter|cap|ch|episodio|episode|ep)[\s._#-]*(\d+(?:\.\d+)?)/i;

function abs(u, base) { try { return new URL(u.trim(), base).href; } catch { return null; } }
const dirOf = (u) => { try { const x = new URL(u); return x.host + x.pathname.replace(/[^/]*$/, ''); } catch { return ''; } };

export function extract(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.querySelector('base[href]')?.getAttribute('href') || pageUrl;

  // Imágenes en orden de aparición
  let imgs = [];
  for (const img of doc.querySelectorAll('img')) {
    for (const a of IMG_ATTRS) {
      let v = img.getAttribute(a);
      if (!v || v.startsWith('data:')) continue;
      if (a.includes('srcset')) v = v.split(',').pop().trim().split(/\s+/)[0];
      const u = abs(v, base);
      if (u) { imgs.push(u); break; }
    }
  }
  // Respaldo: URLs de imágenes embebidas en scripts/JSON
  if (imgs.length < 3) {
    const raw = html.replace(/\\\//g, '/');
    imgs.push(...(raw.match(/https?:\/\/[^"'\s<>()]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^"'\s<>()]*)?/gi) || []));
  }
  imgs = [...new Set(imgs)].filter((u) => !JUNK.test(u));
  // Quedarse con el grupo (carpeta) más numeroso: suelen ser las páginas del capítulo
  const groups = new Map();
  imgs.forEach((u) => groups.set(dirOf(u), [...(groups.get(dirOf(u)) || []), u]));
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
  if (best.length >= 3) imgs = best;

  // Enlaces a capítulos
  const seen = new Set(), chapters = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = abs(a.getAttribute('href'), base);
    if (!href || seen.has(href) || href.split('#')[0] === pageUrl.split('#')[0]) continue;
    const text = a.textContent.replace(/\s+/g, ' ').trim();
    const m = text.match(CH_RE) || decodeURIComponent(new URL(href).pathname).match(CH_RE);
    if (!m) continue;
    seen.add(href);
    chapters.push({ url: href, title: text.slice(0, 80) || `Capítulo ${m[2]}`, number: parseFloat(m[2]) });
  }
  chapters.sort((a, b) => a.number - b.number);

  const rawTitle = doc.querySelector('meta[property="og:title"]')?.content || doc.querySelector('h1')?.textContent || doc.title || new URL(pageUrl).pathname;
  const title = rawTitle.replace(/\s+/g, ' ').split(/\s[|–—]\s|\s-\s(?=[^-]*$)/)[0].trim();
  const isChapter = imgs.length >= 3;
  const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  return {
    url: pageUrl,
    title,
    series: isChapter ? guessSeries(title) : title,
    number: isChapter ? (title.match(CH_RE) ? parseFloat(title.match(CH_RE)[2]) : guessNumber(pageUrl.replace(/\/$/, ''))) : null,
    images: imgs,
    cover: !isChapter && og ? abs(og, base) : null,
    chapters: isChapter ? [] : chapters,
    kind: isChapter ? 'chapter' : chapters.length ? 'series' : 'empty',
  };
}

export async function analyze(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('La URL debe empezar con http:// o https://');
  // URL directa a una imagen
  if (IMG_RE.test(new URL(url).pathname)) return { url, title: 'Imagen', series: 'Descargas', number: null, images: [url], chapters: [], kind: 'chapter' };
  const { html, base } = await loadDoc(url, { kind: 'chapter', min: 1, count: (h, u) => { const i = extract(h, u); return i.images.length >= 3 ? i.images.length : i.chapters.length; } });
  return { ...extract(html, base), url };
}
