// Extensiones declarativas (manifiesto JSON). Una extensión de este tipo NO ejecuta código: solo
// describe URLs (plantillas) y en qué campos del JSON de la API están los datos. Cada respuesta se
// valida antes de entrar al catálogo. Formato documentado en docs/EXTENSIONS.md.
import { fetchVia } from './web.js';
import { explain } from './engine.js';
import { normStatus } from './status.js';
import { parseDate, finalize } from './chapters.js';

export const FORMAT = 1;
const MAX_LIST_PAGES = 50;
const STR = 300, LONG = 4000;

// ---------- rutas ("a.b[].c", "a[type=cover].b", "x.es|x.en|x.*") ----------
function step(vals, seg) {
  const m = seg.match(/^([^[\]]*)(?:\[(.*)\])?$/);
  if (!m) return [];
  const [, key, sel] = m;
  let out = [];
  for (const v of vals) {
    if (v == null) continue;
    let x = key === '' ? v : key === '*' ? (typeof v === 'object' ? Object.values(v)[0] : undefined) : v[key];
    if (sel === undefined) { out.push(x); continue; }
    if (!Array.isArray(x)) continue;
    if (sel === '') out.push(...x);
    else {
      const [k, want] = sel.split('=');
      const hit = x.find((e) => e && String(e[k]) === want);
      if (hit !== undefined) out.push(hit);
    }
  }
  return out;
}
/** Todos los valores de una ruta (los [] expanden listas). */
export function getAllAt(obj, path) {
  if (path == null || path === '' || path === '.') return [obj];
  for (const alt of String(path).split('|')) {
    let vals = [obj];
    for (const seg of alt.trim().replace(/^[$.]+/, '').split('.')) { if (seg) vals = step(vals, seg); }
    vals = vals.filter((v) => v != null && v !== '');
    if (vals.length) return vals;
  }
  return [];
}
export const getAt = (obj, path) => getAllAt(obj, path)[0];

/** Plantilla: {base} {q} {page} {offset} {limit} {id} {chapterId} y rutas {.campo} (ítem) o {$.campo} (raíz). */
export function fill(tpl, vars, item, root) {
  let missing = false;
  const out = String(tpl).replace(/\{([^{}]+)\}/g, (_, k) => {
    let v;
    if (k.startsWith('$.')) v = getAt(root, k.slice(2));
    else if (k === '.' || k.startsWith('.')) v = getAt(item, k.slice(1));
    else v = vars[k];
    if (v == null || v === '' || typeof v === 'object') { missing = true; return ''; }
    return ['q', 'id', 'chapterId'].includes(k) ? encodeURIComponent(v) : String(v);
  });
  return missing ? null : out;
}

// ---------- validación ----------
const str = (v, n = STR) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, n) : '');
const httpUrl = (v, base) => { try { const u = new URL(String(v), base); return /^https?:$/.test(u.protocol) && !u.username ? u.href : null; } catch { return null; } };
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null; };
/** Valor de un campo: ruta o plantilla (si tiene llaves). */
function field(spec, item, root, vars) {
  if (spec == null) return undefined;
  if (Array.isArray(spec)) return spec;
  return /[{}]/.test(spec) ? fill(spec, vars, item, root) : getAt(item, spec);
}
function fieldAll(spec, item) {
  if (!spec) return [];
  return getAllAt(item, spec).flatMap((v) => (typeof v === 'object' && v ? Object.values(v) : [v])).map((v) => str(v, 80)).filter(Boolean);
}

const ID_RE = /^[\w.:~-]{1,200}$/;

