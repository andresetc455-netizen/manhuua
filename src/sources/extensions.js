// Extensiones = sitios o fuentes que agrega el usuario.
// Tipos: "web" (HTML, con datos embebidos y renderizado opcional), "api" (JSON público) y "catalog" (JSON propio de Manhuua).
import { useEffect, useState } from 'react';
import { fetchVia, extract } from './web.js';
import { loadDoc, explain, classify } from './engine.js';
import { mBrowse, mDetail, mPages, validateManifest, fetchManifest, isManifest, hostPolicy } from './manifest.js';
import { itemsFromJson, embeddedJson } from './jsonwalk.js';
import { chaptersFromJson, chaptersFromDoc, nextChaptersPage, nextJsonPage, metaFromJson, finalize } from './chapters.js';
import { catalogSource } from './catalog.js';
import { MD_ID, MD_IDENTITY, MD_HOSTS, MD_DEFAULTS, mdExtensionBase, mdBrowse, mdDetail, mdPages, isMd } from './mangadex.js';

const KEY = 'manhuua.extensions';
const subs = new Set();
let list = load();
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save(l) { list = l; try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} subs.forEach((f) => f(l)); }

export const getExtension = (id) => list.find((e) => e.id === id);

// ---- Identidad estable ----
// Una extensión JSON se identifica por el id de su manifiesto MÁS el dominio normalizado de su
// baseUrl: el mismo id publicado desde otro dominio es otra fuente. Un sitio/API se identifica por su
// URL exacta (nunca por el nombre). Al eliminarla se recuerda su id local; si se reinstala la misma
// identidad, recupera ese id y la biblioteca (obras, capítulos, progreso) vuelve a apuntarle.
const GONE = 'manhuua.extensions.removed';
const loadGone = () => { try { return JSON.parse(localStorage.getItem(GONE)) || {}; } catch { return {}; } };
const saveGone = (g) => { try { const e = Object.entries(g).sort((a, b) => b[1].at - a[1].at).slice(0, 300); localStorage.setItem(GONE, JSON.stringify(Object.fromEntries(e))); } catch {} };
/** Dominio normalizado de una URL: host en minúsculas (con puerto si no es el estándar), sin punto final. */
export function normDomain(url) {
  try { const u = new URL(url); return u.hostname.toLowerCase().replace(/\.$/, '') + (u.port ? ':' + u.port : ''); } catch { return ''; }
}
const manifestIdentity = (m) => `manifest:${m.id}@${normDomain(m.baseUrl)}`;
export function identityOf(x) {
  if (x.type === 'mangadex') return MD_IDENTITY;
  if (x.manifest?.id) return manifestIdentity(x.manifest);
  try { const u = new URL(x.url); return `${x.type}:${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`; } catch { return `${x.type}:${x.url}`; }
}
/** Ids locales que tuvo una identidad (eliminadas antes), para recuperar la asociación. */
export const formerIds = (identity) => Object.entries(loadGone()).filter(([, v]) => v.identity === identity).map(([id]) => id);
export const removedInfo = (id) => loadGone()[id];
function stableId(identity, ...preferred) {
  const old = formerIds(identity).find((id) => !getExtension(id));
  if (old) return old;
  const free = (id) => id && !getExtension(id) && !(loadGone()[id] && loadGone()[id].identity !== identity);
  return preferred.find(free) || Math.random().toString(36).slice(2, 9);
}
export const isEnabled = (x) => x.enabled !== false;
/**
 * Extensión dueña de una URL interna "mf:<id-del-manifiesto>/...". Si se conoce la fuente del capítulo
 * (extId) manda solo esa: nunca se reasigna a otra extensión con el mismo id de manifiesto (podría ser
 * de otro dominio). Sin extId, solo si hay una única candidata.
 */
export const extensionForUrl = (url = '', fallbackId) => {
  if (fallbackId) return getExtension(fallbackId);
  if (isMd(url)) return list.find((e) => e.type === 'mangadex');
  if (!/^mf:/.test(url)) return undefined;
  const c = list.filter((e) => e.manifest?.id === url.slice(3).split('/')[0]);
  return c.length === 1 ? c[0] : undefined;
};
export function useExtensions() {
  const [l, set] = useState(list);
  useEffect(() => (subs.add(set), () => subs.delete(set)), []);
  return l;
}


