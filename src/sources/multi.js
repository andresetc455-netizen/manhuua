// Consultas a varias fuentes a la vez. Cada fuente es independiente: un 403, un 404 o una fuente
// caída no cancelan las demás, y cada una tiene su tiempo máximo, su paginación y su caché.
import { browse, recordStatus } from './extensions.js';
import { classify } from './engine.js';

const TIMEOUT_MS = 30000;
// Todas las fuentes activas a la vez, con un tope para no saturar el backend (que admite 16).
export const CONCURRENCY = 8;
const CACHE_MS = 5 * 60e3, CACHE_MAX = 120;
const cache = new Map(); // `${extId}|${version}|${query}|${page}` → {t, out}
const ckey = (x, query, page) => `${x.id}|${x.version || ''}|${JSON.stringify(x.options || {})}|${x.url}|${x.searchUrl || ''}|${query || ''}|${page}`;
const cget = (k) => { const v = cache.get(k); if (!v) return null; if (Date.now() - v.t > CACHE_MS) { cache.delete(k); return null; } return v.out; };
const cset = (k, out) => { cache.delete(k); cache.set(k, { t: Date.now(), out }); while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); };
export const clearSearchCache = () => cache.clear();

const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(`sin respuesta en ${ms / 1000} s`), { timeout: true })), ms); })]).finally(() => clearTimeout(t)); };

/** Pide una página de una fuente (con caché de 5 min solo para respuestas correctas). */
async function fetchPage(x, query, page, nextUrl, { timeout, signal }) {
  const k = ckey(x, query, page);
  const hit = cget(k);
  if (hit) return { ...hit, cached: true };
  // Las URLs internas (md:, mfpage:) no se pasan como `url`: esas fuentes paginan por número.
  const url = page > 1 && nextUrl && /^https?:/i.test(nextUrl) ? nextUrl : undefined;
  const out = await withTimeout(browse(x, { ...(query ? { query } : {}), page, url, signal }), timeout);
  const c = classify(out.diag);
  if (out.items.length || ['ok', 'extraction'].includes(c.state)) cset(k, out);
  return out;
}

const toResult = (x, out, t0, page, prevItems = []) => {
  const c = classify(out.diag);
  const seen = new Set(prevItems.map((i) => i.url));
  const items = [...prevItems, ...out.items.filter((i) => i.url && !seen.has(i.url) && seen.add(i.url))];
  const failed = !items.length && !['ok', 'extraction'].includes(c.state) && !out.diag?.searchOnly;
  // Hay más solo si la fuente lo dice y la página trajo algo nuevo (evita bucles en sitios que repiten).
  const more = !!out.next && items.length > prevItems.length;
  return { extId: x.id, state: failed ? 'error' : 'ok', items, label: out.diag?.searchOnly ? 'solo búsqueda' : c.label, kind: c.kind, httpStatus: c.httpStatus, reason: out.diag?.reasons?.[0], ms: Date.now() - t0, page, next: more ? out.next : null, total: out.total, cached: !!out.cached };
};
const errResult = (x, e, t0, prev) => ({ ...(prev || { items: [], page: 0 }), extId: x.id, state: prev?.items?.length ? 'ok' : 'error', moreError: prev ? e.message : undefined, items: prev?.items || [], label: e.timeout ? 'Sin respuesta' : 'Error', kind: e.timeout ? 'network' : undefined, reason: e.message, ms: Date.now() - t0, next: prev?.next || null });

/**
 * Busca (query) o lista el catálogo (sin query) en todas las extensiones dadas.
 * onUpdate(results) se llama cada vez que responde una (resultados progresivos).
 * results[i] = {extId, state, items, label, kind, reason, ms, page, next}.
 */
export async function searchAll(exts, query, onUpdate, { timeout = TIMEOUT_MS, concurrency = CONCURRENCY, signal } = {}) {
  const results = exts.map((x) => ({ extId: x.id, state: 'loading', items: [], page: 0 }));
  // Una búsqueda nueva cancela la anterior: no se emiten más resultados ni se inician fuentes pendientes.
  const emit = () => { if (!signal?.aborted) onUpdate?.(results.map((r) => ({ ...r }))); };
  emit();
  let next = 0;
  const worker = async () => { while (next < exts.length && !signal?.aborted) { const i = next++; await one(exts[i], i); } };
  const one = async (x, i) => {
    const t0 = Date.now();
    let r;
    try {
      const out = await fetchPage(x, query, 1, null, { timeout, signal });
      r = toResult(x, out, t0, 1);
      // El estado de la fuente se actualiza con lo observado (una búsqueda sin resultados no cuenta como falla).
      if (!out.cached && (r.state === 'error' || !query)) recordStatus(x, { ...out.diag, ms: r.ms });
    } catch (e) {
      if (e.aborted || e.name === 'AbortError' || signal?.aborted) return;
      r = errResult(x, e, t0);
    }
    results[i] = r;
    emit();
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, exts.length) }, worker));
  return results;
}

/** Página siguiente de UNA fuente (paginación independiente). Devuelve el resultado acumulado. */
export async function searchMore(x, prev, query, { timeout = TIMEOUT_MS, signal } = {}) {
  if (!prev?.next) return prev;
  const t0 = Date.now(), page = (prev.page || 1) + 1;
  try { return toResult(x, await fetchPage(x, query, page, prev.next, { timeout, signal }), t0, page, prev.items); }
  catch (e) { if (e.aborted || e.name === 'AbortError' || signal?.aborted) throw e; return errResult(x, e, t0, prev); }
}