/** Revisa que el manifiesto tenga lo mínimo. Devuelve la lista de problemas (vacía = válido). */
export function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['El archivo no es un objeto JSON.'];
  if (m.manhuua !== FORMAT) errs.push(`Falta "manhuua": ${FORMAT} (versión del formato).`);
  if (!/^[a-z0-9][a-z0-9._-]{1,60}$/.test(m.id || '')) errs.push('"id" debe ser un identificador corto (minúsculas, números, punto, guion).');
  if (!str(m.name)) errs.push('Falta "name".');
  if (!/^\d+(\.\d+){0,3}$/.test(String(m.version || ''))) errs.push('"version" debe tener la forma 1.0.0.');
  if (!httpUrl(m.baseUrl)) errs.push('"baseUrl" debe ser una URL http(s).');
  for (const k of ['catalog', 'chapters', 'pages']) if (!m[k]?.url) errs.push(`Falta "${k}.url".`);
  if (m.catalog && !m.catalog.fields?.title) errs.push('Falta "catalog.fields.title".');
  if (m.catalog && !m.catalog.fields?.id) errs.push('Falta "catalog.fields.id".');
  if (m.chapters && !m.chapters.fields?.id) errs.push('Falta "chapters.fields.id".');
  if (m.pages && !m.pages.list && !m.pages.image) errs.push('Falta "pages.list" o "pages.image".');
  const walk = (o, p) => {
    if (typeof o === 'function') errs.push(`${p}: no se admite código.`);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
    else if (typeof o === 'string' && /^\s*javascript:/i.test(o)) errs.push(`${p}: URL no permitida.`);
  };
  walk(m, 'manifiesto');
  return errs;
}

/** Orígenes a los que la extensión puede pedir datos (baseUrl + "hosts"). */
function allowed(m, url) {
  const u = new URL(url);
  const ok = [new URL(m.baseUrl).host, ...(m.hosts || [])];
  return ok.some((h) => u.host === h || u.host.endsWith('.' + h));
}

class ApiError extends Error {}
async function getJson(m, url, trace) {
  if (!url) throw Object.assign(new ApiError('La plantilla de URL usa un dato que la respuesta no trae.'), { kind: 'incompatible' });
  if (!allowed(m, url)) throw Object.assign(new ApiError(`La extensión intentó pedir datos a otro dominio (${new URL(url).host}); no está permitido.`), { kind: 'incompatible' });
  const t = await fetchVia(url, 'text', m.referer, trace);
  try { const j = JSON.parse(t); if (j && typeof j === 'object') return j; } catch {}
  throw Object.assign(new ApiError('La respuesta no es JSON: la API cambió o la URL no es de una API.'), { kind: 'incompatible' });
}

const vars0 = (m, extra = {}) => ({ base: m.baseUrl.replace(/\/+$/, ''), limit: extra.limit, ...extra });
const pageVars = (spec, page) => ({ page, offset: (page - 1) * (spec.limit || 20), limit: spec.limit || 20 });

/** Convierte un ítem del catálogo en obra validada (o null si le falta lo mínimo). */
function workOf(m, f, it, root, vars, forcedId) {
  const id = forcedId || str(field(f.id, it, root, vars), 200);
  const title = str(field(f.title, it, root, vars));
  if (!id || !ID_RE.test(id) || !title) return null;
  const cover = field(f.cover, it, root, { ...vars, id });
  const ids = {};
  for (const [k, p] of Object.entries(f.ids || {})) { const v = str(getAt(it, p), 80); if (v) ids[k] = v; }
  return {
    url: `mf:${m.id}/s/${id}`, remoteId: id, title,
    altTitles: [...new Set(fieldAll(f.altTitles, it).filter((t) => t !== title))].slice(0, 30),
    cover: cover ? httpUrl(cover, m.baseUrl) : null,
    description: str(field(f.description, it, root, vars), LONG) || undefined,
    author: fieldAll(f.author, it).slice(0, 4).join(', ') || undefined,
    artist: fieldAll(f.artist, it).slice(0, 4).join(', ') || undefined,
    status: normStatus(str(field(f.status, it, root, vars))) || undefined,
    genres: [...new Set(fieldAll(f.genres, it))].slice(0, 20),
    updatedAt: parseDate(str(field(f.updatedAt, it, root, vars))) || undefined,
    year: num(field(f.year, it, root, vars)) || undefined,
    ids,
  };
}

