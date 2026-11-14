// Extrae listas de obras de cualquier JSON (APIs públicas o datos embebidos en la página:
// __NEXT_DATA__, __NUXT_DATA__, JSON-LD, estados iniciales). Funciones puras: ver jsonwalk.test.js.

const TITLE_KEYS = /^(title|name|nombre|titulo|título|series_?name|manga_?name|canonical_?title)$/i;
const IMG_KEYS = /(cover|poster|thumb|image|img|portada|picture|banner)/i;
const URL_KEYS = /^(url|href|link|permalink|path|canonical_?url)$/i;
const SLUG_KEYS = /^(slug|uri|handle|seo_?url)$/i;
const IMG_EXT = /\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Hidrata el formato "devalue" que usa Nuxt 3 en <script id="__NUXT_DATA__">. */
export function devalue(arr) {
  if (!Array.isArray(arr)) return arr;
  const memo = new Map();
  const wrap = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef', 'NuxtError', 'Set', 'Map', 'Date']);
  const h = (i, depth = 0) => {
    if (typeof i !== 'number' || i < 0 || depth > 60) return undefined;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && wrap.has(v[0])) { const r = h(v[1], depth + 1); memo.set(i, r); return r; }
      const out = []; memo.set(i, out);
      for (const x of v) out.push(h(x, depth + 1));
      return out;
    }
    if (isObj(v)) {
      const out = {}; memo.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = h(x, depth + 1);
      return out;
    }
    memo.set(i, v);
    return v;
  };
  return h(0);
}

function pickText(v) {
  if (typeof v === 'string') return v.trim();
  if (isObj(v)) for (const k of ['es', 'es-la', 'en', 'default', 'rendered', 'romaji', 'english']) if (typeof v[k] === 'string') return v[k].trim();
  if (isObj(v)) { const s = Object.values(v).find((x) => typeof x === 'string'); return s?.trim(); }
  return undefined;
}

function pickImage(o, depth = 0) {
  if (!isObj(o) || depth > 3) return undefined;
  for (const [k, v] of Object.entries(o)) {
    if (!IMG_KEYS.test(k)) continue;
    if (typeof v === 'string' && (IMG_EXT.test(v) || /^https?:\/\//.test(v) || v.startsWith('/'))) return v;
    if (isObj(v)) {
      for (const kk of ['url', 'src', 'original', 'large', 'medium', 'extraLarge', 'path', 'href']) if (typeof v[kk] === 'string') return v[kk];
      const deep = pickImage(v, depth + 1); if (deep) return deep;
    }
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  }
  for (const v of Object.values(o)) if (typeof v === 'string' && IMG_EXT.test(v) && !/logo|avatar|icon/i.test(v)) return v;
  return undefined;
}

function itemOf(o) {
  if (!isObj(o)) return null;
  let title, url, slug;
  for (const [k, v] of Object.entries(o)) {
    if (!title && TITLE_KEYS.test(k)) title = pickText(v);
    if (!url && URL_KEYS.test(k) && typeof v === 'string') url = v;
    if (!slug && SLUG_KEYS.test(k) && typeof v === 'string') slug = v;
  }
  if (!title && isObj(o.attributes)) return itemOf({ ...o.attributes, id: o.id });
  if (!title && isObj(o.item)) return itemOf(o.item);
  const cover = pickImage(o);
  return title ? { title, cover, url, slug, id: o.id ?? o._id } : null;
}

/** Recorre el JSON y devuelve los arreglos que parecen listas de obras, del mejor al peor. */
export function findLists(data, maxNodes = 50000) {
  const found = [];
  let n = 0;
  const walk = (v, path) => {
    if (++n > maxNodes || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      if (objs.length >= 2) {
        const items = objs.map(itemOf).filter(Boolean);
        const withImg = items.filter((i) => i.cover).length;
        const withLink = items.filter((i) => i.url || i.slug).length;
        const s = items.length / objs.length + withImg / objs.length + 0.5 * (withLink / objs.length);
        if (items.length >= 2 && withImg >= 1) found.push({ path, score: s * Math.log2(items.length + 1), items });
      }
      v.slice(0, 500).forEach((x, i) => walk(x, `${path}[${i}]`));
    } else for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(data, '');
  return found.sort((a, b) => b.score - a.score);
}

/**
 * Convierte la mejor lista en obras {title, cover, url}.
 * urlTemplate (opcional) arma el enlace desde el slug/id: "https://sitio/series/{slug}".
 */
export function itemsFromJson(data, base, { urlTemplate } = {}) {
  const best = findLists(data)[0];
  if (!best) return { items: [], path: null };
  const abs = (u) => { try { return new URL(u, base).href; } catch { return null; } };
  const seen = new Set();
  const items = [];
  for (const it of best.items) {
    let url = it.url ? abs(it.url) : null;
    if (!url && urlTemplate && (it.slug || it.id != null)) url = urlTemplate.replace('{slug}', it.slug ?? it.id).replace('{id}', it.id ?? it.slug);
    if (!url && it.slug) url = abs(it.slug.startsWith('/') ? it.slug : `/${it.slug}`);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({ url, title: it.title.slice(0, 90), cover: it.cover ? abs(it.cover) : null });
  }
  return { items, path: best.path };
}

/** Saca los bloques JSON embebidos de un documento HTML. */
export function embeddedJson(doc) {
  const out = [];
  const push = (kind, text) => { try { out.push({ kind, data: JSON.parse(text) }); } catch {} };
  const next = doc.querySelector('script#__NEXT_DATA__');
  if (next) push('Next.js (__NEXT_DATA__)', next.textContent);
  const nuxt = doc.querySelector('script#__NUXT_DATA__');
  if (nuxt) { try { out.push({ kind: 'Nuxt (__NUXT_DATA__)', data: devalue(JSON.parse(nuxt.textContent)) }); } catch {} }
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) push('JSON-LD', s.textContent);
  for (const s of doc.querySelectorAll('script[type="application/json"]:not(#__NEXT_DATA__):not(#__NUXT_DATA__)')) push('JSON embebido', s.textContent);
  for (const s of doc.querySelectorAll('script:not([src]):not([type])')) {
    const m = s.textContent.match(/(?:__INITIAL_STATE__|__PRELOADED_STATE__|__APOLLO_STATE__|__DATA__)\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (m) push('Estado inicial', m[1]);
  }
  return out;
}