/** Detecta el tipo de una URL: catálogo Manhuua, API JSON o página web. */
async function detectType(url) {
  try {
    const t = await fetchVia(url);
    const j = JSON.parse(t);
    return { type: isManifest(j) ? 'manifest' : Array.isArray(j?.series) ? 'catalog' : 'api', json: j };
  } catch { return { type: 'web' }; }
}

/**
 * Cambios sensibles entre dos manifiestos: dominio o URL base, referer y dominios autorizados nuevos.
 * Ninguno se aplica sin confirmación explícita (no se reemplazan en silencio).
 */
export function sensitiveChanges(a, b) {
  const out = [];
  const da = normDomain(a.baseUrl), db = normDomain(b.baseUrl);
  if (da !== db) out.push({ field: 'dominio', from: da, to: db });
  else if (String(a.baseUrl).replace(/\/+$/, '') !== String(b.baseUrl).replace(/\/+$/, '')) out.push({ field: 'baseUrl', from: a.baseUrl, to: b.baseUrl });
  if ((a.referer || '') !== (b.referer || '')) out.push({ field: 'referer', from: a.referer || '(ninguno)', to: b.referer || '(ninguno)' });
  const ha = new Set(hostPolicy(a)), added = hostPolicy(b).filter((h) => !ha.has(h) && h !== db);
  if (added.length) out.push({ field: 'hosts', from: '', to: added.join(', ') });
  return out;
}
export const describeChanges = (ch) => ch.map((c) => c.field === 'hosts' ? `• Dominios autorizados nuevos: ${c.to}` : `• ${c.field === 'dominio' ? 'Dominio' : c.field === 'baseUrl' ? 'URL base' : 'Referer'}: ${c.from} → ${c.to}`).join('\n');
/** Confirmación explícita (diálogo del navegador) de cambios sensibles de una extensión. */
export const confirmChanges = ({ ext, text }) => window.confirm(`La extensión "${ext.name}" quiere cambiar:\n\n${text}\n\nLas obras, capítulos y progreso seguirán asociados a ella y sus pedidos irán a los datos nuevos.\n¿Aplicar el cambio? (Cancelar la deja como estaba.)`);
const cancelled = () => Object.assign(new Error('Actualización cancelada: la extensión no se modificó.'), { cancelled: true });

/** Aplica un manifiesto nuevo a una extensión existente (misma id local), confirmando lo sensible. */
async function applyUpdate(prev, manifest, manifestUrl, confirm) {
  const ch = sensitiveChanges(prev.manifest, manifest);
  if (ch.length && !(confirm && (await confirm({ ext: prev, manifest, changes: ch, text: describeChanges(ch) })))) throw cancelled();
  updateExtension(prev.id, { ...manifestBase(manifest, manifestUrl || prev.manifestUrl), status: { state: 'available', at: Date.now() } });
  return getExtension(prev.id);
}
const manifestBase = (manifest, manifestUrl) => ({ type: 'manifest', manifest, manifestUrl: manifestUrl || '', name: String(manifest.name).slice(0, 40), version: String(manifest.version), url: manifest.baseUrl, searchUrl: manifest.search ? 'manifest' : '', icon: manifest.icon || `${new URL(manifest.baseUrl).origin}/favicon.ico` });

/**
 * Instala una extensión JSON. Si ya está instalada la MISMA identidad (id + dominio) se actualiza
 * (lo sensible pide confirmación con `confirm`). El mismo id desde otro dominio se instala como una
 * fuente distinta: no reemplaza a la existente ni hereda sus obras, capítulos o progreso.
 */
