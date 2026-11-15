// Novedades, Historial, Explorar y Más (estructura tipo lector de manga con pestañas).
import { useEffect, useMemo, useState } from 'react';
import { useDb, getAll } from '../db.js';
import { checkAllUpdates } from '../downloads.js';
import { useExtensions, isEnabled, extHosts } from '../sources/extensions.js';
import { searchAll } from '../sources/multi.js';
import { groupWorks, onMergesChange, getMerges } from '../unify.js';
import { stateOf } from './Extensions.jsx';
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

const SS = 'mh.browse';
const ssGet = (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** Abre la ficha unificada de una obra agrupada. */
export function openWork(w) {
  ssSet('mh.work:' + w.key, { ...w, sources: w.sources.map((s) => ({ extId: s.ext.id, item: s.item, key: s.key })), maybe: w.maybe.map((m) => ({ key: m.key, title: m.title, extId: m.ext.id, mine: m.mine, item: m.item })) });
  go(`/w/${encodeURIComponent(w.key)}`);
}

export function Browse({ onAdd }) {
  const all = useExtensions();
  const exts = all.filter(isEnabled);
  const saved = ssGet(SS);
  const [q, setQ] = useState(saved?.q || '');
  const [res, setRes] = useState(saved?.res || null); // [{extId, state, items, label, reason}]
  const [mode, setMode] = useState(saved?.mode || '');
  const [f, setF] = useState({ genre: '', status: '', source: '', sort: 'rel' });
  const [, bump] = useState(0);
  useEffect(() => onMergesChange(() => bump((n) => n + 1)), []);
  useEffect(() => { if (res && !res.some((r) => r.state === 'loading')) ssSet(SS, { q, res, mode }); }, [res]); // eslint-disable-line
  const run = (query) => { setMode(query ? 'search' : 'catalog'); setF({ genre: '', status: '', source: '', sort: 'rel' }); searchAll(exts, query, setRes); };
  const search = (e) => { e.preventDefault(); if (!q.trim()) { setRes(null); sessionStorage.removeItem(SS); return; } run(q.trim()); };
  const extById = (id) => all.find((x) => x.id === id);

  const groups = useMemo(() => {
    if (!res) return [];
    const entries = res.flatMap((r) => { const x = extById(r.extId); return x ? r.items.map((item) => ({ ext: x, item })) : []; });
    return groupWorks(entries);
  }, [res, all, getMerges()]); // eslint-disable-line
  const genres = [...new Set(groups.flatMap((g) => g.genres))].sort((a, b) => a.localeCompare(b));
  const statuses = [...new Set(groups.map((g) => g.status).filter(Boolean))];
  let shown = groups.filter((g) => (!f.genre || g.genres.includes(f.genre)) && (!f.status || g.status === f.status) && (!f.source || g.sources.some((s) => s.ext.id === f.source)));
  if (f.sort === 'az') shown = [...shown].sort((a, b) => a.title.localeCompare(b.title, 'es'));
  if (f.sort === 'upd') shown = [...shown].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const loading = res?.some((r) => r.state === 'loading');

  return (
    <div className="page">
      <header className="top"><h1>Explorar</h1><div className="actions">
        {exts.length > 0 && <button className="btn sm" onClick={() => { setQ(''); run(''); }}><Icon n="book" size={16} /> Catálogo unificado</button>}
        <button className="btn primary sm" onClick={onAdd}><Icon n="plus" size={16} /> Extensión</button>
      </div></header>
      <form className="search wide big" onSubmit={search}>
        <Icon n="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar en ${exts.length} fuentes a la vez`} enterKeyHint="search" />
        {q && <button type="button" className="icon-btn" onClick={() => { setQ(''); setRes(null); sessionStorage.removeItem(SS); }} aria-label="Limpiar"><Icon n="x" size={16} /></button>}
      </form>
      {res ? (
        <>
          <div className="src-strip">
            {res.map((r) => { const x = extById(r.extId); if (!x) return null; return (
              <span key={r.extId} className={'src-pill ' + r.state} title={r.reason || ''}>
                <Favicon ext={x} /> {x.name}: {r.state === 'loading' ? 'buscando…' : r.state === 'ok' ? `${r.items.length} ${r.items.length === 1 ? 'obra' : 'obras'}` : r.label}
              </span>); })}
          </div>
          {res.some((r) => r.state === 'error') && <p className="muted small">Las fuentes con error no afectan a las demás. Detalle en <a href="#/extensions">Extensiones</a>.</p>}
          {groups.length > 0 && (
            <div className="filters">
              <select value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value })} aria-label="Género"><option value="">Todos los géneros</option>{genres.map((g) => <option key={g}>{g}</option>)}</select>
              <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Estado"><option value="">Cualquier estado</option>{statuses.map((g) => <option key={g}>{g}</option>)}</select>
              <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} aria-label="Fuente"><option value="">Todas las fuentes</option>{res.filter((r) => r.items.length).map((r) => <option key={r.extId} value={r.extId}>{extById(r.extId)?.name}</option>)}</select>
              <select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} aria-label="Orden"><option value="rel">Orden de las fuentes</option><option value="az">Alfabético</option><option value="upd">Últimas actualizaciones</option></select>
              <span className="muted small">{shown.length} {shown.length === 1 ? 'obra' : 'obras'}{groups.length !== shown.length ? ` de ${groups.length}` : ''}</span>
            </div>
          )}
          <div className="grid">
            {shown.map((w) => (
              <a key={w.key} className="card" href={`#/w/${encodeURIComponent(w.key)}`} onClick={(e) => { e.preventDefault(); openWork(w); }}>
                <Cover src={w.cover} title={w.title} referer={(w.coverExt || w.sources[0].ext).url} hosts={extHosts(w.coverExt || w.sources[0].ext)}>
                  {w.sources.length > 1 && <span className="kind src-count">{w.sources.length} fuentes</span>}
                </Cover>
                <span className="card-title">{w.title}</span>
                <span className="muted small card-sub">{[w.status, w.sources.map((s) => s.ext.name).join(', ')].filter(Boolean).join(' · ')}{w.maybe.length ? ' · posible duplicado' : ''}</span>
              </a>
            ))}
          </div>
          {loading && <p className="muted center">Consultando fuentes…</p>}
          {!loading && !groups.length && <p className="empty">{mode === 'search' ? 'Ninguna fuente devolvió resultados.' : 'Las fuentes no devolvieron obras.'}</p>}
        </>
      ) : (
        <>
          <h3 className="sec">Extensiones</h3>
          {!all.length && <p className="muted">Agregá un sitio con el botón "Extensión" para navegar su catálogo.</p>}
          <ul className="ext-cards">
            {exts.map((x) => (
              <li key={x.id}>
                <a href={`#/ext/${x.id}`}>
                  <Favicon ext={x} />
                  <span className="grow"><b>{x.name}</b><span className="muted small">{new URL(x.url).hostname}{x.searchUrl ? ' · búsqueda' : ''} · {stateOf(x).label}</span></span>
                  <span className="btn sm">Abrir</span>
                </a>
              </li>
            ))}
          </ul>
          {all.length > exts.length && <p className="muted small">{all.length - exts.length} desactivadas · <a href="#/extensions">Gestionar</a></p>}
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
        {link('extensions', 'compass', 'Extensiones', 'Instalar, comprobar, activar y eliminar fuentes')}
        {link('settings', 'gear', 'Ajustes', 'Lector, tema, traducción, proxy y extensiones')}
      </ul>
    </div>
  );
}
