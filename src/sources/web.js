// Fuente "Web": analiza una URL (capítulo o serie) y extrae imágenes / enlaces a capítulos.
// Úsalo solo con contenido que tengas derecho a descargar.
import { loadSettings } from '../settings.js';
import { guessSeries, guessNumber, IMG_RE } from '../importers.js';
import { loadDoc } from './engine.js';
import { chaptersFromDoc, seriesMeta, finalize, CH_RE } from './chapters.js';
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

export function proxied(url, referer, hosts) {
  const p = activeProxy();
  if (!p) return url;
  if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(url));
  return p + encodeURIComponent(url) + (referer ? '&referer=' + encodeURIComponent(referer) : '') + (hosts?.length ? '&hosts=' + encodeURIComponent(hosts.join(',')) : '');
}

/** ¿El host de la URL está en la política? (exacto con puerto, o "*.dominio" para subdominios) */
export function hostInPolicy(url, hosts) {
  let u; try { u = new URL(url); } catch { return false; }
  const host = u.host.toLowerCase(); const [hh, hp] = host.split(':');
  return hosts.some((a) => { if (!a.startsWith('*.')) return host === a; const [ah, ap] = a.slice(2).split(':'); return hh.endsWith('.' + ah) && hp === ap; });
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
export async function fetchVia(url, as = 'text', referer, trace, { hosts } = {}) {
  // Con "hosts" (extensiones JSON) la petición y sus redirecciones solo pueden ir a esos dominios:
  // el proxy propio lo hace cumplir en cada salto e informa la URL final; en acceso directo no se
  // siguen redirecciones (el navegador no deja ver a dónde van); los proxies públicos no se usan.
  const strict = hosts?.length > 0;
  if (strict && !hostInPolicy(url, hosts)) throw Object.assign(new Error(`Dominio no autorizado por la extensión (${new URL(url).host})`), { status: 403, source: 'policy', policy: true });
  const attempt = async (via, target) => {
    const t0 = performance.now();
    const rec = { via, ok: false };
    try {
      const res = await fetch(target, strict && via === 'directo' ? { redirect: 'manual' } : undefined);
      if (strict && res.type === 'opaqueredirect') { rec.source = 'policy'; throw new Error('la fuente respondió con una redirección; sin el proxy propio no se puede verificar su destino'); }
      if (strict && via !== 'directo') {
        const fin = res.headers.get('x-final-url');
        if (!fin && res.ok) { rec.source = 'policy'; throw new Error('el proxy configurado no informa el destino final de las redirecciones'); }
        if (fin && !hostInPolicy(fin, hosts)) { rec.source = 'policy'; throw new Error(`redirección a un dominio no autorizado (${new URL(fin).host})`); }
      }
      if (strict && via === 'directo' && res.url && !hostInPolicy(res.url, hosts)) { rec.source = 'policy'; throw new Error(`redirección a un dominio no autorizado (${new URL(res.url).host})`); }
      rec.status = res.status;
      if (!res.ok) {
        // ¿Quién respondió con error? El backend marca sus propios errores; el resto es del sitio.
        if (res.headers.get('x-manhuua-error')) {
          rec.source = 'backend';
          let msg = ''; try { msg = (await res.text()).replace(/^manhuua-proxy:\s*/, ''); try { msg = JSON.parse(msg).error || msg; } catch {} } catch {}
          throw new Error(`backend ${res.status}${msg ? ': ' + msg.slice(0, 160) : ''}`);
        }
        rec.source = 'site';
        rec.server = res.headers.get('x-upstream-server') || undefined;
        rec.challenge = res.headers.get('x-upstream-challenge') === '1' || undefined;
        throw new Error(`HTTP ${res.status}`);
      }
      if (res.redirected && via === 'directo') rec.finalUrl = res.url;
      const out = as === 'blob' ? await res.blob() : await res.text();
      if (as === 'blob' && out.type.startsWith('text/') && out.size < 2000) throw new Error('respuesta inválida (no es imagen)');
      rec.ok = true; rec.bytes = out.size ?? out.length;
      return out;
    } catch (e) {
      rec.error = e.message === 'Failed to fetch' || e.name === 'TypeError' ? (via === 'directo' ? 'bloqueado (CORS o red)' : 'sin conexión') : e.message;
      if (!rec.source) rec.source = rec.status ? 'site' : 'network';
      throw Object.assign(new Error(rec.error), { status: rec.status, source: rec.source, challenge: rec.challenge, backend: rec.source === 'backend' });
    } finally { rec.ms = Math.round(performance.now() - t0); trace?.push(rec); }
  };
  if (activeProxy()) {
    try { return await attempt('proxy propio', proxied(url, referer, hosts)); }
    catch (e) {
      // Con el backend configurado al compilar: si no responde, está ocupado o limitado, se sigue
      // con los caminos de siempre (directo / proxies públicos). Un proxy elegido en Ajustes no cambia.
      const fallback = e.source !== 'policy' && BACKEND && !loadSettings().proxy?.trim() && (!e.status || (e.backend && [429, 502, 503, 504].includes(e.status)));
      if (!fallback) throw Object.assign(new Error(`Proxy propio: ${e.message} en ${new URL(url).hostname}`), { status: e.status, source: e.source, challenge: e.challenge });
    }
  }
  let last;
  try { return await attempt('directo', url); } catch (e) {
    last = e;
    if (e.status) throw Object.assign(new Error(`HTTP ${e.status} en ${new URL(url).hostname}`), { status: e.status, source: 'site' }); // el sitio respondió: un proxy no cambia el resultado
    if (e.source === 'policy') throw Object.assign(new Error(e.message), { source: 'policy', policy: true });
    if (!usingPublicProxy() || strict) throw new Error(strict ? 'Bloqueado por CORS: las extensiones JSON necesitan acceso directo o el proxy propio (no se usan proxies públicos)' : 'Bloqueado por CORS: activá el proxy automático o configurá uno en Ajustes');
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

function abs(u, base) { try { return new URL(u.trim(), base).href; } catch { return null; } }
const dirOf = (u) => { try { const x = new URL(u); return x.host + x.pathname.replace(/[^/]*$/, ''); } catch { return ''; } };
const largestGroup = (list) => {
  const groups = new Map();
  list.forEach((u) => groups.set(dirOf(u), [...(groups.get(dirOf(u)) || []), u]));
  return [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
};

/**
 * Imágenes del contenedor del lector: el elemento más interno que reúne al menos el 80 % de las
 * imágenes sueltas (no enlazadas). Conserva el orden y admite páginas servidas desde otra carpeta
 * o CDN (antes solo se tomaba la carpeta más numerosa y se perdían esas páginas).
 */
function readerImages(els) {
  if (els.length < 3) return null;
  const count = new Map();
  for (const [img] of els) {
    let n = img.parentElement, d = 0;
    while (n && d < 8) { count.set(n, (count.get(n) || 0) + 1); n = n.parentElement; d++; }
  }
  const need = Math.max(3, Math.ceil(els.length * 0.8));
  // Los candidatos están anidados (todos reúnen ≥80 %): se toma el más interno.
  const cands = [...count.entries()].filter(([, c]) => c >= need).map(([el]) => el);
  const inner = cands.find((el) => !cands.some((o) => o !== el && el.contains(o)));
  if (!inner) return null;
  const box = { el: inner };
  return [...new Set(els.filter(([img]) => box.el.contains(img)).map(([, u]) => u))];
}

/**
 * Analiza una página. Es "capítulo" si tiene imágenes de lectura (≥3, de la misma carpeta y que
 * no son enlaces a otras páginas, como las portadas); es "serie" si tiene una lista de capítulos.
 * Las portadas de obras relacionadas ya no convierten una ficha en capítulo.
 */
export function extract(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.querySelector('base[href]')?.getAttribute('href') || pageUrl;
  const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const ogAbs = og ? abs(og, base) : null;

  // Imágenes en orden de aparición, separando las que están dentro de enlaces (portadas, banners).
  const free = [], linked = [], freeEls = [];
  for (const img of doc.querySelectorAll('img')) {
    for (const a of IMG_ATTRS) {
      let v = img.getAttribute(a);
      if (!v || v.startsWith('data:')) continue;
      if (a.includes('srcset')) v = v.split(',').pop().trim().split(/\s+/)[0];
      const u = abs(v, base);
      if (u) {
        if (img.closest('a[href]')) linked.push(u);
        else if (!JUNK.test(u) && u !== ogAbs) { free.push(u); freeEls.push([img, u]); }
        break;
      }
    }
  }
  const tidy = (l) => [...new Set(l)].filter((u) => !JUNK.test(u) && u !== ogAbs);
  let reading = readerImages(freeEls) || largestGroup(tidy(free));
  const { chapters, strategy, unresolved } = chaptersFromDoc(doc, base, pageUrl);
  // Respaldo: páginas listadas en scripts/JSON (lectores que arman las imágenes con JavaScript),
  // solo si la página no es una ficha con lista de capítulos.
  if (reading.length < 3 && chapters.length < 3) {
    const raw = html.replace(/\\\//g, '/');
    const fromScripts = largestGroup(tidy(raw.match(/https?:\/\/[^"'\s<>()]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^"'\s<>()]*)?/gi) || []).filter((u) => !linked.includes(u)));
    if (fromScripts.length >= 3) reading = fromScripts;
  }
  const isChapter = reading.length >= 3;
  const meta = seriesMeta(doc, base);
  const title = (meta.title || new URL(pageUrl).pathname).replace(/\s+/g, ' ').split(/\s[|–—]\s|\s-\s(?=[^-]*$)/)[0].trim();
  const own = CH_RE.exec(title) || CH_RE.exec(decodeURIComponent(new URL(pageUrl).pathname));
  return {
    url: pageUrl,
    title,
    series: isChapter ? guessSeries(title) : title,
    number: isChapter ? (own ? parseFloat(own[2].replace(',', '.')) : guessNumber(pageUrl.replace(/\/$/, ''))) : null,
    images: isChapter ? reading : [],
    cover: !isChapter ? meta.cover : null,
    chapters: isChapter ? [] : finalize(chapters),
    chaptersStrategy: strategy,
    unresolvedChapters: unresolved,
    meta,
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