export async function installManifest(manifest, manifestUrl, { confirm } = {}) {
  const errs = validateManifest(manifest);
  if (errs.length) throw new Error('Extensión inválida: ' + errs.join(' '));
  const identity = manifestIdentity(manifest);
  const prev = list.find((e) => e.type === 'manifest' && identityOf(e) === identity);
  if (prev) return applyUpdate(prev, manifest, manifestUrl, confirm);
  const dom = normDomain(manifest.baseUrl);
  const twin = list.some((e) => e.manifest?.id === manifest.id) || Object.values(loadGone()).some((g) => g.manifestId === manifest.id && g.identity !== identity);
  const base = manifestBase(manifest, manifestUrl);
  if (twin) base.name = `${String(manifest.name).slice(0, 26)} (${dom})`.slice(0, 40); // se distingue de la homónima
  const ext = { id: stableId(identity, `mf-${manifest.id}`, `mf-${manifest.id}--${dom.replace(/[^a-z0-9]+/g, '-')}`), ...base, enabled: true, addedAt: Date.now(), status: { state: 'available', at: Date.now() } };
  save([...list, ext]);
  return ext;
}

/** Vuelve a leer el manifiesto desde su URL. Un cambio de dominio, referer o hosts pide confirmación. */
export async function refreshExtension(id, { confirm } = {}) {
  const x = getExtension(id);
  if (x?.type !== 'manifest' || !x.manifestUrl) return { ext: x, changed: false };
  const m = await fetchManifest(x.manifestUrl);
  const from = x.version;
  if (m.id !== x.manifest.id) throw new Error(`El archivo es de otra extensión ("${m.id}").`);
  const errs = validateManifest(m);
  if (errs.length) throw new Error('Extensión inválida: ' + errs.join(' '));
  const ext = await applyUpdate(x, m, x.manifestUrl, confirm);
  return { ext, changed: from !== ext.version || normDomain(m.baseUrl) !== normDomain(x.manifest.baseUrl), from, to: ext.version };
}

/**
 * Fuentes integradas (no hace falta pegar JSON). Reinstalar recupera el mismo id local, así la
 * biblioteca (obras, capítulos, progreso, descargas) vuelve a quedar asociada sin duplicar.
 */
export const NATIVE = { mangadex: { name: 'MangaDex', identity: MD_IDENTITY, id: MD_ID, base: mdExtensionBase, options: MD_DEFAULTS, about: 'API oficial y pública. Catálogo, fichas, capítulos por idioma y grupo, y lectura en línea por MangaDex@Home a través del backend propio. Contenido de MangaDex y de sus grupos de traducción.' } };
export function installNative(key) {
  const n = NATIVE[key];
  if (!n) throw new Error('Fuente integrada desconocida.');
  const prev = list.find((e) => identityOf(e) === n.identity);
  if (prev) { updateExtension(prev.id, { ...n.base() }); return getExtension(prev.id); }
  const ext = { id: stableId(n.identity, n.id), ...n.base(), options: { ...n.options }, enabled: true, addedAt: Date.now(), status: { state: 'available', at: Date.now() } };
  save([...list, ext]);
  return ext;
}

