// Extracción de capítulos y datos de la obra desde una ficha (HTML, Next/Nuxt, JSON-LD, APIs JSON).
// Funciones puras sobre un Document o un objeto JSON: ver chapters.test.js.
// Regla: nunca se crea un capítulo ni una URL que la fuente no proporcione.
import { embeddedJson } from './jsonwalk.js';

export const CH_RE = /(cap[ií]tulo|chapter|cap|ch|episodio|episode|ep)[\s.:_#-]*(\d+(?:[.,]\d+)?)/i;
const NUM_KEYS = /^(number|chapter|chapter_?(num|number|no)|chap|num|numero|número|episode|ep|index|order)$/i;
const URL_KEYS = /^(url|href|link|permalink|path|canonical_?url|chapter_?url|read_?url)$/i;
const SLUG_KEYS = /^(slug|uri|handle)$/i;
const DATE_KEYS = /^(date|published_?at|publishedAt|created_?at|createdAt|release_?date|releaseDate|updated_?at|updatedAt|upload_?date|datePublished|time|fecha)$/i;
const TITLE_KEYS = /^(title|name|nombre|titulo|título|chapter_?title)$/i;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const abs = (u, base) => { try { const x = new URL(String(u).trim(), base); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normUrl = (u) => u.split('#')[0].replace(/\/+$/, '');
const toNum = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

const MONTHS = { ene: 0, jan: 0, feb: 1, mar: 2, abr: 3, apr: 3, may: 4, jun: 5, jul: 6, ago: 7, aug: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11, dec: 11 };
/** Fecha ISO (YYYY-MM-DD) si el texto la contiene de forma inequívoca; si no, null. */
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const d = new Date(v < 1e12 ? v * 1000 : v); return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/\b(\d{1,2})\s+(?:de\s+)?([a-zé]{3})[a-zé]*\.?,?\s+(?:de\s+)?(\d{4})\b/i);
  if (m && MONTHS[m[2].toLowerCase()] != null) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()] + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (m && MONTHS[m[1].toLowerCase()] != null) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()] + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}
const RELATIVE = /\b(hace\s+\d+\s+\w+|\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago|ayer|hoy|yesterday|today)\b/i;

/** Ordena (ascendente) y quita duplicados por URL y por número. */
export function finalize(list) {
  const byUrl = new Map();
  for (const c of list) { const k = normUrl(c.url); if (!byUrl.has(k)) byUrl.set(k, c); }
  const out = [], nums = new Set();
  for (const c of byUrl.values()) {
    if (c.number != null) { if (nums.has(c.number)) continue; nums.add(c.number); }
    out.push(c);
  }
  // Sin números: se respeta el orden de la fuente (si venía de más nuevo a más viejo, se invierte).
  const numbered = out.filter((c) => c.number != null);
  if (numbered.length === out.length) return out.sort((a, b) => a.number - b.number);
  const desc = numbered.length >= 2 && numbered[0].number > numbered[numbered.length - 1].number;
  return desc ? out.reverse() : out;
}

/* ---------------- HTML ---------------- */

function dateNear(a) {
  const box = a.closest('li, tr, article, [class*="chap"], [class*="episod"], [class*="item"]') || a.parentElement;
  const t = a.querySelector('time[datetime]') || box?.querySelector('time[datetime]');
  if (t) return { date: parseDate(t.getAttribute('datetime')), dateText: clean(t.textContent) || null };
  const text = clean(box?.textContent || '');
  const date = parseDate(text);
  if (date) return { date, dateText: null };
  const rel = text.match(RELATIVE);
  return { date: null, dateText: rel ? rel[0] : null };
}

/** Capítulos a partir de enlaces de la página. */
export function chaptersFromLinks(doc, base, pageUrl) {
  const self = normUrl(pageUrl);
  const found = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    const url = abs(a.getAttribute('href'), base);
    if (!url || normUrl(url) === self) continue;
    const path = (() => { try { return decodeURIComponent(new URL(url).pathname); } catch { return ''; } })();
    const timeText = clean(a.querySelector('time')?.textContent || '');
    const text = clean(a.textContent).replace(timeText, '').trim();
    const m = text.match(CH_RE) || path.match(CH_RE) || (a.dataset?.number && ['', '', a.dataset.number]);
    if (!m) continue;
    const box = a.closest('ul, ol, table, tbody, [class*="chap"], [id*="chap"], [class*="episod"], [class*="list"]') || a.parentElement;
    found.push({ a, box, url, title: (text || `Capítulo ${m[2]}`).slice(0, 90), number: toNum(m[2]), ...dateNear(a) });
  }
  if (!found.length) return [];
  // Quedarse con los de esta obra: los que comparten el "slug" de la ficha, o el contenedor más grande.
  const slug = self.split('/').filter(Boolean).pop()?.toLowerCase();
  const bySlug = slug && slug.length > 3 ? found.filter((c) => c.url.toLowerCase().includes(slug)) : [];
  let pick = found;
  if (bySlug.length >= 1 && bySlug.length >= found.length * 0.3) pick = bySlug;
  else {
    const groups = new Map();
    for (const c of found) groups.set(c.box, [...(groups.get(c.box) || []), c]);
    const best = [...groups.values()].sort((x, y) => y.length - x.length)[0];
    if (best.length >= 2) pick = best;
  }
  return pick.map(({ url, title, number, date, dateText }) => ({ url, title, number, date, dateText }));
}

