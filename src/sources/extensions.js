// Extensiones = sitios que agrega el usuario. Tipos: "web" (HTML genérico) y "catalog" (JSON propio).
import { useEffect, useState } from 'react';
import { fetchVia, extract } from './web.js';
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

export async function addExtension({ url, name, searchUrl }) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const u = new URL(url);
  const type = /\.json(\?|$)/i.test(u.pathname) ? 'catalog' : 'web';
  let title = name?.trim();
  if (!title) {
    try {
      if (type === 'catalog') title = await catalogSource({ url }).name();
      else {
        const doc = new DOMParser().parseFromString(await fetchVia(url), 'text/html');
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

const IMG_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'data-srcset', 'srcset', 'src'];
const imgSrc = (img, base) => {
  for (const a of IMG_ATTRS) {
    let v = img.getAttribute(a);
    if (!v || v.startsWith('data:')) continue;
    if (a.includes('srcset')) v = v.split(',').pop().trim().split(/\s+/)[0];
    try { return new URL(v, base).href; } catch {}
  }
  const bg = img.getAttribute('style')?.match(/url\(['"]?([^'")]+)/);
  return bg ? new URL(bg[1], base).href : null;
};
const CH_ONLY = /(cap[ií]tulo|chapter|episodio|episode)[\s._#-]*\d+/i;

/** Lista de series de una página del sitio (portada, directorio o búsqueda). */
export function listSeries(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.querySelector('base[href]')?.getAttribute('href') || pageUrl;
  const host = new URL(pageUrl).host;
  const out = new Map();
  for (const img of doc.querySelectorAll('img, [style*="background-image"]')) {
    const a = img.closest('a[href]') || img.parentElement?.parentElement?.querySelector('a[href]');
    if (!a) continue;
    let href;
    try { href = new URL(a.getAttribute('href'), base); } catch { continue; }
    if (href.host !== host || href.pathname === '/' || CH_ONLY.test(href.pathname)) continue;
    const key = href.href.split('#')[0];
    if (out.has(key)) continue;
    const card = a.closest('article, li, .card, [class*="item"], [class*="card"]') || a.parentElement;
    const title = (a.getAttribute('title') || img.getAttribute('alt') || card?.querySelector('h1,h2,h3,h4,h5,[class*="title"]')?.textContent || a.textContent || '')
      .replace(/\s+/g, ' ').trim();
    const cover = imgSrc(img, base);
    if (!title || !cover || /logo|avatar|icon|banner/i.test(cover)) continue;
    out.set(key, { url: key, title: title.slice(0, 90), cover });
  }
  const next = doc.querySelector('a[rel="next"]') || [...doc.querySelectorAll('a[href]')].find((a) => /^(siguiente|next|»|›|>)\s*[»›>]?$/i.test(a.textContent.trim()));
  let nextUrl = null;
  try { nextUrl = next ? new URL(next.getAttribute('href'), base).href : null; } catch {}
  return { items: [...out.values()], next: nextUrl };
}

/** Navega una extensión: página inicial, siguiente página o búsqueda. */
export async function browse(ext, { url, query } = {}) {
  if (ext.type === 'catalog') {
    const src = catalogSource(ext);
    const items = await src.search(query || '');
    return { items: items.map((i) => ({ ...i, url: `catalog:${i.remoteId}` })), next: null };
  }
  let target = url || ext.url;
  if (query && ext.searchUrl) target = ext.searchUrl.replace('{q}', encodeURIComponent(query));
  const res = listSeries(await fetchVia(target), target);
  if (query && !ext.searchUrl) res.items = res.items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase()));
  return res;
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
  const html = await fetchVia(url);
  const info = extract(html, url);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const description = (doc.querySelector('meta[property="og:description"], meta[name="description"]')?.content || '').trim();
  const og = doc.querySelector('meta[property="og:image"]')?.content;
  const cover = (og && new URL(og, url).href) || fallback.cover;
  if (info.kind === 'chapter') return { title: info.series, cover, description, chapters: [{ url, title: info.title, number: info.number, images: info.images }] };
  return { title: fallback.title || info.title, cover, description, chapters: info.chapters };
}
