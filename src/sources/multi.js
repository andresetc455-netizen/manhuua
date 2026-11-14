// Consultas a varias fuentes a la vez. Cada fuente es independiente: un 403, un 404 o una fuente
// caída no cancelan las demás, y cada una tiene su tiempo máximo.
import { browse, recordStatus } from './extensions.js';
import { classify } from './engine.js';

const TIMEOUT_MS = 30000;
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(`sin respuesta en ${ms / 1000} s`), { timeout: true })), ms))]);

/**
 * Busca (query) o lista el catálogo (sin query) en todas las extensiones dadas.
 * onUpdate(results) se llama cada vez que responde una. results[i] = {extId, state, items, label, kind, reason, ms}.
 */
export async function searchAll(exts, query, onUpdate, { timeout = TIMEOUT_MS } = {}) {
  const results = exts.map((x) => ({ extId: x.id, state: 'loading', items: [] }));
  const emit = () => onUpdate?.(results.map((r) => ({ ...r })));
  emit();
  await Promise.all(exts.map(async (x, i) => {
    const t0 = Date.now();
    let r;
    try {
      const out = await withTimeout(browse(x, query ? { query } : {}), timeout);
      const c = classify(out.diag);
      const failed = !out.items.length && !['ok', 'extraction'].includes(c.state);
      r = { extId: x.id, state: failed ? 'error' : 'ok', items: out.items, label: c.label, kind: c.kind, httpStatus: c.httpStatus, reason: out.diag.reasons?.[0], ms: Date.now() - t0 };
      // El estado de la fuente se actualiza con lo observado (una búsqueda sin resultados no cuenta como falla).
      if (failed || !query) recordStatus(x, { ...out.diag, ms: r.ms });
    } catch (e) {
      r = { extId: x.id, state: 'error', items: [], label: e.timeout ? 'Sin respuesta' : 'Error', kind: e.timeout ? 'network' : undefined, reason: e.message, ms: Date.now() - t0 };
    }
    results[i] = r;
    emit();
  }));
  return results;
}
