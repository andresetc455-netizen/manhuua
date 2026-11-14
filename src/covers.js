// Portadas: búsqueda en bases de metadatos públicas (AniList, Kitsu), asignación manual,
// generación opcional con un proveedor de imágenes y persistencia en IndexedDB.
import { get, getAll, write } from './db.js';
import { loadSettings } from './settings.js';
import { fetchVia } from './sources/web.js';
import { thumbnail } from './library.js';

/* ---------- utilidades puras (testeadas en covers.test.js) ---------- */

export function norm(t = '') {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Similitud 0..1 (coeficiente de Dice sobre bigramas). */
export function similarity(a, b) {
  a = norm(a).replace(/ /g, ''); b = norm(b).replace(/ /g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1 || 1);
}

/** Puntaje de un candidato contra el título buscado (mejor de todos sus títulos). */
export const score = (title, cand) => Math.max(...[cand.title, ...(cand.altTitles || [])].filter(Boolean).map((t) => similarity(title, t)));

/** Elige el mejor candidato no usado por otra serie y con puntaje suficiente. */
export function pickCandidate(cands, usedUrls = new Set(), min = 0.72) {
  return cands.find((c) => c.score >= min && !usedUrls.has(c.url)) || null;
}

/** Color estable por título (para la portada de respaldo). */
export function hueOf(title = '') {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/* ---------- proveedores de metadatos ---------- */

async function anilist(q) {
  const query = `query($q:String){Page(perPage:8){media(search:$q,type:MANGA,sort:SEARCH_MATCH){id siteUrl countryOfOrigin title{romaji english native} synonyms coverImage{extraLarge large color} description(asHtml:false) genres}}}`;
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables: { q } }),
  });
  if (!r.ok) throw new Error('AniList ' + r.status);
  const j = await r.json();
  return (j.data?.Page?.media || []).filter((m) => m.coverImage?.extraLarge || m.coverImage?.large).map((m) => ({
    provider: 'anilist', id: m.id, link: m.siteUrl,
    title: m.title.english || m.title.romaji, altTitles: [m.title.romaji, m.title.native, ...(m.synonyms || [])],
    url: m.coverImage.extraLarge || m.coverImage.large, color: m.coverImage.color,
    origin: { KR: 'Manhwa', CN: 'Manhua', JP: 'Manga' }[m.countryOfOrigin] || '', description: (m.description || '').replace(/<[^>]+>/g, ''), genres: m.genres || [],
  }));
}

async function kitsu(q) {
  const r = await fetch(`https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(q)}&page[limit]=8`, { headers: { accept: 'application/vnd.api+json' } });
  if (!r.ok) throw new Error('Kitsu ' + r.status);
  const j = await r.json();
  return (j.data || []).filter((m) => m.attributes?.posterImage).map((m) => ({
    provider: 'kitsu', id: m.id, link: `https://kitsu.io/manga/${m.attributes.slug}`,
    title: m.attributes.canonicalTitle, altTitles: Object.values(m.attributes.titles || {}).concat(m.attributes.abbreviatedTitles || []),
    url: m.attributes.posterImage.original || m.attributes.posterImage.large,
    origin: '', description: m.attributes.synopsis || '', genres: [],
  }));
}

export const PROVIDERS = { anilist: 'AniList', kitsu: 'Kitsu' };

/** Busca portadas en todos los proveedores y las ordena por parecido con el título. */
export async function searchCovers(title) {
  const res = await Promise.allSettled([anilist(title), kitsu(title)]);
  const errors = res.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  const seen = new Set();
  const cands = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .map((c) => ({ ...c, score: score(title, c) }))
    .filter((c) => !seen.has(c.url) && seen.add(c.url))
    .sort((a, b) => b.score - a.score);
  if (!cands.length && errors.length === res.length) throw new Error('No se pudo consultar AniList/Kitsu: ' + errors.join(', '));
  return cands;
}

/** URLs de portadas ya usadas por otras series (para no repetir). */
export async function usedCoverUrls(exceptId) {
  return new Set((await getAll('series')).filter((s) => s.id !== exceptId && s.coverSource?.url).map((s) => s.coverSource.url));
}