export async function addExtension({ url, name, searchUrl, json, confirm }) {
  if (json) return installManifest(typeof json === 'string' ? JSON.parse(json) : json, undefined, { confirm });
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const u = new URL(url.replace(/\{page\}|\{q\}/g, '1'));
  const { type, json: data } = await detectType(u.href);
  if (type === 'manifest') return installManifest(data, u.href, { confirm });
  let title = name?.trim();
  if (!title) {
    try {
      if (type === 'catalog') title = data.name;
      else if (type === 'api') title = `${u.hostname} (API)`;
      else {
        const doc = new DOMParser().parseFromString(await fetchVia(u.href), 'text/html');
        title = doc.querySelector('meta[property="og:site_name"]')?.content || doc.title.split(/\s[|–—-]\s/)[0];
      }
    } catch {}
  }
  const dup = list.find((x) => identityOf(x) === identityOf({ type, url }));
  if (dup) return dup; // la misma extensión ya está instalada: no se duplica
  const ext = { id: stableId(identityOf({ type, url })), type, url, name: (title || u.hostname).trim().slice(0, 40), searchUrl: searchUrl?.trim() || '', icon: `${u.origin}/favicon.ico`, addedAt: Date.now(), enabled: true, status: { state: 'available', at: Date.now() } };
  save([...list, ext]);
  return ext;
}
export const updateExtension = (id, patch) => save(list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
export function removeExtension(id) {
  const x = getExtension(id);
  if (x) { const g = loadGone(); g[id] = { identity: identityOf(x), name: x.name, manifestId: x.manifest?.id, domain: normDomain(x.manifest?.baseUrl || x.url), at: Date.now() }; saveGone(g); }
  save(list.filter((e) => e.id !== id));
}

const IMG_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'data-lazy', 'data-url', 'data-bg', 'data-background', 'data-background-image', 'data-srcset', 'srcset', 'src'];
const toAbs = (v, base) => { try { return new URL(v.trim(), base).href; } catch { return null; } };
function imgSrc(el, base) {
  for (const a of IMG_ATTRS) {
    let v = el.getAttribute?.(a);
    if (!v || v.startsWith('data:') || !/[./]/.test(v)) continue;
    if (a.includes('srcset')) v = v.split(',').pop().trim().split(/\s+/)[0];
    const u = toAbs(v, base); if (u) return u;
  }
  const src = el.closest?.('picture')?.querySelector('source[srcset], source[data-srcset]');
  if (src) { const v = (src.getAttribute('srcset') || src.getAttribute('data-srcset')).split(',').pop().trim().split(/\s+/)[0]; const u = toAbs(v, base); if (u) return u; }
  const bg = el.getAttribute?.('style')?.match(/url\(['"]?([^'")]+)/);
  return bg ? toAbs(bg[1], base) : null;
}
const CH_ONLY = /(cap[ií]tulo|chapter|episodio|episode)[\s._#/-]*\d+/i;
const JUNK = /logo|avatar|icon|banner|sprite|emoji|flag|badge|ads?\//i;

/** Obras a partir de tarjetas HTML (imagen + enlace en el mismo contenedor). */
function cardsFromHtml(doc, base, host) {
  const out = new Map();
  for (const el of doc.querySelectorAll('img, picture, [style*="background-image"], [data-bg], [data-background-image]')) {
    const cover = imgSrc(el.tagName === 'PICTURE' ? (el.querySelector('img') || el) : el, base);
    if (!cover || JUNK.test(cover)) continue;
    // subir hasta encontrar un contenedor que tenga un enlace
    let a = el.closest('a[href]'), card = a;
    for (let n = el.parentElement, d = 0; !a && n && d < 4; n = n.parentElement, d++) { a = n.querySelector('a[href]'); card = n; }
    if (!a) continue;
    let href;
    try { href = new URL(a.getAttribute('href'), base); } catch { continue; }
    if (!/^https?:$/.test(href.protocol) || href.pathname === '/' || CH_ONLY.test(href.pathname)) continue;
    if (host && href.host !== host && !href.host.endsWith('.' + host.replace(/^www\./, ''))) continue;
    const key = href.href.split('#')[0];
    if (out.has(key)) continue;
    const box = a.closest('article, li, figure, [class*="card"], [class*="item"], [class*="manga"], [class*="series"], [class*="comic"], [class*="post"]') || card || a.parentElement;
    const title = [
      a.getAttribute('title'), el.getAttribute?.('alt'), el.querySelector?.('img')?.getAttribute('alt'),
      box?.querySelector('h1,h2,h3,h4,h5,[class*="title"],[class*="name"]')?.textContent,
      [...(box?.querySelectorAll(`a[href="${a.getAttribute('href')}"]`) || [])].map((x) => x.textContent.trim()).find(Boolean),
      a.textContent,
    ].map((t) => (t || '').replace(/\s+/g, ' ').trim()).find((t) => t.length > 1);
    if (!title) continue;
    out.set(key, { url: key, title: title.slice(0, 90), cover });
  }
  return [...out.values()];
}

function nextPage(doc, base, pageUrl, found) {
  const next = doc.querySelector('a[rel="next"], link[rel="next"]') || [...doc.querySelectorAll('a[href]')].find((a) => /^(siguiente|next|»|›|>|más|load more|ver más)\s*[»›>]?$/i.test(a.textContent.trim()));
  if (next) return toAbs(next.getAttribute('href'), base);
  if (!found) return null;
  const m = pageUrl.match(/([?&](?:page|p|pagina)=)(\d+)/i) || pageUrl.match(/(\/page\/)(\d+)/i);
  if (m) return pageUrl.replace(m[0], m[1] + (+m[2] + 1));
  return null;
}

/** Lista de series de una página: tarjetas HTML y, si no alcanza, datos JSON embebidos. */
export function listSeries(html, pageUrl, { urlTemplate } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.querySelector('base[href]')?.getAttribute('href') || pageUrl;
  const host = new URL(pageUrl).host;
  let items = cardsFromHtml(doc, base, host), strategy = 'tarjetas HTML';
  if (items.length < 3) {
    for (const block of embeddedJson(doc)) {
      const r = itemsFromJson(block.data, base, { urlTemplate });
      if (r.items.length > items.length) { items = r.items; strategy = `datos embebidos: ${block.kind} → ${r.path}`; }
    }
  }
  return { items, next: nextPage(doc, base, pageUrl, items.length), strategy };
}

const pageOf = (tpl, page, q = '') => tpl.replace('{page}', page).replace('{q}', encodeURIComponent(q));

/** Navega una extensión: página inicial, siguiente página o búsqueda. Devuelve {items, next, diag}. */
export async function browse(ext, { url, query, page = 1, filters, signal } = {}) {
  if (ext.type === 'mangadex') return mdBrowse(ext, { query, page, filters, signal });
  if (ext.type === 'manifest') return mBrowse(ext, { query, page });
  if (ext.type === 'catalog') {
    const items = await catalogSource(ext).search(query || '');
    return { items: items.map((i) => ({ ...i, url: `catalog:${i.remoteId}` })), next: null, diag: { via: 'catalogo JSON', count: items.length } };
  }
  if (ext.type === 'api') {
    const tpl = query && ext.searchUrl ? ext.searchUrl : ext.url;
    const target = url || pageOf(tpl, page, query);
    const trace = [];
    const diag = { url: target, kind: 'catalog', attempts: trace, via: 'API JSON' };
    let data;
    try { data = JSON.parse(await fetchVia(target, 'text', undefined, trace)); }
    catch (e) { diag.httpError = e.message; diag.count = 0; diag.reasons = [e instanceof SyntaxError ? 'La respuesta no es JSON válido.' : `No se pudo descargar la API: ${e.message}`]; return { items: [], next: null, diag }; }
    const r = itemsFromJson(data, target, { urlTemplate: ext.itemUrl });
    let items = r.items;
    if (query && !ext.searchUrl) items = items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase()));
    Object.assign(diag, { count: items.length, covers: items.filter((i) => i.cover).length, strategy: r.path ? `lista JSON en ${r.path}` : 'sin lista reconocible' });
    diag.reasons = items.length ? [] : ['El JSON no contiene una lista de objetos con título e imagen.'];
    const next = tpl.includes('{page}') && items.length ? pageOf(tpl, page + 1, query) : null;
    return { items, next, nextPage: page + 1, diag };
  }
  let target = url || ext.url;
  if (query && ext.searchUrl) target = pageOf(ext.searchUrl, 1, query);
  let res, diag;
  try {
    const r = await loadDoc(target, { kind: 'catalog', count: (h, u) => listSeries(h, u, { urlTemplate: ext.itemUrl }).items.length });
    diag = r.diag;
    res = listSeries(r.html, r.base, { urlTemplate: ext.itemUrl });
  } catch (e) {
    diag = e.diag || { url: target, attempts: [], httpError: e.message };
    res = { items: [], next: null, strategy: '' };
  }
  if (query && !ext.searchUrl) res.items = res.items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase()));
  Object.assign(diag, { count: res.items.length, covers: res.items.filter((i) => i.cover).length, strategy: res.strategy });
  diag.reasons = explain(diag, 'obras');
  return { ...res, diag };
}

