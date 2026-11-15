import { useMemo, useRef, useState } from 'react';
import { useDb, getAll } from '../db.js';
import { parseFiles } from '../importers.js';
import { importGroups, loadDemo } from '../library.js';
import { checkAllUpdates } from '../downloads.js';
import { autoCover, autoCoverAll } from '../covers.js';
import { loadSettings } from '../settings.js';
import { Icon, Cover, BgCover, Sheet } from '../ui.jsx';

const FILTERS = [['all', 'Todo'], ['fav', 'Favoritos'], ['reading', 'Leyendo'], ['unread', 'Sin leer']];

function ImportSheet({ chapters, onClose }) {
  const [groups, setGroups] = useState(() => {
    const m = new Map();
    chapters.forEach((c) => m.set(c.series, [...(m.get(c.series) || []), c]));
    return [...m].map(([series, chs]) => ({ series, chapters: chs, kind: chs[0].kind, author: chs[0].author }));
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await importGroups(groups);
      if (loadSettings().coverAuto) saved.forEach((x) => autoCover(x.id).catch(() => {}));
      onClose();
    } catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <Sheet title="Importar" onClose={onClose}>
      <div className="form">
        {groups.map((g, i) => (
          <label key={i}>Serie ({g.chapters.length} cap. · {g.kind === 'text' ? 'novela' : `${g.chapters.reduce((n, c) => n + c.pages.length, 0)} págs.`})
            <input value={g.series} onChange={(e) => setGroups(groups.map((x, k) => (k === i ? { ...x, series: e.target.value } : x)))} />
          </label>
        ))}
        {!groups.length && <p className="hint">No se encontraron imágenes ni novelas (TXT/EPUB).</p>}
        <button className="btn primary" disabled={busy || !groups.length} onClick={save}>{busy ? 'Guardando…' : 'Guardar en la biblioteca'}</button>
      </div>
    </Sheet>
  );
}

export default function Library() {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(), dirRef = useRef();

  const data = useDb(async () => {
    const [series, chapters, progress] = await Promise.all([getAll('series'), getAll('chapters'), getAll('progress')]);
    const done = new Set(progress.filter((p) => p.done).map((p) => p.chapterId));
    return series.map((s) => {
      const ch = chapters.filter((c) => c.seriesId === s.id);
      const latest = ch.reduce((a, c) => (!a || (c.number ?? 0) > (a.number ?? 0) ? c : a), null);
      const newest = Math.max(0, ...ch.map((c) => c.addedAt || 0));
      return { ...s, total: ch.length, unread: ch.filter((c) => !done.has(c.id)).length, latest, isNew: Date.now() - newest < 3 * 864e5 };
    });
  });

  const list = useMemo(() => (data || [])
    .filter((s) => filter === 'all' || (filter === 'fav' && s.favorite) || (filter === 'reading' && s.lastReadAt && s.unread) || (filter === 'unread' && s.unread))
    .filter((s) => s.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)), [data, filter, q]);
  const recent = (data || []).filter((s) => s.lastReadAt && s.lastChapterId).sort((a, b) => b.lastReadAt - a.lastReadAt).slice(0, 8);

  const onFiles = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    setMsg('Leyendo archivos…');
    try { setPending(await parseFiles(files)); } catch (err) { alert('Error al leer: ' + err.message); }
    setMsg(''); e.target.value = '';
  };
  const covers = async () => {
    setMsg('Buscando portadas…');
    try {
      const r = await autoCoverAll((i, n) => setMsg(`Buscando portadas ${i}/${n}…`));
      setMsg(r.total ? `Portadas encontradas: ${r.found} de ${r.total}` : 'Todas las series ya tienen portada');
    } catch (e) { setMsg(e.message); }
    setTimeout(() => setMsg(''), 3500);
  };
  const update = async () => {
    setMsg('Buscando capítulos nuevos…');
    const n = await checkAllUpdates();
    setMsg(n ? `${n} capítulos nuevos en cola` : 'Sin novedades');
    setTimeout(() => setMsg(''), 2500);
  };

  return (
    <div className="page">
      <header className="top">
        <h1>Biblioteca</h1>
        <div className="actions">
          <button className="icon-btn" title="Buscar portadas que falten" onClick={covers}><Icon n="image" /></button>
          <button className="icon-btn" title="Buscar actualizaciones" onClick={update}><Icon n="refresh" /></button>
          <button className="icon-btn" title="Importar carpeta" onClick={() => dirRef.current.click()}><Icon n="folder" /></button>
          <button className="btn primary sm" onClick={() => fileRef.current.click()}><Icon n="plus" size={16} /><span className="hide-sm"> Importar</span></button>
        </div>
        <input ref={fileRef} type="file" hidden multiple accept=".cbz,.zip,.epub,.txt,image/*" onChange={onFiles} />
        <input ref={dirRef} type="file" hidden multiple webkitdirectory="" onChange={onFiles} />
      </header>
      {msg && <div className="toast">{msg}</div>}

      {recent[0] && (
        <a className="feature" href={`#/r/${recent[0].lastChapterId}`}>
          <BgCover src={recent[0].cover} />
          <Cover src={recent[0].cover} title={recent[0].title} />
          <div className="feature-txt">
            <span className="muted small">Seguí donde lo dejaste</span>
            <h2>{recent[0].title}</h2>
            <span className="muted small">{recent[0].total} capítulos · {recent[0].unread} sin leer</span>
            <span className="btn primary sm"><Icon n="play" size={14} fill /> Continuar</span>
          </div>
        </a>
      )}

      {recent.length > 1 && (
        <section>
          <h3 className="sec">Continuar leyendo</h3>
          <div className="strip">
            {recent.slice(1).map((s) => (
              <a key={s.id} className="strip-item" href={`#/r/${s.lastChapterId}`}>
                <Cover src={s.cover} title={s.title}><span className="play"><Icon n="play" size={14} fill /></span></Cover>
                <span>{s.title}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="toolbar">
        <div className="search"><Icon n="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la biblioteca" /></div>
        <div className="chips">
          {FILTERS.map(([k, l]) => <button key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>

      {data && !data.length ? (
        <div className="empty">
          <h2>Tu biblioteca está vacía</h2>
          <p>Importá capítulos en CBZ/ZIP, carpetas de imágenes o novelas propias en TXT/EPUB sin DRM, pegá una URL en <a href="#/downloads">Descargas</a>, o agregá una extensión desde el menú.</p>
          <div className="row">
            <button className="btn primary" onClick={() => fileRef.current.click()}>Importar archivos</button>
            <button className="btn" onClick={() => loadDemo()}>Cargar demo</button>
          </div>
        </div>
      ) : (
        <div className="grid">
          {list.map((s) => (
            <a key={s.id} className="card" href={`#/s/${s.id}`}>
              <Cover src={s.cover} title={s.title} kind={s.kind}>
                {s.kind && <span className="kind">{s.kind}</span>}
                {s.unread > 0 && <span className="badge">{s.unread}</span>}
                {s.favorite && <span className="fav-star"><Icon n="star" size={14} fill /></span>}
                {s.isNew && <span className="tag-new">Nuevo</span>}
                {s.online && <span className="online-badge">En línea</span>}
              </Cover>
              <span className="card-title">{s.title}</span>
              {s.latest && <span className="ch-chip">{s.latest.number != null ? `Cap. ${s.latest.number}` : s.latest.title}</span>}
            </a>
          ))}
        </div>
      )}
      {pending && <ImportSheet chapters={pending} onClose={() => setPending(null)} />}
    </div>
  );
}
