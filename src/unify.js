// Catálogo unificado: agrupa la misma obra publicada en varias fuentes.
// Regla: se fusiona automáticamente solo con evidencia fuerte (ID externo igual, o título/título
// alternativo idéntico sin conflicto de autor). Lo dudoso queda como "posible duplicado" y el
// usuario decide (unir / separar). Las correcciones manuales se guardan en el navegador.

const KEY = 'manhuua.merges';
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return { links: v?.links || [], splits: v?.splits || [] }; } catch { return { links: [], splits: [] }; } };
let overrides = load();
const subs = new Set();
export const onMergesChange = (f) => (subs.add(f), () => subs.delete(f));
function persist() { try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch {} subs.forEach((f) => f()); }
const pair = (a, b) => [a, b].sort().join('\n');
const has = (l, a, b) => l.some(([x, y]) => pair(x, y) === pair(a, b));
export const getMerges = () => overrides;
/** Une a mano dos fichas (claves "extId|url"). */
export function linkWorks(a, b) { overrides = { links: [...overrides.links.filter(([x, y]) => pair(x, y) !== pair(a, b)), [a, b]], splits: overrides.splits.filter(([x, y]) => pair(x, y) !== pair(a, b)) }; persist(); }
/** Separa a mano dos fichas que se habían unido. */
export function splitWorks(a, b) { overrides = { splits: [...overrides.splits.filter(([x, y]) => pair(x, y) !== pair(a, b)), [a, b]], links: overrides.links.filter(([x, y]) => pair(x, y) !== pair(a, b)) }; persist(); }

export const keyOf = (extId, url) => `${extId}|${url}`;

/** Título normalizado: minúsculas, sin acentos ni signos, espacios simples. */
export function normTitle(t = '') {
  return String(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`´]/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const titlesOf = (w) => new Set([w.title, ...(w.altTitles || [])].map(normTitle).filter(Boolean));
const people = (w) => new Set(String([w.author, w.artist].filter(Boolean).join(',')).split(/[,;/&]| y | and /).map(normTitle).filter((x) => x.length > 1));
const words = (t) => new Set(t.split(' ').filter((w) => w.length > 1));

/**
 * Compara dos fichas. Devuelve:
 *  'same'      → misma obra (se agrupa sola)
 *  'maybe'     → parecida, no se agrupa sin confirmación
 *  'different' → distintas
 */
export function compareWorks(a, b) {
  // IDs externos (AniList, MAL, MangaUpdates…): mandan sobre el título.
  const ka = Object.entries(a.ids || {}), kb = b.ids || {};
  for (const [k, v] of ka) if (kb[k] != null) return String(kb[k]) === String(v) ? 'same' : 'different';
  const ta = titlesOf(a), tb = titlesOf(b);
  const shared = [...ta].filter((t) => tb.has(t));
  const pa = people(a), pb = people(b);
  const authorConflict = pa.size && pb.size && ![...pa].some((x) => pb.has(x));
  if (shared.length) {
    if (authorConflict) return 'maybe';
    const both = pa.size && pb.size;
    if (a.year && b.year && Math.abs(a.year - b.year) > 1) return 'maybe';
    // Un título corto y genérico (una sola palabra corta) sin autor que lo confirme es riesgoso.
    if (!both && shared.every((t) => t.length < 6)) return 'maybe';
    return 'same';
  }
  // Parecidos: un título contiene al otro o comparten la mayoría de las palabras.
  for (const x of ta) for (const y of tb) {
    if (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x))) return 'maybe';
    const wx = words(x), wy = words(y);
    const inter = [...wx].filter((w) => wy.has(w)).length;
    if (inter >= 2 && inter / Math.max(wx.size, wy.size) >= 0.6) return 'maybe';
  }
  return 'different';
}

/**
 * Agrupa resultados [{ext, item}] en obras. Cada obra: {key, title, altTitles, cover, description,
 * author, artist, status, genres, updatedAt, sources:[{ext, item, key}], maybe:[{key, title, ext}]}.
 */
export function groupWorks(entries, ov = overrides) {
  const n = entries.length;
  const keys = entries.map((e) => keyOf(e.ext.id, e.item.url));
  const parent = keys.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const members = (r) => keys.filter((_, i) => find(i) === r);
  const blocked = (i, j) => { const A = members(find(i)), B = members(find(j)); return A.some((a) => B.some((b) => has(ov.splits, a, b))); };
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b && !blocked(i, j)) parent[b] = a; };
  const rel = new Map();
  // Vínculos manuales primero; luego coincidencias seguras. Nunca dos fichas de la misma fuente.
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (has(ov.links, keys[i], keys[j])) { union(i, j); continue; }
    if (entries[i].ext.id === entries[j].ext.id) continue;
    const r = compareWorks(entries[i].item, entries[j].item);
    if (r !== 'different') rel.set(i + ',' + j, r);
  }
  for (const [k, r] of rel) if (r === 'same') { const [i, j] = k.split(',').map(Number); union(i, j); }
  const groups = new Map();
  entries.forEach((e, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const out = [];
  for (const [r, idx] of groups) {
    const src = idx.map((i) => ({ ext: entries[i].ext, item: entries[i].item, key: keys[i] }));
    const pick = (f) => src.map((s) => s.item[f]).find((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
    const longest = (f) => src.map((s) => s.item[f]).filter(Boolean).sort((a, b) => b.length - a.length)[0];
    const title = src[0].item.title;
    const alts = [...new Set(src.flatMap((s) => [s.item.title, ...(s.item.altTitles || [])]))].filter((t) => normTitle(t) !== normTitle(title));
    const maybe = [];
    for (const [k, rr] of rel) {
      if (rr !== 'maybe') continue;
      const [i, j] = k.split(',').map(Number);
      const inI = find(i) === r, inJ = find(j) === r;
      if (inI === inJ) continue;
      const o = inI ? j : i;
      if (!maybe.some((m) => m.key === keys[o]) && !has(ov.splits, keys[inI ? i : j], keys[o])) maybe.push({ key: keys[o], title: entries[o].item.title, ext: entries[o].ext, item: entries[o].item, mine: keys[inI ? i : j] });
    }
    out.push({
      key: src.map((s) => s.key).sort()[0], title, altTitles: alts.slice(0, 20), cover: pick('cover'), description: longest('description'),
      author: pick('author'), artist: pick('artist'), status: pick('status'), genres: [...new Set(src.flatMap((s) => s.item.genres || []))],
      updatedAt: src.map((s) => s.item.updatedAt).filter(Boolean).sort().at(-1), sources: src, maybe,
    });
  }
  return out;
}
