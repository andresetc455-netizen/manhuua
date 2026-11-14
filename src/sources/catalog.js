// Fuente "Catálogo JSON": un archivo JSON propio que lista series/capítulos/páginas.
// Formato: { "name": "...", "series": [ { "id", "title", "cover", "description",
//   "chapters": [ { "id", "title", "number", "pages": ["url", ...] } ] } ] }
// Las URLs relativas se resuelven contra la URL del catálogo.
import { fetchVia } from './web.js';

export function catalogSource({ id, url }) {
  let cache;
  const load = () => (cache ??= fetchVia(url).then((t) => JSON.parse(t)).catch((e) => { cache = null; throw e; }));
  const abs = (u) => (u ? new URL(u, url).href : null);
  return {
    id,
    async name() { return (await load()).name || new URL(url).hostname; },
    async search(q = '') {
      const s = (await load()).series || [];
      return s.filter((x) => x.title.toLowerCase().includes(q.toLowerCase()))
        .map((x) => ({ remoteId: x.id, title: x.title, cover: abs(x.cover), description: x.description || '' }));
    },
    async chapters(remoteId) {
      const s = ((await load()).series || []).find((x) => x.id === remoteId);
      return (s?.chapters || []).map((c) => ({ remoteId: c.id, title: c.title, number: c.number ?? null, pages: (c.pages || []).map(abs) }));
    },
  };
}