/** Catálogo o búsqueda. Devuelve {items, next, nextPage, diag}. */
export async function mBrowse(ext, { query, page = 1 } = {}) {
  const m = ext.manifest;
  const spec = query && m.search ? { ...m.catalog, ...m.search, fields: { ...m.catalog.fields, ...m.search.fields } } : m.catalog;
  const trace = [];
  const url = fill(spec.url, { ...vars0(m), ...pageVars(spec, page), q: query || '' });
  const diag = { url, kind: 'catalog', attempts: trace, via: `extensión JSON ${m.name} ${m.version}` };
  const t0 = Date.now();
  let data;
  try { data = await getJson(m, url, trace); }
  catch (e) { return { items: [], next: null, diag: errDiag(diag, e, t0) }; }
  const list = getAllAt(data, spec.list || '.').flatMap((x) => (Array.isArray(x) ? x : [x]));
  const vars = vars0(m);
  let items = list.map((it) => workOf(m, spec.fields, it, data, vars)).filter(Boolean);
  const dropped = list.length - items.length;
  if (query && !m.search) items = items.filter((i) => [i.title, ...i.altTitles].some((t) => t.toLowerCase().includes(query.toLowerCase())));
  const nextUrl = spec.next ? getAt(data, spec.next) : null;
  const hasMore = spec.next ? !!nextUrl : (spec.url.includes('{page}') || spec.url.includes('{offset}')) && list.length >= (spec.minPageSize || 1) && (!spec.total || page * (spec.limit || 20) < num(getAt(data, spec.total)));
  Object.assign(diag, { ms: Date.now() - t0, count: items.length, covers: items.filter((i) => i.cover).length, strategy: `lista en ${spec.list || 'raíz'}`, dropped });
  diag.reasons = items.length ? (dropped ? [`Se descartaron ${dropped} elementos sin id o título válidos.`] : []) : [list.length ? `La API devolvió ${list.length} elementos pero ninguno tiene id y título en los campos indicados: la API pudo cambiar (API incompatible).` : query ? 'Sin resultados para la búsqueda.' : `La API no devolvió una lista en "${spec.list || 'raíz'}" (API incompatible).`];
  if (!items.length && list.length) diag.incompatible = true;
  if (!items.length && !list.length && !query) diag.incompatible = true;
  return { items, next: hasMore ? `mfpage:${page + 1}` : null, nextPage: page + 1, diag };
}

function errDiag(diag, e, t0) {
  const last = diag.attempts.at(-1) || {};
  Object.assign(diag, { ms: Date.now() - t0, count: 0, httpError: e.message, httpStatus: e.status ?? last.status, errorSource: e.kind ? undefined : e.source || last.source, challenge: e.challenge || last.challenge, incompatible: e.kind === 'incompatible' });
  diag.reasons = diag.incompatible ? [e.message] : explain(diag, diag.kind === 'catalog' ? 'obras' : 'capítulos');
  return diag;
}

