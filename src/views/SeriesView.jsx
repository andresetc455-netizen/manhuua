import { useState } from 'react';
import { useDb, get, byIndex } from '../db.js';
import { byNumber, deleteChapter, deleteSeries, markChapters, nextToRead, updateSeries } from '../library.js';
import { checkUpdates } from '../downloads.js';
import { Icon, Cover, BgCover, go } from '../ui.jsx';
import CoverSheet from './CoverSheet.jsx';

export default function SeriesView({ id }) {
  const [desc, setDesc] = useState(false);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('');
  const [desc2, setDesc2] = useState(true);
  const [coverOpen, setCoverOpen] = useState(false);
  const d = useDb(async () => {
    const [s, chapters, progress] = await Promise.all([get('series', id), byIndex('chapters', 'seriesId', id), byIndex('progress', 'seriesId', id)]);
    return { s, chapters: chapters.sort(byNumber), progress };
  }, [id]);
  if (!d) return <div className="page" />;
  const { s, chapters, progress } = d;
  if (!s) return <div className="page"><p className="empty">Serie no encontrada. <a href="#/">Volver</a></p></div>;

  const pmap = new Map(progress.map((p) => [p.chapterId, p]));
  const next = chapters.length ? nextToRead(chapters, progress, s.lastChapterId) : null;
  const readCount = progress.filter((p) => p.done).length;
  const started = progress.length > 0;

  const refresh = async () => {
    setMsg('Buscando…');
    try { const n = await checkUpdates(s); setMsg(n ? `${n} capítulos nuevos en cola de descargas` : 'Sin capítulos nuevos'); }
    catch (e) { setMsg(e.message); }
  };

  return (
    <div className="page">
      <header className="top">
        <button className="icon-btn" onClick={() => go('/')} aria-label="Volver"><Icon n="back" /></button>
        <div className="actions">
          {s.sourceUrl && <button className="icon-btn" title="Buscar capítulos nuevos" onClick={refresh}><Icon n="refresh" /></button>}
          <button className={'icon-btn' + (s.favorite ? ' accent' : '')} title="Favorito" onClick={() => updateSeries(id, { favorite: !s.favorite })}><Icon n="star" fill={s.favorite} /></button>
          <button className="icon-btn" title="Eliminar serie" onClick={() => confirm(`¿Eliminar "${s.title}" y sus capítulos?`) && deleteSeries(id).then(() => go('/'))}><Icon n="trash" /></button>
        </div>
      </header>
      {msg && <div className="toast" onClick={() => setMsg('')}>{msg}</div>}
      <div className="hero">
        <BgCover src={s.cover} />
        <button className="cover-edit" onClick={() => setCoverOpen(true)} title="Cambiar portada">
          <Cover src={s.cover} title={s.title} kind={s.kind} />
          <span className="cover-edit-lbl"><Icon n="image" size={14} /> Portada</span>
        </button>
        <div>
          <h1>{s.title}</h1>
          {(s.kind || s.genres?.length) && <div className="tags">{[s.kind, ...(s.genres || [])].filter(Boolean).map((g) => <span key={g} className="ch-chip">{g}</span>)}</div>}
          <p className="muted">{chapters.length} capítulos · {readCount} leídos</p>
          {s.coverSource?.link && <p className="muted small">Portada: <a href={s.coverSource.link} target="_blank" rel="noreferrer">{{ anilist: 'AniList', kitsu: 'Kitsu', site: 'sitio' }[s.coverSource.provider] || 'enlace'}</a></p>}
          {s.sourceUrl && <p className="muted small"><a href={s.sourceUrl} target="_blank" rel="noreferrer">{new URL(s.sourceUrl).hostname}</a></p>}
          {s.description && <p className={'desc' + (desc ? ' open' : '')} onClick={() => setDesc(!desc)}>{s.description}</p>}
          {next && <button className="btn primary" onClick={() => go(`/r/${next.id}`)}><Icon n="play" size={16} fill /> {started ? 'Continuar' : 'Empezar'} · {next.title}</button>}
        </div>
      </div>
      {coverOpen && <CoverSheet series={s} onClose={() => setCoverOpen(false)} />}
      <div className="list-head">
        <h3 className="sec">Capítulos</h3>
        <div className="row">
          <div className="search sm"><Icon n="search" size={14} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar capítulo" /></div>
          <button className="btn sm" onClick={() => setDesc2(!desc2)}>{desc2 ? 'Más nuevos ↓' : 'Más viejos ↓'}</button>
          <button className="btn sm" onClick={() => markChapters(chapters, true)}>Marcar todo leído</button>
          <button className="btn sm" onClick={() => markChapters(chapters, false)}>Desmarcar</button>
        </div>
      </div>
      <ul className="chapters">
        {(desc2 ? [...chapters].reverse() : chapters).filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()) || String(c.number) === filter.trim()).map((c) => {
          const p = pmap.get(c.id);
          return (
            <li key={c.id} className={p?.done ? 'read' : ''}>
              <a href={`#/r/${c.id}`}>
                <span className="ch-title">{c.title}</span>
                <span className="muted small">{c.pageCount} págs.{p && !p.done ? ` · pág. ${p.page + 1}` : ''}{c.id === s.lastChapterId ? ' · último' : ''}</span>
              </a>
              <button className={'icon-btn' + (p?.done ? ' accent' : '')} title={p?.done ? 'Marcar no leído' : 'Marcar leído'} onClick={() => markChapters([c], !p?.done)}><Icon n="check" /></button>
              <button className="icon-btn" title="Eliminar capítulo" onClick={() => confirm(`¿Eliminar ${c.title}?`) && deleteChapter(c.id)}><Icon n="trash" size={18} /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