/** URL de la página siguiente de la lista de capítulos (si la hay). */
export function nextChaptersPage(doc, base, pageUrl) {
  const host = new URL(pageUrl).host;
  const cand = doc.querySelector('a[rel="next"], link[rel="next"]')
    || [...doc.querySelectorAll('a[href]')].find((a) => /^(siguiente|next|»|›|más capítulos|more chapters|ver más capítulos)\s*[»›>]?$/i.test(clean(a.textContent)));
  const u = cand && abs(cand.getAttribute('href'), base);
  if (!u || normUrl(u) === normUrl(pageUrl) || new URL(u).host !== host || CH_RE.test(clean(cand.textContent))) return null;
  return u;
}

/* ---------------- JSON (Next/Nuxt/JSON-LD/APIs) ---------------- */

function chapterOf(o, base, linkBySlug) {
  if (!isObj(o)) return null;
  let number = null, url = null, slug = null, title = null, date = null;
  for (const [k, v] of Object.entries(o)) {
    if (number == null && NUM_KEYS.test(k) && (typeof v === 'number' || typeof v === 'string') && toNum(v) != null) number = toNum(v);
    if (!url && URL_KEYS.test(k) && typeof v === 'string') url = abs(v, base);
    if (!slug && SLUG_KEYS.test(k) && typeof v === 'string') slug = v;
    if (!title && TITLE_KEYS.test(k) && typeof v === 'string') title = clean(v);
    if (!date && DATE_KEYS.test(k)) date = parseDate(v);
  }
  if (number == null && title) { const m = title.match(CH_RE); if (m) number = toNum(m[2]); }
  if (number == null) return null;
  // La URL debe venir de la fuente: del objeto, o de un enlace real de la página que contenga su slug/id.
  if (!url) url = linkBySlug(slug) || linkBySlug(o.id != null ? String(o.id) : null);
  if (!url) return { unresolved: true, number };
  return { url, title: (title || `Capítulo ${number}`).slice(0, 90), number, date, dateText: null };
}

