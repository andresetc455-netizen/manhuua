import { useState } from 'react';
import { useDb, get, byIndex, write } from '../db.js';
import { sourceKey, seriesSources, equivalent, followSeries, migrateSources } from '../online.js';
import { useExtensions, getExtension, seriesDetail, isEnabled } from '../sources/extensions.js';
import { searchAll } from '../sources/multi.js';
import { compareWorks } from '../unify.js';
import { stateOf } from './Extensions.jsx';
import { byNumber, deleteChapter, deleteSeries, markChapters, nextToRead, updateSeries } from '../library.js';
import { checkUpdates, enqueue } from '../downloads.js';
import { Icon, Cover, BgCover, go } from '../ui.jsx';
import CoverSheet from './CoverSheet.jsx';

export default function SeriesView({ id }) {
  const [desc, setDesc] = useState(false);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('');
  const [desc2, setDesc2] = useState(true);
  const [coverOpen, setCoverOpen] = useState(false);
  const [srcSel, setSrcSel] = useState(null);
  const [finder, setFinder] = useState(null); // búsqueda en otras fuentes
  const exts = useExtensions();
  const d = useDb(async () => {
    const [s, chapters, progress] = await Promise.all([get('series', id), byIndex('chapters', 'seriesId', id), byIndex('progress', 'seriesId', id)]);
    return { s, chapters: chapters.sort(byNumber), progress };
  }, [id]);
  if (!d) return <div className="page" />;
  const { s, chapters: allChapters, progress } = d;
  if (!s) return <div className="page"><p className="empty">Serie no encontrada. <a href="#/">Volver</a></p></div>;

  // Fuentes: cada una con sus capítulos (no se mezclan). Los capítulos importados quedan en "Local".
  const keys = [...new Set([...seriesSources(s).map((x) => x.extId), ...allChapters.map((c) => sourceKey(c, s))])];
  const count = (k) => allChapters.filter((c) => sourceKey(c, s) === k).length;
  const active = keys.includes(srcSel) ? srcSel : keys.includes(s.activeSource) ? s.activeSource : keys.find(count) || keys[0];
  const chapters = keys.length > 1 ? allChapters.filter((c) => sourceKey(c, s) === active) : allChapters;
  const srcName = (k) => k === 'local' ? 'Local' : getExtension(k)?.name || seriesSources(s).find((x) => x.extId === k)?.extName || 'Fuente eliminada';
  const linked = new Set(seriesSources(s).map((x) => x.extId));
  const srcState = (k) => {
    if (k === 'local') return '';
    if (!linked.has(k)) return 'quitada de esta obra · se conservan sus capítulos';
    const x = getExtension(k); return x ? stateOf(x).label : 'extensión eliminada · se conservan los capítulos';
  };
  const pickSource = (k) => { setSrcSel(k); updateSeries(id, { activeSource: k }); };

  const pmap = new Map(progress.map((p) => [p.chapterId, p]));
  let next = chapters.length ? nextToRead(chapters, progress, s.lastChapterId) : null;
  // Si lo último leído fue en otra fuente, se busca el mismo capítulo en esta (solo si es exacto).
  const lastCh = allChapters.find((c) => c.id === s.lastChapterId);
  if (lastCh && keys.length > 1 && sourceKey(lastCh, s) !== active) { const r = equivalent(lastCh, allChapters, s, active); if (r?.exact) next = pmap.get(lastCh.id)?.done ? chapters[chapters.indexOf(r.chapter) + 1] || r.chapter : r.chapter; }

  const findOthers = async () => {
    const have = new Set(seriesSources(s).map((x) => x.extId));
    const pool = exts.filter((x) => isEnabled(x) && !have.has(x.id));
    if (!pool.length) return setFinder({ done: true, res: [], empty: 'No hay otras extensiones activas.' });
    setFinder({ res: [] });
    await searchAll(pool, s.title, (res) => setFinder({ res, done: !res.some((r) => r.state === 'loading') }));
  };
  const attach = async (x, item) => {
    setMsg(`Vinculando ${x.name}…`);
    try {
      const det = await seriesDetail(x, item.url, item);
      if (!det.chapters.length) throw new Error(det.diag?.reasons?.[0] || 'la fuente no devolvió capítulos');
      const r = await followSeries(x, item.url, det, { seriesId: s.id });
      setMsg(`${x.name} vinculada: ${det.chapters.length} capítulos (${r.added} nuevos).`); setFinder(null);
    } catch (e) { setMsg(`${x.name}: ${e.message}`); }
  };
  const detach = async (k) => {
    if (!confirm(`¿Quitar ${srcName(k)} de esta obra? Se conservan los capítulos descargados y los que tienen progreso.`)) return;
    // Primero se fija la fuente de cada capítulo (datos anteriores), así cambiar la fuente principal
    // nunca reasigna capítulos de una fuente a otra.
    await migrateSources(s.id);
    const fresh = await byIndex('chapters', 'seriesId', s.id);
    const drop = fresh.filter((c) => c.sourceId === k && c.online && !pmap.has(c.id));
    const sources = seriesSources(s).filter((x) => x.extId !== k);
    const main = sources[0];
    const latest = (await get('series', s.id)) || s;
    await write(['series', 'chapters'], (o) => {
      drop.forEach((c) => o.chapters.delete(c.id)); // solo capítulos en línea sin leer (se pueden volver a traer)
      o.series.put({ ...latest, sources, activeSource: main?.extId || (latest.activeSource === k ? undefined : latest.activeSource), ...(latest.extId === k ? { extId: main?.extId, extName: main?.extName, sourceUrl: main?.url } : {}) });
    });
    setSrcSel(null);
  };
  // Estadísticas de la fuente elegida: leídos y total sobre los mismos capítulos.
  const readCount = chapters.filter((c) => pmap.get(c.id)?.done).length;
  const started = progress.length > 0;

  const refresh = async () => {
    setMsg('Buscando…');
    try { const n = await checkUpdates(s); setMsg(n ? (s.online ? `${n} capítulos nuevos para leer en línea` : `${n} capítulos nuevos en cola de descargas`) : 'Sin capítulos nuevos'); }
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
          <p className="muted">{chapters.length} capítulos{keys.length > 1 ? ` en ${srcName(active)}` : ''} · {readCount} leídos</p>
          {s.altTitles?.length > 0 && <p className="muted small alt-titles">También: {s.altTitles.slice(0, 4).join(' · ')}</p>}
          {s.coverSource?.link && <p className="muted small">Portada: <a href={s.coverSource.link} target="_blank" rel="noreferrer">{{ anilist: 'AniList', kitsu: 'Kitsu', site: 'sitio' }[s.coverSource.provider] || 'enlace'}</a></p>}
          {s.sourceUrl && <p className="muted small"><a href={s.sourceUrl} target="_blank" rel="noreferrer">{new URL(s.sourceUrl).hostname}</a></p>}
          {s.description && <p className={'desc' + (desc ? ' open' : '')} onClick={() => setDesc(!desc)}>{s.description}</p>}
          {next && <button className="btn primary" onClick={() => go(`/r/${next.id}`)}><Icon n="play" size={16} fill /> {started ? 'Continuar' : 'Empezar'} · {next.title}</button>}
        </div>
      </div>
      {coverOpen && <CoverSheet series={s} onClose={() => setCoverOpen(false)} />}
      <div className="list-head">
        <h3 className="sec">Fuentes</h3>
        {exts.some(isEnabled) && <button className="btn sm" onClick={findOthers}><Icon n="search" size={14} /> Buscar en otras fuentes</button>}
      </div>
      {keys.length > 0 && (
        <ul className="src-list">
          {keys.map((k) => (
            <li key={k} className={k === active ? 'on ok' : 'ok'}>
              <button className="src-pick" onClick={() => pickSource(k)}>
                <b>{srcName(k)}</b><span className="muted small">{count(k)} capítulos{srcState(k) ? ` · ${srcState(k)}` : ''}</span>
              </button>
              {k !== 'local' && keys.length > 1 && linked.has(k) && <button className="btn sm" onClick={() => detach(k)}>Quitar</button>}
            </li>
          ))}
        </ul>
      )}
      {finder && (
        <div className="finder">
          {finder.empty && <p className="muted small">{finder.empty}</p>}
          {finder.res.map((r) => {
            const x = getExtension(r.extId);
            if (!x) return null;
            if (r.state !== 'ok') return <p key={r.extId} className="small muted">{x.name}: {r.state === 'loading' ? 'buscando…' : `${r.label}${r.reason ? ` · ${r.reason}` : ''}`}</p>;
            const cands = r.items.map((it) => ({ it, m: compareWorks({ title: s.title, altTitles: s.altTitles, author: s.author, artist: s.artist, ids: s.ids }, it) })).filter((c) => c.m !== 'different');
            if (!cands.length) return <p key={r.extId} className="small muted">{x.name}: sin coincidencias.</p>;
            return cands.slice(0, 5).map(({ it, m }) => (
              <div key={r.extId + it.url} className="row small">
                <span className="grow"><b>{it.title}</b> · {x.name} · {m === 'same' ? 'coincide' : 'parecida (revisá que sea la misma obra)'}</span>
                <button className="btn sm" onClick={() => attach(x, it)}>Vincular</button>
              </div>
            ));
          })}
          {finder.done && <button className="btn sm" onClick={() => setFinder(null)}>Cerrar</button>}
        </div>
      )}
      <div className="list-head">
        <h3 className="sec">Capítulos{keys.length > 1 ? ` · ${srcName(active)}` : ''}</h3>
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
                <span className="muted small">{c.online ? 'en línea' : `${c.pageCount} págs.`}{p && !p.done ? ` · pág. ${p.page + 1}` : ''}{c.id === s.lastChapterId ? ' · último' : ''}</span>
              </a>
              <button className={'icon-btn' + (p?.done ? ' accent' : '')} title={p?.done ? 'Marcar no leído' : 'Marcar leído'} onClick={() => markChapters([c], !p?.done)}><Icon n="check" /></button>
              {c.online && c.url && <button className="icon-btn" title="Descargar para leer sin conexión" onClick={() => enqueue({ url: c.url, title: c.title, number: c.number, series: s.title, seriesId: s.id, extId: c.sourceId || s.extId, sourceUrl: /^https?:/.test(s.sourceUrl || '') ? s.sourceUrl : undefined, images: c.remotePages && !c.fetchedAt ? c.remotePages : undefined })}><Icon n="down" size={18} /></button>}
              <button className="icon-btn" title="Eliminar capítulo" onClick={() => confirm(`¿Eliminar ${c.title}?`) && deleteChapter(c.id)}><Icon n="trash" size={18} /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
