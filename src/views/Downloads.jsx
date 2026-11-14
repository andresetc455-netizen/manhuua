import { useState } from 'react';
import { analyze, activeProxy } from '../sources/web.js';
import { enqueue, useDownloads, clearFinished, retry } from '../downloads.js';
import { Icon } from '../ui.jsx';

/** Panel para pegar URLs y ver la cola. */
export function UrlImporter() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null);
  const [err, setErr] = useState('');

  const run = async (e) => {
    e.preventDefault();
    const urls = text.split(/\s+/).filter(Boolean);
    if (!urls.length) return;
    setBusy(true); setErr(''); setFound(null);
    try {
      if (urls.length > 1) {
        // Varias URLs: cada una es un capítulo
        const infos = await Promise.all(urls.map((u) => analyze(u).catch((x) => ({ url: u, error: x.message }))));
        const ok = infos.filter((i) => i.kind === 'chapter');
        enqueue(ok.map((i) => ({ url: i.url, series: i.series, title: i.title, number: i.number, images: i.images })));
        const bad = infos.length - ok.length;
        if (bad) setErr(`${bad} URL(s) sin páginas detectables`);
        setText('');
      } else {
        const info = await analyze(urls[0]);
        if (info.kind === 'empty') throw new Error('No se detectaron páginas ni capítulos en esa URL');
        setFound({ ...info, picked: new Set(info.chapters.map((c) => c.url)) });
      }
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  const confirm = () => {
    const f = found;
    if (f.kind === 'chapter') enqueue({ url: f.url, series: f.series, title: f.title, number: f.number, images: f.images });
    else enqueue(f.chapters.filter((c) => f.picked.has(c.url)).map((c) => ({ url: c.url, title: c.title, number: c.number, series: f.series, cover: f.cover, sourceUrl: f.url })));
    setFound(null); setText('');
  };

  return (
    <div className="panel">
      <form onSubmit={run} className="url-form">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder="Pegá la URL de un capítulo o de la página de una serie (o varias URLs de capítulos, una por línea)" />
        <button className="btn primary" disabled={busy}><Icon n="down" size={16} /> {busy ? 'Analizando…' : 'Analizar'}</button>
      </form>
      {!activeProxy() && <p className="hint">Sin proxy: la mayoría de los sitios bloquean la descarga directa desde el navegador (CORS). Iniciá <code>npm run serve</code> o configurá uno en Ajustes.</p>}
      {err && <p className="error">{err}</p>}
      {found && (
        <div className="found">
          <label>Serie <input value={found.series} onChange={(e) => setFound({ ...found, series: e.target.value })} /></label>
          {found.kind === 'chapter' ? (
            <p>{found.title}: <b>{found.images.length}</b> imágenes detectadas.</p>
          ) : (
            <>
              <div className="row between">
                <span><b>{found.picked.size}</b> de {found.chapters.length} capítulos</span>
                <span className="row">
                  <button className="btn sm" onClick={() => setFound({ ...found, picked: new Set(found.chapters.map((c) => c.url)) })}>Todos</button>
                  <button className="btn sm" onClick={() => setFound({ ...found, picked: new Set() })}>Ninguno</button>
                </span>
              </div>
              <ul className="pick">
                {found.chapters.map((c) => (
                  <li key={c.url}><label><input type="checkbox" checked={found.picked.has(c.url)} onChange={(e) => {
                    const p = new Set(found.picked); e.target.checked ? p.add(c.url) : p.delete(c.url); setFound({ ...found, picked: p });
                  }} /> {c.title}</label></li>
                ))}
              </ul>
            </>
          )}
          <div className="row">
            <button className="btn primary" onClick={confirm}>Descargar a la biblioteca</button>
            <button className="btn" onClick={() => setFound(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Queue() {
  const jobs = useDownloads();
  if (!jobs.length) return <p className="muted">No hay descargas.</p>;
  return (
    <>
      <div className="row between"><h3 className="sec">Cola</h3><button className="btn sm" onClick={clearFinished}>Limpiar terminadas</button></div>
      <ul className="queue">
        {jobs.map((j) => (
          <li key={j.id} className={'st-' + j.status}>
            <div className="q-main">
              <b>{j.series}</b> · {j.title || j.url}
              <div className="muted small">{j.status}{j.total ? ` · ${j.done}/${j.total}` : ''}{j.error ? ` · ${j.error}` : ''}{j.missing ? ` · ${j.missing} imágenes descartadas` : ''}</div>
              {j.status === 'descargando' && <progress max={j.total} value={j.done} />}
            </div>
            {j.status === 'error' && <button className="btn sm" onClick={() => retry(j.id)}>Reintentar</button>}
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Downloads() {
  return (
    <div className="page">
      <header className="top"><h1>Descargas</h1></header>
      <UrlImporter />
      <Queue />
      <p className="hint">Descargá solo contenido que tengas derecho a guardar.</p>
    </div>
  );
}