/** Busca en un JSON la mejor lista de capítulos. Devuelve {chapters, path, unresolved}. */
export function chaptersFromJson(data, base, { links = [] } = {}) {
  const linkBySlug = (s) => (s && s.length > 1 ? links.find((l) => l.split(/[/?#]/).includes(s)) || null : null);
  let best = { chapters: [], path: null, unresolved: 0 };
  let n = 0;
  const walk = (v, path) => {
    if (++n > 60000 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      if (objs.length >= 1) {
        const got = objs.map((o) => chapterOf(o, base, linkBySlug)).filter(Boolean);
        const ok = got.filter((c) => !c.unresolved);
        if (got.length >= Math.max(1, objs.length * 0.6) && (ok.length > best.chapters.length || (!best.chapters.length && got.length > best.unresolved)))
          best = { chapters: ok, path, unresolved: got.length - ok.length };
      }
      v.slice(0, 3000).forEach((x, i) => walk(x, `${path}[${i}]`));
    } else for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(data, '');
  return best;
}

/** URL "siguiente" en respuestas JSON paginadas (next, next_page_url, links.next, meta.next). */
export function nextJsonPage(data, base) {
  const c = [data?.next, data?.next_page_url, data?.links?.next, data?.meta?.next, data?.pagination?.next, data?.data?.next_page_url];
  for (const v of c) { const u = typeof v === 'string' ? abs(v, base) : null; if (u) return u; }
  return null;
}

/* ---------------- datos de la obra ---------------- */

export { normStatus } from './status.js';
import { normStatus } from './status.js';
const names = (v) => (Array.isArray(v) ? v : [v]).map((x) => (isObj(x) ? x.name || x.title || x.label : x)).filter((x) => typeof x === 'string').map(clean).filter(Boolean);

export function metaFromJson(data, title) {
  let found = null, n = 0;
  const walk = (v) => {
    if (found || ++n > 40000 || v == null || typeof v !== 'object') return;
    if (isObj(v)) {
      const keys = Object.keys(v);
      const hasTitle = keys.some((k) => TITLE_KEYS.test(k));
      const rich = keys.filter((k) => /^(description|synopsis|summary|sinopsis|resumen|author|authors|autor|artist|status|estado|genres|genre|tags|generos|géneros)$/i.test(k)).length;
      if (hasTitle && rich >= 2) { found = v; return; }
      Object.values(v).forEach(walk);
    } else v.slice(0, 200).forEach(walk);
  };
  walk(data);
  if (!found) return {};
  const g = (re) => Object.entries(found).find(([k]) => re.test(k))?.[1];
  const desc = g(/^(description|synopsis|summary|sinopsis|resumen)$/i);
  return {
    title: typeof g(TITLE_KEYS) === 'string' ? clean(g(TITLE_KEYS)) : title,
    description: typeof desc === 'string' ? clean(desc.replace(/<[^>]+>/g, ' ')) : isObj(desc) ? clean(Object.values(desc).find((x) => typeof x === 'string') || '') : undefined,
    author: names(g(/^(author|authors|autor|autores)$/i) || []).join(', ') || undefined,
    artist: names(g(/^(artist|artists|artista)$/i) || []).join(', ') || undefined,
    status: normStatus(typeof g(/^(status|estado)$/i) === 'string' ? g(/^(status|estado)$/i) : names(g(/^(status|estado)$/i) || [])[0]) || undefined,
    genres: names(g(/^(genres|genre|tags|generos|géneros)$/i) || []).slice(0, 12),
  };
}

function labelled(doc, re) {
  const exact = new RegExp(`^(?:${re.source})\\s*:?$`, 'i');
  // 1) Etiqueta en su propio elemento: <b>Autor:</b> Nombre · <dt>Autor</dt><dd>Nombre</dd>
  for (const el of doc.querySelectorAll('dt, th, b, strong, label, span, h4, h5, em')) {
    const t = clean(el.textContent);
    if (!exact.test(t)) continue;
    const sib = clean(el.nextElementSibling?.textContent || '');
    const rest = clean(clean(el.parentElement?.textContent || '').slice(t.length).replace(/^\s*:/, ''));
    const v = ['DT', 'TH'].includes(el.tagName) ? sib : rest || sib;
    if (v && v.length < 120) return v;
  }
  // 2) Texto plano "Autor: Nombre" en un elemento sin hijos
  const inline = new RegExp(`^(?:${re.source})\\s*:\\s*(.+)$`, 'i');
  for (const el of doc.querySelectorAll('p, li, div, span, td')) {
    if (el.children.length) continue;
    const m = clean(el.textContent).match(inline);
    if (m && m[1].length < 120) return m[1];
  }
  return null;
}

/** Título, descripción, autor, estado y géneros desde meta, JSON-LD, datos embebidos o etiquetas HTML. */
export function seriesMeta(doc, base) {
  const meta = (sel) => doc.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const out = {
    title: meta('meta[property="og:title"]') || clean(doc.querySelector('h1')?.textContent) || doc.title || null,
    description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || null,
    cover: (meta('meta[property="og:image"]') && abs(meta('meta[property="og:image"]'), base)) || null,
  };
  for (const b of embeddedJson(doc)) {
    const ld = b.kind === 'JSON-LD' ? [].concat(b.data['@graph'] || b.data) : [];
    const book = ld.find((x) => /Book|ComicSeries|CreativeWorkSeries|Article|WebPage/i.test([].concat(x?.['@type']).join(',')) && (x.author || x.genre || x.description));
    const m = book ? { title: book.name, description: book.description, author: names(book.author || []).join(', ') || undefined, genres: names(book.genre || []), status: normStatus(book.creativeWorkStatus) } : metaFromJson(b.data, out.title);
    for (const [k, v] of Object.entries(m)) if (v && (Array.isArray(v) ? v.length : true) && !out[k]?.length) out[k] = v;
  }
  out.author ??= labelled(doc, /autor(?:es)?|author(?:s)?|escritor|writer/);
  out.artist ??= labelled(doc, /artista|artist|dibujante/);
  out.status = normStatus(out.status || labelled(doc, /estado|status|estatus/)) || null;
  if (!out.genres?.length) {
    const box = [...doc.querySelectorAll('[class*="genre"], [class*="genero"], [class*="tags"], [class*="categor"]')].find((e) => e.querySelectorAll('a').length >= 1);
    out.genres = box ? [...box.querySelectorAll('a')].map((a) => clean(a.textContent)).filter((t) => t && t.length < 30).slice(0, 12) : [];
  }
  if (!out.description) out.description = clean(doc.querySelector('[class*="synopsis"], [class*="sinopsis"], [class*="description"], [class*="summary"]')?.textContent || '') || null;
  out.title = out.title && clean(out.title).split(/\s[|–—]\s/)[0];
  return out;
}

/** Capítulos de una ficha HTML: enlaces y, si no alcanzan, datos embebidos. */
export function chaptersFromDoc(doc, base, pageUrl) {
  const links = [...doc.querySelectorAll('a[href]')].map((a) => abs(a.getAttribute('href'), base)).filter(Boolean);
  let chapters = chaptersFromLinks(doc, base, pageUrl), strategy = chapters.length ? 'enlaces HTML' : '', unresolved = 0;
  for (const b of embeddedJson(doc)) {
    const r = chaptersFromJson(b.data, base, { links });
    if (r.chapters.length > chapters.length) { chapters = r.chapters; strategy = `datos embebidos: ${b.kind} → ${r.path}`; }
    unresolved = Math.max(unresolved, r.unresolved);
  }
  return { chapters, strategy, unresolved };
}
