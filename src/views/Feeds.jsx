// Novedades, Historial, Explorar y Más (estructura tipo lector de manga con pestañas).
import { useState } from 'react';
import { useDb, getAll } from '../db.js';
import { checkAllUpdates } from '../downloads.js';
import { useExtensions, browse } from '../sources/extensions.js';
import { Icon, Cover, Favicon, go } from '../ui.jsx';

const DAY = 864e5;
function dayLabel(t) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const diff = Math.floor((d0 - new Date(t).setHours(0, 0, 0, 0)) / DAY) * -1;
  if (diff === 0) return 'Hoy';
  if (diff === -1) return 'Ayer';
  if (diff > -7) return `Hace ${-diff} días`;
  return new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
}
const time = (t) => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
function groupByDay(items, key) {
  const out = [];
  for (const it of items) {
    const l = dayLabel(it[key]);
    if (!out.length || out[out.length - 1].label !== l) out.push({ label: l, items: [] });
    out[out.length - 1].items.push(it);
  }
  return out;
}

function useLib() {
  return useDb(async () => {
    const [series, chapters, progress] = await Promise.all([getAll('series'), getAll('chapters'), getAll('progress')]);
    return { smap: new Map(series.map((s) => [s.id, s])), cmap: new Map(chapters.map((c) => [c.id, c])), chapters, progress, pmap: new Map(progress.map((p) => [p.chapterId, p])) };
  });
}