/** Ficha + capítulos. */
export async function mDetail(ext, url, fallback = {}) {
  const m = ext.manifest;
  const id = url.replace(/^mf:[^/]+\/s\//, '');
  const vars = { ...vars0(m), id };
  const trace = [];
  const diag = { url: '', kind: 'series', attempts: trace, via: `extensión JSON ${m.name} ${m.version}` };
  const t0 = Date.now();
  let work = { ...fallback };
  if (m.detail?.url) {
    diag.url = fill(m.detail.url, vars);
    try {
      const d = await getJson(m, diag.url, trace);
      const root = m.detail.root ? getAt(d, m.detail.root) : d;
      const w = root && typeof root === 'object' && workOf(m, { ...m.catalog.fields, ...m.detail.fields }, root, d, vars, id);
      if (w) work = { ...work, ...Object.fromEntries(Object.entries(w).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))) };
    } catch (e) {
      // Sin ficha no hay capítulos confiables: se informa el error tal cual (sin reintentar).
      return { ...work, chapters: [], diag: errDiag(diag, e, t0) };
    }
  }
  const c = m.chapters;
  const chapters = [];
  let dropped = 0, pages = 0, next = null;
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const u = next || fill(c.url, { ...vars, ...pageVars(c, page) });
    if (!diag.url) diag.url = u;
    let d;
    try { d = await getJson(m, u, trace); }
    catch (e) {
      if (page === 1) return { ...work, chapters: [], diag: errDiag(diag, e, t0) };
      diag.pageError = e.message; break; // páginas siguientes: se conserva lo obtenido, sin reintentar
    }
    pages = page;
    const list = getAllAt(d, c.list || '.').flatMap((x) => (Array.isArray(x) ? x : [x]));
    for (const it of list) {
      if (c.filter && Object.entries(c.filter).some(([k, v]) => !([].concat(v).map(String).includes(String(getAt(it, k)))))) continue;
      const cid = str(field(c.fields.id, it, d, vars), 200);
      if (!cid || !ID_RE.test(cid)) { dropped++; continue; }
      const n = num(field(c.fields.number, it, d, vars));
      const title = str(field(c.fields.title, it, d, vars));
      const link = c.fields.url ? httpUrl(field(c.fields.url, it, d, { ...vars, chapterId: cid }), m.baseUrl) : null;
      const raw = str(field(c.fields.date, it, d, vars));
      chapters.push({ url: `mf:${m.id}/c/${cid}`, remoteId: cid, link, number: n, title: title && n != null && !title.includes(String(n)) ? `Capítulo ${n}: ${title}` : title || (n != null ? `Capítulo ${n}` : `Capítulo ${cid}`), date: parseDate(raw), dateText: raw && !parseDate(raw) ? raw : null, language: str(field(c.fields.language, it, d, vars), 10) || undefined, group: str(field(c.fields.group, it, d, vars), 80) || undefined });
    }
    next = c.next ? getAt(d, c.next) : null;
    if (next) { next = httpUrl(next, u); if (!next) break; continue; }
    const more = (c.url.includes('{page}') || c.url.includes('{offset}')) && list.length >= (c.limit || 1) && (!c.total || page * (c.limit || 20) < num(getAt(d, c.total)));
    if (!more || !list.length) break;
  }
  const out = finalize(chapters);
  Object.assign(diag, { ms: Date.now() - t0, count: out.length, pages, strategy: `capítulos en ${c.list || 'raíz'}`, dropped });
  diag.reasons = out.length ? [] : [dropped ? `La API devolvió ${dropped} capítulos sin id válido (API incompatible).` : 'La API no devolvió capítulos para esta obra (o ninguno coincide con el filtro de idioma).'];
  if (dropped && !out.length) diag.incompatible = true;
  if (diag.pageError) diag.reasons.push(`No se pudo cargar una página siguiente de capítulos: ${diag.pageError}`);
  return { ...work, chapters: out, diag };
}

/** URLs de las imágenes de un capítulo. */
export async function mPages(ext, chapterUrl) {
  const m = ext.manifest, p = m.pages;
  const chapterId = chapterUrl.replace(/^mf:[^/]+\/c\//, '');
  const vars = { ...vars0(m), chapterId };
  const d = await getJson(m, fill(p.url, vars), []);
  const list = p.list ? getAllAt(d, p.list).flatMap((x) => (Array.isArray(x) ? x : [x])) : [d];
  const urls = list.map((it) => httpUrl(p.image ? fill(p.image, vars, it, d) : it, m.baseUrl)).filter(Boolean);
  if (!urls.length) throw Object.assign(new Error('La API no devolvió imágenes para este capítulo (API incompatible o capítulo vacío).'), { kind: 'incompatible' });
  return [...new Set(urls)];
}

/** Obtiene y valida un manifiesto desde una URL. */
export async function fetchManifest(url) {
  let j;
  try { j = JSON.parse(await fetchVia(url)); } catch (e) { throw new Error(e instanceof SyntaxError ? 'El archivo no es JSON válido.' : `No se pudo descargar: ${e.message}`); }
  return j;
}
export const isManifest = (j) => j && typeof j === 'object' && 'manhuua' in j;
