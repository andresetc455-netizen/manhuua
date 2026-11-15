// Imágenes de extensiones JSON (con dominios autorizados). Un <img src> deja que el navegador siga
// redirecciones a cualquier dominio sin que la app lo vea; por eso estas imágenes se piden con
// fetchVia estricto (proxy propio con "hosts" y x-final-url verificada, o acceso directo sin seguir
// redirecciones) y se muestran como Blob. Nunca se usan proxies públicos.
import { fetchVia } from './sources/web.js';

function makeCache(max) {
  const m = new Map();
  return (url, referer, hosts, { force = false } = {}) => {
    const k = url + '\n' + hosts.join(',');
    if (force) m.delete(k);
    let p = m.get(k);
    if (p) { m.delete(k); m.set(k, p); return p; } // LRU
    p = fetchVia(url, 'blob', referer, undefined, { hosts }).then((b) => {
      if (/^(text\/html|application\/json)/i.test(b.type)) throw Object.assign(new Error('La respuesta no es una imagen.'), { source: 'site' });
      return b;
    });
    p.catch(() => m.delete(k));
    m.set(k, p);
    while (m.size > max) m.delete(m.keys().next().value);
    return p;
  };
}
/** Página de capítulo en línea (pocas en memoria: son grandes). */
export const pageBlob = makeCache(16);
/** Portada (pequeñas; se reutilizan en catálogo, ficha y fondo). */
export const coverBlob = makeCache(120);
