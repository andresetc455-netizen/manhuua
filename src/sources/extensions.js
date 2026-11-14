// Extensiones = sitios o fuentes que agrega el usuario.
// Tipos: "web" (HTML, con datos embebidos y renderizado opcional), "api" (JSON público) y "catalog" (JSON propio de Manhuua).
import { useEffect, useState } from 'react';
import { fetchVia, extract } from './web.js';
import { loadDoc, explain } from './engine.js';
import { itemsFromJson, embeddedJson } from './jsonwalk.js';
import { catalogSource } from './catalog.js';

const KEY = 'manhuua.extensions';
const subs = new Set();
let list = load();
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save(l) { list = l; try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} subs.forEach((f) => f(l)); }

export const getExtension = (id) => list.find((e) => e.id === id);
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
    return { type: Array.isArray(j?.series) ? 'catalog' : 'api', json: j };
  } catch { return { type: 'web' }; }
}

export async function addExtension({ url, name, searchUrl }) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const u = new URL(url.replace(/\{page\}|\{q\}/g, '1'));
  const { type, json } = await detectType(u.href);
  let title = name?.trim();
  if (!title) {
    try {
      if (type === 'catalog') title = json.name;
      else if (type === 'api') title = `${u.hostname} (API)`;
      else {
        const doc = new DOMParser().parseFromString(await fetchVia(u.href), 'text/html');
        title = doc.querySelector('meta[property="og:site_name"]')?.content || doc.title.split(/\s[|–—-]\s/)[0];
      }
    } catch {}
  }
  const ext = { id: Math.random().toString(36).slice(2, 9), type, url, name: (title || u.hostname).trim().slice(0, 40), searchUrl: searchUrl?.trim() || '', icon: `${u.origin}/favicon.ico`, addedAt: Date.now() };
  save([...list, ext]);
  return ext;
}
export const updateExtension = (id, patch) => save(list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
export const removeExtension = (id) => save(list.filter((e) => e.id !== id));

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
export async function browse(ext, { url, query, page = 1 } = {}) {
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

/** Detalle de una serie de la extensión: título, portada, capítulos. */
export async function seriesDetail(ext, url, fallback = {}) {
  if (ext.type === 'catalog') {
    const id = url.replace(/^catalog:/, '');
    const src = catalogSource(ext);
    const s = (await src.search('')).find((x) => x.remoteId === id) || {};
    const chs = await src.chapters(id);
    return { title: s.title, cover: s.cover, description: s.description, chapters: chs.map((c) => ({ url: `${ext.url}#${id}/${c.remoteId}`, title: c.title, number: c.number, images: c.pages })) };
  }
  const { html, base, diag } = await loadDoc(url, { kind: 'series', count: (h, u) => { const i = extract(h, u); return i.chapters.length || (i.images.length >= 3 ? 1 : 0); } });
  const info = extract(html, base);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const description = (doc.querySelector('meta[property="og:description"], meta[name="description"]')?.content || '').trim();
  const og = doc.querySelector('meta[property="og:image"]')?.content;
  const cover = (og && new URL(og, base).href) || fallback.cover;
  diag.count = info.chapters.length;
  diag.reasons = info.chapters.length || info.kind === 'chapter' ? [] : explain(diag, 'capítulos');
  if (info.kind === 'chapter') return { title: info.series, cover, description, diag, chapters: [{ url, title: info.title, number: info.number, images: info.images }] };
  return { title: fallback.title || info.title, cover, description, diag, chapters: info.chapters };
}