/* ---------- asignación y persistencia ---------- */

async function toBlob(src) {
  if (src instanceof Blob) return src;
  let b;
  try { const r = await fetch(src); if (!r.ok) throw 0; b = await r.blob(); } catch { b = await fetchVia(src, 'blob'); }
  if (!b.type.startsWith('image/')) throw new Error('La URL no es una imagen');
  return b;
}

/**
 * Guarda una portada en la serie (Blob 600×900 en IndexedDB + referencia de origen).
 * source: { provider: 'anilist'|'kitsu'|'site'|'url'|'file'|'generated'|'page', url?, id?, link? }
 */
export async function setCover(seriesId, src, source, { lock = false, meta } = {}) {
  const blob = await thumbnail(await toBlob(src));
  const s = await get('series', seriesId);
  if (!s) return;
  const patch = { cover: blob, coverSource: { ...source, at: Date.now() }, coverLocked: lock || s.coverLocked || false };
  if (meta?.description && !s.description) patch.description = meta.description;
  if (meta?.origin && !s.kind) patch.kind = meta.origin;
  if (meta?.genres?.length && !s.genres?.length) patch.genres = meta.genres.slice(0, 4);
  await write('series', (o) => o.series.put({ ...s, ...patch }));
}

export async function clearCover(seriesId) {
  const s = await get('series', seriesId);
  if (s) await write('series', (o) => o.series.put({ ...s, cover: null, coverSource: null, coverLocked: true }));
}

/** ¿La serie necesita buscar portada automáticamente? */
export const needsCover = (s) => !s.coverLocked && (!s.cover || !s.coverSource || s.coverSource.provider === 'page');

/** Busca y asigna la mejor portada disponible. Devuelve el candidato usado o null. */
export async function autoCover(seriesId) {
  const s = await get('series', seriesId);
  if (!s || !needsCover(s)) return null;
  const cands = await searchCovers(s.title);
  const pick = pickCandidate(cands, await usedCoverUrls(s.id));
  if (!pick) return null;
  await setCover(s.id, pick.url, { provider: pick.provider, id: pick.id, url: pick.url, link: pick.link }, { meta: pick });
  return pick;
}

/** Recorre la biblioteca buscando portadas para las series que no tienen una real. */
export async function autoCoverAll(onProgress = () => {}) {
  const list = (await getAll('series')).filter(needsCover);
  let found = 0;
  for (let i = 0; i < list.length; i++) {
    onProgress(i + 1, list.length);
    try { if (await autoCover(list[i].id)) found++; } catch {}
  }
  return { found, total: list.length };
}

/* ---------- generación con IA (opcional) ---------- */

export const canGenerate = () => !!loadSettings().genKey?.trim();

export async function generateCover(seriesId) {
  const st = loadSettings();
  if (!st.genKey) throw new Error('Configurá un proveedor de imágenes en Ajustes → Portadas');
  const s = await get('series', seriesId);
  const prompt = `Vertical book cover illustration in detailed Korean manhwa style for a ${s.kind || 'manhwa'} titled "${s.title}". ${s.description ? 'Story: ' + s.description.slice(0, 400) + '.' : ''} ${s.genres?.length ? 'Genres: ' + s.genres.join(', ') + '.' : ''} Dramatic main character, cinematic lighting, rich background related to the story, sharp, high detail, no text, no logos, no watermark.`;
  const r = await fetch(st.genUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${st.genKey.trim()}` },
    body: JSON.stringify({ model: st.genModel, prompt, size: st.genSize || '1024x1536', n: 1 }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Error ${r.status} del proveedor de imágenes`);
  const d = j.data?.[0];
  if (!d) throw new Error('El proveedor no devolvió ninguna imagen');
  const blob = d.b64_json ? await (await fetch('data:image/png;base64,' + d.b64_json)).blob() : await toBlob(d.url);
  await setCover(seriesId, blob, { provider: 'generated', model: st.genModel }, { lock: true });
}