const looksJson = (t) => /^\s*[[{]/.test(t || '');
function countChapters(h, u) {
  if (looksJson(h)) { try { return chaptersFromJson(JSON.parse(h), u).chapters.length; } catch { return 0; } }
  const i = extract(h, u);
  return i.chapters.length || (i.images.length >= 3 ? 1 : 0);
}
const MAX_PAGES = 20;

/**
 * Detalle de una obra: datos (título, portada, descripción, autor, estado, géneros) y la lista
 * completa de capítulos (HTML, datos embebidos, API JSON; sigue la paginación de la lista).
 * Nunca inventa capítulos: si la fuente no los da, devuelve la lista vacía con el diagnóstico.
 */
export async function seriesDetail(ext, url, fallback = {}, opts = {}) {
  if (ext.type === 'mangadex') return mdDetail(ext, url, fallback, opts);
  if (ext.type === 'manifest') return mDetail(ext, url, fallback);
  if (ext.type === 'catalog') {
    const id = url.replace(/^catalog:/, '');
    const src = catalogSource(ext);
    const s = (await src.search('')).find((x) => x.remoteId === id) || {};
    const chs = await src.chapters(id);
    return { title: s.title, cover: s.cover, description: s.description, genres: [], chapters: finalize(chs.map((c) => ({ url: `${ext.url}#${id}/${c.remoteId}`, title: c.title, number: c.number, images: c.pages }))), diag: { via: 'catálogo JSON', count: chs.length, reasons: chs.length ? [] : ['El catálogo no lista capítulos para esta obra.'] } };
  }
  const { html, base, diag } = await loadDoc(url, { kind: 'series', count: countChapters });
  let out, next, strategy;
  if (looksJson(html)) {
    let data; try { data = JSON.parse(html); } catch { data = null; }
    const r = data ? chaptersFromJson(data, base) : { chapters: [], unresolved: 0 };
    const m = data ? metaFromJson(data, fallback.title) : {};
    out = { title: m.title || fallback.title, cover: fallback.cover, description: m.description, author: m.author, status: m.status, genres: m.genres || [], chapters: r.chapters, unresolved: r.unresolved };
    strategy = r.chapters.length ? `API JSON → ${r.path}` : '';
    next = data && nextJsonPage(data, base);
    for (let p = 1; next && p < MAX_PAGES; p++) {
      try {
        const d = JSON.parse(await fetchVia(next));
        const more = chaptersFromJson(d, next).chapters.filter((c) => !out.chapters.some((x) => x.url === c.url));
        if (!more.length) break;
        out.chapters.push(...more); diag.pages = p + 1;
        next = nextJsonPage(d, next);
      } catch (e) { diag.pageError = e.message; break; }
    }
  } else {
    const info = extract(html, base);
    const m = info.meta;
    out = { title: fallback.title || m.title || info.title, cover: m.cover || fallback.cover, description: m.description, author: m.author, artist: m.artist, status: m.status, genres: m.genres || [], chapters: info.chapters, unresolved: info.unresolvedChapters };
    strategy = info.chaptersStrategy;
    if (info.kind === 'chapter') {
      // La URL agregada es un capítulo (real) y no una ficha: se ofrece ese único capítulo.
      out.title = info.series; out.chapters = [{ url, title: info.title, number: info.number, images: info.images }]; strategy = 'la URL es un capítulo';
    } else {
      next = nextChaptersPage(new DOMParser().parseFromString(html, 'text/html'), base, base);
      for (let p = 1; next && p < MAX_PAGES; p++) {
        try {
          const h = await fetchVia(next);
          const doc = new DOMParser().parseFromString(h, 'text/html');
          const more = chaptersFromDoc(doc, next, next).chapters.filter((c) => !out.chapters.some((x) => x.url === c.url));
          if (!more.length) break;
          out.chapters.push(...more); diag.pages = p + 1;
          next = nextChaptersPage(doc, next, next);
        } catch (e) { diag.pageError = e.message; break; }
      }
    }
  }
  out.chapters = finalize(out.chapters);
  diag.count = out.chapters.length;
  diag.strategy = strategy;
  diag.reasons = out.chapters.length ? [] : explain(diag, 'capítulos');
  if (!out.chapters.length && out.unresolved) diag.reasons.unshift(`La página tiene datos de ${out.unresolved} capítulos pero sin su dirección (URL). Manhuua no inventa enlaces: probá con la URL de la lista de capítulos del sitio.`);
  if (diag.pageError) diag.reasons.push(`No se pudo cargar una página siguiente de la lista: ${diag.pageError}`);
  return { ...out, diag };
}

/** Imágenes de un capítulo de una extensión JSON (manifiesto). null si no corresponde. */
export async function chapterImages(url, extId) {
  if (!/^(mf|md):/.test(url || '')) return null;
  const ext = extensionForUrl(url, extId);
  if (isMd(url)) {
    if (ext?.type !== 'mangadex') throw new Error('MangaDex ya no está instalada. Los capítulos descargados se siguen leyendo; para leer en línea volvé a instalarla en Extensiones.');
    if (!isEnabled(ext)) throw new Error('MangaDex está desactivada. Activala en Extensiones para leer en línea.');
    return mdPages(ext, url);
  }
  if (!ext || ext.type !== 'manifest') throw new Error('La extensión de este capítulo ya no está instalada. Los capítulos descargados se siguen leyendo; para leer en línea volvé a instalarla.');
  if (!isEnabled(ext)) throw new Error(`La extensión "${ext.name}" está desactivada. Activala en Extensiones para leer en línea.`);
  return mPages(ext, url);
}

/** Guarda el resultado de una carga como estado de la extensión. */
export function recordStatus(ext, diag, extra = {}) {
  const c = classify(diag);
  const status = { state: c.state, kind: c.kind, label: c.label, httpStatus: c.httpStatus, ms: diag.ms ?? diag.attempts?.reduce((t, a) => t + (a.ms || 0), 0), at: Date.now(), works: diag.count ?? 0, message: diag.reasons?.[0] || '', ...extra };
  updateExtension(ext.id, { status });
  return status;
}

/**
 * Comprueba una extensión: una sola petición al catálogo y, si hay obras, la ficha de la primera.
 * No reintenta ante 401/403/429/451 (no se reintenta en absoluto).
 */
export async function checkExtension(id) {
  const ext = getExtension(id);
  if (!ext) return null;
  const t0 = Date.now();
  const r = await browse(ext, {}).catch((e) => ({ items: [], diag: e.diag || { attempts: [], httpError: e.message, reasons: [e.message] } }));
  r.diag.ms = Date.now() - t0;
  let extra = {};
  if (r.items.length) {
    try {
      const d = await seriesDetail(ext, r.items[0].url, r.items[0]);
      extra = { chapters: d.chapters.length, sample: r.items[0].title, ...(d.languages ? { languages: d.languages.slice(0, 40) } : {}), ...(r.total != null ? { total: r.total } : {}) };
      if (!d.chapters.length) { const c = classify(d.diag); extra.chapterError = `${c.label}: ${d.diag.reasons?.[0] || ''}`; }
    } catch (e) { extra = { chapters: 0, chapterError: e.message }; }
  }
  return recordStatus(ext, r.diag, extra);
}

/** Política de dominios de la extensión dueña de un capítulo "mf:" (para imágenes por proxy). */
/** Dominios autorizados de una extensión (solo JSON); undefined = extensión HTML (sin límite). */
export const extHosts = (ext) => (ext?.type === 'mangadex' ? MD_HOSTS : ext?.type === 'manifest' && ext.manifest ? hostPolicy(ext.manifest) : undefined);

export function chapterHosts(url, extId) {
  if (isMd(url)) return MD_HOSTS;
  if (!/^mf:/.test(url || '')) return undefined;
  const ext = extensionForUrl(url, extId);
  return ext?.manifest ? hostPolicy(ext.manifest) : undefined;
}