export function Updates() {
  const d = useLib();
  const [msg, setMsg] = useState('');
  const refresh = async () => {
    setMsg('Buscando capítulos nuevos…');
    const n = await checkAllUpdates();
    setMsg(n ? `${n} capítulos nuevos en descarga` : 'Sin novedades');
  };
  const list = d ? [...d.chapters].filter((c) => d.smap.has(c.seriesId)).sort((a, b) => b.addedAt - a.addedAt).slice(0, 200) : [];
  return (
    <div className="page narrow">
      <header className="top"><h1>Novedades</h1><div className="actions"><button className="icon-btn" title="Buscar actualizaciones" onClick={refresh}><Icon n="refresh" /></button></div></header>
      {msg && <div className="toast" onClick={() => setMsg('')}>{msg}</div>}
      {d && !list.length && <p className="empty">Todavía no hay capítulos. Los nuevos aparecen acá cuando se descargan o importan.</p>}
      {groupByDay(list, 'addedAt').map((g) => (
        <section key={g.label}>
          <h3 className="sec">{g.label}</h3>
          <ul className="feed">
            {g.items.map((c) => {
              const s = d.smap.get(c.seriesId), p = d.pmap.get(c.id);
              return (
                <li key={c.id} className={p?.done ? 'read' : ''}>
                  <a href={`#/s/${s.id}`} className="feed-cover"><Cover src={s.cover} title={s.title} /></a>
                  <a href={`#/r/${c.id}`} className="feed-txt">
                    <b>{s.title}</b>
                    <span className="muted small">{c.title}{p && !p.done ? ` · pág. ${p.page + 1}` : ''}</span>
                  </a>
                  {!p?.done && <span className="dot" title="Sin leer" />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function History() {
  const d = useLib();
  const [q, setQ] = useState('');
  let list = [];
  if (d) {
    const seen = new Set();
    for (const p of [...d.progress].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const s = d.smap.get(p.seriesId), c = d.cmap.get(p.chapterId);
      if (!s || !c || seen.has(s.id)) continue;
      seen.add(s.id);
      if (s.title.toLowerCase().includes(q.toLowerCase())) list.push({ ...p, s, c });
    }
  }
  return (
    <div className="page narrow">
      <header className="top"><h1>Historial</h1></header>
      <div className="search wide"><Icon n="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el historial" /></div>
      {d && !list.length && <p className="empty">Lo que leas va a aparecer acá.</p>}
      {groupByDay(list, 'updatedAt').map((g) => (
        <section key={g.label}>
          <h3 className="sec">{g.label}</h3>
          <ul className="feed">
            {g.items.map((h) => (
              <li key={h.s.id}>
                <a href={`#/s/${h.s.id}`} className="feed-cover"><Cover src={h.s.cover} title={h.s.title} /></a>
                <a href={`#/s/${h.s.id}`} className="feed-txt">
                  <b>{h.s.title}</b>
                  <span className="muted small">{h.c.title}{h.done ? ' · leído' : ` · pág. ${h.page + 1}/${h.total}`} · {time(h.updatedAt)}</span>
                </a>
                <button className="icon-btn accent" title="Continuar" onClick={() => go(`/r/${h.c.id}`)}><Icon n="play" fill /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Browse({ onAdd }) {
  const exts = useExtensions();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return setRes(null);
    setRes(exts.map((x) => ({ ext: x, state: 'loading', items: [] })));
    await Promise.all(exts.map(async (x, i) => {
      let r;
      try { r = { ext: x, state: 'ok', items: (await browse(x, { query: q })).items }; } catch (err) { r = { ext: x, state: 'error', error: err.message, items: [] }; }
      setRes((prev) => prev && prev.map((p, k) => (k === i ? r : p)));
    }));
  };
  return (
    <div className="page">
      <header className="top"><h1>Explorar</h1><div className="actions"><button className="btn primary sm" onClick={onAdd}><Icon n="plus" size={16} /> Extensión</button></div></header>
      <form className="search wide" onSubmit={search}>
        <Icon n="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Búsqueda global en todas las extensiones" enterKeyHint="search" />
      </form>
      {res ? res.map((r) => (
        <section key={r.ext.id}>
          <h3 className="sec ext-sec"><Favicon ext={r.ext} /> {r.ext.name} {r.state === 'loading' && <span className="muted">· buscando…</span>}</h3>
          {r.state === 'error' && <p className="error small">{r.error}</p>}
          {r.state === 'ok' && !r.items.length && <p className="muted small">Sin resultados{!r.ext.searchUrl ? ' (configurá una URL de búsqueda en Ajustes para buscar en todo el sitio)' : ''}.</p>}
          <div className="strip">
            {r.items.map((it) => (
              <a key={it.url} className="strip-item" href={`#/ext/${r.ext.id}/s/${encodeURIComponent(it.url)}`} onClick={() => sessionStorage.setItem('mh.pick', JSON.stringify(it))}>
                <Cover src={it.cover} title={it.title} referer={r.ext.url} />
                <span>{it.title}</span>
              </a>
            ))}
          </div>
        </section>
      )) : (
        <>
          <h3 className="sec">Extensiones</h3>
          {!exts.length && <p className="muted">Agregá un sitio con el botón "Extensión" para navegar su catálogo.</p>}
          <ul className="ext-cards">
            {exts.map((x) => (
              <li key={x.id}>
                <a href={`#/ext/${x.id}`}>
                  <Favicon ext={x} />
                  <span className="grow"><b>{x.name}</b><span className="muted small">{new URL(x.url).hostname}{x.searchUrl ? ' · búsqueda' : ''}</span></span>
                  <span className="btn sm">Abrir</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function More() {
  const link = (h, i, t, d) => (
    <li><a href={'#/' + h}><Icon n={i} /><span className="grow"><b>{t}</b><span className="muted small">{d}</span></span></a></li>
  );
  return (
    <div className="page narrow">
      <header className="top more-head"><img src="./icon.svg" alt="" width="44" height="44" /><h1>Manhuua</h1></header>
      <ul className="ext-cards">
        {link('downloads', 'down', 'Descargas', 'Pegar URLs y ver la cola')}
        {link('settings', 'gear', 'Ajustes', 'Lector, tema, traducción, proxy y extensiones')}
      </ul>
    </div>
  );
}
