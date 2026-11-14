import { useEffect, useState } from 'react';
import { getExtension, browse, seriesDetail } from '../sources/extensions.js';
import { activeProxy, usingPublicProxy } from '../sources/web.js';
import { enqueue, useDownloads } from '../downloads.js';
import { useDb, getAll } from '../db.js';
import { Icon, Cover, BgCover, Favicon, go } from '../ui.jsx';

const NoProxy = () => !activeProxy() && !usingPublicProxy() && (
  <p className="hint">Sin proxy: si el sitio bloquea CORS no va a cargar. Activá el proxy automático en <a href="#/settings">Ajustes</a>.</p>
);

export function ExtensionHome({ extId }) {
  const ext = getExtension(extId);
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('loading');
  const [err, setErr] = useState('');

  const load = async (opts = {}, append = false) => {
    setState('loading'); setErr('');
    try {
      const r = await browse(ext, opts);
      setItems((prev) => (append ? [...prev, ...r.items.filter((i) => !prev.some((p) => p.url === i.url))] : r.items));
      setNext(r.next);
      setState('ok');
    } catch (e) { setErr(e.message); setState('error'); }
  };
  useEffect(() => { ext && load(); }, [extId]); // eslint-disable-line
  if (!ext) return <div className="page"><p className="empty">Extensión no encontrada.</p></div>;

  return (
    <div className="page">
      <header className="top">
        <h1 className="ext-h"><Favicon ext={ext} /> {ext.name}</h1>
        <div className="actions">
          <a className="icon-btn" href={ext.url} target="_blank" rel="noreferrer" title="Abrir sitio"><Icon n="globe" /></a>
          <button className="icon-btn" onClick={() => load()} title="Recargar"><Icon n="refresh" /></button>
        </div>
      </header>
      <form className="search wide" onSubmit={(e) => { e.preventDefault(); load(q ? { query: q } : {}); }}>
        <Icon n="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ext.searchUrl ? 'Buscar en el sitio' : 'Filtrar resultados'} />
      </form>
      <NoProxy />
      {state === 'error' && <p className="error">{err}</p>}
      {state === 'ok' && !items.length && <p className="muted">No se detectaron series en esta página. Probá con la URL del directorio o listado del sitio.</p>}
      <div className="grid">
        {items.map((it) => (
          <a key={it.url} className="card" href={`#/ext/${ext.id}/s/${encodeURIComponent(it.url)}`} onClick={() => sessionStorage.setItem('mh.pick', JSON.stringify(it))}>
            <Cover src={it.cover} title={it.title} referer={ext.url} />
            <span className="card-title">{it.title}</span>
          </a>
        ))}
      </div>
      {state === 'loading' && <p className="muted center">Cargando…</p>}
      {next && state === 'ok' && <button className="btn wide" onClick={() => load({ url: next }, true)}>Cargar más</button>}
    </div>
  );
}

export function RemoteSeries({ extId, url }) {
  const ext = getExtension(extId);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const jobs = useDownloads();
  const lib = useDb(async () => {
    const [series, chapters] = await Promise.all([getAll('series'), getAll('chapters')]);
    return { series, urls: new Set(chapters.map((c) => c.url).filter(Boolean)) };
  });

  useEffect(() => {
    let fb = {};
    try { fb = JSON.parse(sessionStorage.getItem('mh.pick')) || {}; } catch {}
    if (fb.url !== url) fb = {};
    ext && seriesDetail(ext, url, fb).then(setD).catch((e) => setErr(e.message));
  }, [extId, url]); // eslint-disable-line
  if (!ext) return <div className="page"><p className="empty">Extensión no encontrada.</p></div>;

  const inLib = lib?.series.find((s) => s.sourceUrl === url);
  const queued = new Set(jobs.filter((j) => j.status !== 'error').map((j) => j.url));
  const job = (c) => ({ url: c.url, title: c.title, number: c.number, images: c.images, series: d.title, cover: d.cover, sourceUrl: url.startsWith('http') ? url : undefined });
  const pending = d ? d.chapters.filter((c) => !lib?.urls.has(c.url) && !queued.has(c.url)) : [];

  return (
    <div className="page">
      <header className="top">
        <button className="icon-btn" onClick={() => history.back()} aria-label="Volver"><Icon n="back" /></button>
        <div className="actions"><a className="icon-btn" href={url.startsWith('http') ? url : ext.url} target="_blank" rel="noreferrer" title="Abrir en el sitio"><Icon n="globe" /></a></div>
      </header>
      <NoProxy />
      {err && <p className="error">{err}</p>}
      {!d && !err && <p className="muted center">Cargando…</p>}
      {d && (
        <>
          <div className="hero">
            <BgCover src={d.cover} referer={ext.url} />
            <Cover src={d.cover} title={d.title} referer={ext.url} />
            <div>
              <h1>{d.title}</h1>
              <p className="muted">{d.chapters.length} capítulos · {ext.name}</p>
              {d.description && <p className="desc">{d.description}</p>}
              <div className="row">
                {pending.length > 0 && <button className="btn primary" onClick={() => enqueue(pending.map(job))}><Icon n="down" size={16} /> Descargar {pending.length === d.chapters.length ? 'todo' : `${pending.length} faltantes`}</button>}
                {inLib && <button className="btn" onClick={() => go(`/s/${inLib.id}`)}><Icon n="book" size={16} /> En biblioteca</button>}
              </div>
            </div>
          </div>
          <h3 className="sec">Capítulos</h3>
          {!d.chapters.length && <p className="muted">No se detectaron enlaces a capítulos en esta página.</p>}
          <ul className="chapters">
            {[...d.chapters].reverse().map((c) => {
              const have = lib?.urls.has(c.url), q = queued.has(c.url);
              return (
                <li key={c.url} className={have ? 'read' : ''}>
                  <span className="ch-link"><span className="ch-title">{c.title}</span><span className="muted small">{have ? 'descargado' : q ? 'en cola' : ''}</span></span>
                  {!have && !q && <button className="icon-btn" title="Descargar" onClick={() => enqueue(job(c))}><Icon n="down" /></button>}
                  {have && <Icon n="check" />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
