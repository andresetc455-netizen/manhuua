import { useEffect, useRef, useState } from 'react';
import { MD_LANGS, MD_TYPES, mdTags, mdOptions } from '../sources/mangadex.js';
import { getExtension, browse, seriesDetail, isEnabled, recordStatus, extHosts } from '../sources/extensions.js';
import { activeProxy, usingPublicProxy } from '../sources/web.js';
import { classify, ERROR_KINDS } from '../sources/engine.js';
import { enqueue, useDownloads } from '../downloads.js';
import { useDb, getAll, byIndex } from '../db.js';
import { followSeries } from '../online.js';
import { Icon, Cover, BgCover, Favicon, go } from '../ui.jsx';

const NoProxy = () => !activeProxy() && !usingPublicProxy() && (
  <p className="hint">Sin proxy: si el sitio bloquea CORS no va a cargar. Activá el proxy automático en <a href="#/settings">Ajustes</a>.</p>
);

/** Panel de diagnóstico de una carga de extensión. */
export function DiagPanel({ ext, diag, open, onToggle, what = 'Obras' }) {
  if (!diag) return null;
  const ok = diag.attempts?.some((a) => a.ok) || diag.render?.html || diag.via === 'catalogo JSON';
  const rows = [
    ['Extensión', `${ext.name} (${{ web: 'web', api: 'API JSON', catalog: 'catálogo JSON', manifest: `extensión JSON v${ext.version}` }[ext.type] || ext.type})`],
    (() => { const c = classify(diag); return ['Estado', c.label + (c.kind ? ` · ${ERROR_KINDS[c.kind]}` : '')]; })(),
    diag.ms != null && ['Tiempo de respuesta', `${diag.ms} ms`],
    diag.dropped > 0 && ['Descartados por validación', diag.dropped],
    ['URL', diag.url],
    diag.finalUrl && diag.finalUrl !== diag.url && ['Redirigida a', diag.finalUrl],
    ['Conexión', ok ? 'OK' : 'Falló'],
    diag.attempts?.length && ['Intentos', diag.attempts.map((a) => `${a.via}: ${a.ok ? `OK ${a.status} · ${Math.round((a.bytes || 0) / 1024)} KB` : a.error}${a.ms != null ? ` · ${a.ms} ms` : ''}`).join('\n')],
    ['Carga de la página', diag.via ? `${diag.via}${diag.render?.wait ? ` · ${diag.render.wait.reason} (${diag.render.wait.ms} ms)` : ''}` : diag.renderError || '—'],
    diag.bytes != null && ['HTML', `${Math.round(diag.bytes / 1024)} KB · ${diag.textChars} caracteres de texto · ${diag.scripts} scripts${diag.spaRoot ? ` · contenedor SPA ${diag.spaRoot}` : ''}`],
    diag.embedded?.length && ['Datos embebidos', diag.embedded.join(', ')],
    diag.strategy && ['Método de extracción', diag.strategy],
    [`${what} detectad${what.endsWith('s') && what !== 'Obras' ? 'os' : 'as'}`, diag.count ?? 0],
    diag.pages > 1 && ['Páginas de la lista', diag.pages],
    diag.errorSource && ['Origen del error', { site: 'la fuente (el sitio respondió con error)', backend: 'el backend (Render)', network: 'red / sin respuesta' }[diag.errorSource] + (diag.httpStatus ? ` · HTTP ${diag.httpStatus}` : '')],
    diag.renderSkipped && ['Renderizado', `no se intentó: ${diag.renderSkipped}`],
    diag.covers != null && ['Portadas detectadas', diag.covers],
    diag.links != null && ['Enlaces / imágenes en la página', `${(diag.rendered || diag).links} / ${(diag.rendered || diag).imgs}`],
    diag.staticCount != null && diag.renderCount != null && ['Estático vs renderizado', `${diag.staticCount} → ${diag.renderCount}`],
    diag.attempts?.some((a) => a.status >= 400) && ['Errores HTTP', diag.attempts.filter((a) => a.status >= 400).map((a) => `${a.via}: ${a.status}`).join(', ')],
    ['Errores JavaScript', diag.render ? (diag.render.jsErrors.length ? diag.render.jsErrors.slice(0, 5).join('\n') : 'ninguno') : 'no se ejecutó JavaScript (sin renderizador)'],
    diag.renderError && ['Error del renderizador', diag.renderError],
    diag.antibot && ['Protección antibots', 'detectada (no se evade)'],
  ].filter(Boolean);
  return (
    <div className={'diag' + (diag.count ? '' : ' bad')}>
      {diag.reasons?.length > 0 && <ul className="diag-reasons">{diag.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      <button className="btn sm" onClick={onToggle}>{open ? 'Ocultar diagnóstico' : 'Ver diagnóstico'}</button>
      {open && <dl className="diag-table">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>}
    </div>
  );
}

export function DiagBox({ startOpen = false, ...p }) {
  const [open, setOpen] = useState(startOpen);
  return <DiagPanel {...p} open={open} onToggle={() => setOpen(!open)} />;
}

/** Filtros del catálogo de MangaDex (se aplican en la API: género, estado, idioma, tipo, autor, orden). */
function MdFilters({ ext, f, setF, onApply }) {
  const [tags, setTags] = useState([]);
  useEffect(() => { mdTags().then(setTags).catch(() => {}); }, []);
  const o = mdOptions(ext);
  const ch = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="filters md-filters" onSubmit={(e) => { e.preventDefault(); onApply(); }}>
      <select value={f.order || 'latest'} onChange={ch('order')} aria-label="Orden"><option value="latest">Última actualización</option><option value="title">Alfabético</option><option value="popular">Más seguidos</option><option value="new">Recién agregados</option></select>
      <select value={f.lang || ''} onChange={ch('lang')} aria-label="Idioma"><option value="">Mis idiomas ({o.langs.join(', ')})</option><option value="any">Cualquier idioma</option>{Object.entries(MD_LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select value={f.type || ''} onChange={ch('type')} aria-label="Tipo"><option value="">Manga, manhwa y manhua</option>{Object.keys(MD_TYPES).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>
      <select value={f.status || ''} onChange={ch('status')} aria-label="Estado"><option value="">Cualquier estado</option><option value="ongoing">En curso</option><option value="completed">Finalizado</option><option value="hiatus">En pausa</option><option value="cancelled">Cancelado</option></select>
      <select value={f.tag || ''} onChange={ch('tag')} aria-label="Género"><option value="">Todos los géneros</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <input value={f.author || ''} onChange={ch('author')} placeholder="Autor o artista" aria-label="Autor" />
      <button className="btn sm">Aplicar</button>
    </form>
  );
}

/** Crédito obligatorio: MangaDex y los grupos de traducción. */
export function MdCredit({ d }) {
  if (!d?.ids?.mangadex) return null;
  return <p className="muted small md-credit">Datos e imágenes de <a href={d.link} target="_blank" rel="noreferrer">MangaDex</a>; las traducciones son de sus grupos (indicados en cada capítulo).{d.rating && d.contentRating !== 'safe' ? ` Clasificación: ${d.rating}.` : ''}</p>;
}
/** Selector de idioma de lectura de MangaDex (idiomas disponibles de la obra). */
export function MdLangPick({ ext, d, value, onChange }) {
  if (ext?.type !== 'mangadex' || !d?.languages?.length) return null;
  const o = mdOptions(ext);
  return (
    <label className="small md-lang">Idioma de los capítulos{' '}
      <select value={value || ''} onChange={(e) => onChange(e.target.value ? e.target.value.split(',') : null)}>
        <option value="">Mis idiomas ({o.langs.join(', ')})</option>
        {d.languages.map((l) => <option key={l} value={l}>{MD_LANGS[l] || l}</option>)}
      </select>
    </label>
  );
}
/** Idioma y grupo de un capítulo (cuando la fuente los informa). */
export const chOrigin = (c) => [c.language && (MD_LANGS[c.language] ? c.language : c.language), c.group].filter(Boolean).join(' · ');

export function ExtensionHome({ extId }) {
  const ext = getExtension(extId);
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('loading');
  const [err, setErr] = useState('');
  const [diag, setDiag] = useState(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({});
  const ctl = useRef(null);
  const md = ext?.type === 'mangadex';

  const load = async (opts = {}, append = false) => {
    setState('loading'); setErr('');
    ctl.current?.abort(); ctl.current = new AbortController(); // una búsqueda nueva cancela la anterior
    try {
      const r = await browse(ext, { ...opts, filters: md ? f : undefined, signal: ctl.current.signal });
      setItems((prev) => (append ? [...prev, ...r.items.filter((i) => !prev.some((p) => p.url === i.url))] : r.items));
      setNext(r.next);
      setPage(r.nextPage ? r.nextPage - 1 : 1);
      setDiag(r.diag);
      setState('ok');
      if (!append && !opts.query) recordStatus(ext, r.diag);
    } catch (e) { if (!e.aborted) { setErr(e.message); setState('error'); } }
  };
  useEffect(() => { ext && isEnabled(ext) && load(); return () => ctl.current?.abort(); }, [extId]); // eslint-disable-line
  if (!ext) return <div className="page"><p className="empty">Extensión no encontrada.</p></div>;
  if (!isEnabled(ext)) return <div className="page"><p className="empty">La extensión "{ext.name}" está desactivada. Activala en <a href="#/extensions">Extensiones</a>.</p></div>;

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
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={md ? 'Buscar por título, enlace o ID de MangaDex' : ext.searchUrl ? 'Buscar en el sitio' : 'Filtrar resultados'} />
      </form>
      {md && <MdFilters ext={ext} f={f} setF={setF} onApply={() => load(q ? { query: q } : {})} />}
      {md && <p className="muted small md-credit">Catálogo de <a href="https://mangadex.org" target="_blank" rel="noreferrer">MangaDex</a> (API oficial). Contenido +18 explícito excluido{mdOptions(ext).adult ? '' : '; erótico oculto (se activa en Extensiones)'}.</p>}
      <NoProxy />
      {state === 'error' && <p className="error">{err}</p>}
      {state !== 'loading' && <DiagPanel ext={ext} diag={diag} open={diagOpen} onToggle={() => setDiagOpen(!diagOpen)} />}
      <div className="grid">
        {items.map((it) => (
          <a key={it.url} className="card" href={`#/ext/${ext.id}/s/${encodeURIComponent(it.url)}`} onClick={() => sessionStorage.setItem('mh.pick', JSON.stringify(it))}>
            <Cover src={it.cover} title={it.title} referer={ext.url} hosts={extHosts(ext)}>{it.status && <span className="kind">{it.status}</span>}{it.rating && it.contentRating !== 'safe' && <span className="kind rating">{it.rating}</span>}</Cover>
            <span className="card-title">{it.title}</span>
            {it.author && <span className="muted small card-sub">{it.author}</span>}
          </a>
        ))}
      </div>
      {state === 'loading' && <p className="muted center">Cargando…</p>}
      {next && state === 'ok' && <button className="btn wide" onClick={() => load({ url: next, page: page + 1, query: q || undefined }, true)}>Cargar más</button>}
    </div>
  );
}

const fmtDate = (c) => (c.date ? new Date(c.date + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : c.dateText || '');
const norm = (u = '') => u.replace(/\/+(?=#|$)/, '');

export function RemoteSeries({ extId, url }) {
  const ext = getExtension(extId);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [langs, setLangs] = useState(null);
  const jobs = useDownloads();
  // Estado local de esta obra: si ya está en la biblioteca, sus capítulos (descargados o en línea) y el progreso.
  const lib = useDb(async () => {
    const series = (await getAll('series')).find((s) => s.sourceUrl === url || s.sources?.some((x) => x.url === url)) || null;
    const chapters = series ? await byIndex('chapters', 'seriesId', series.id) : [];
    const progress = series ? await byIndex('progress', 'seriesId', series.id) : [];
    return { series, byUrl: new Map(chapters.map((c) => [norm(c.url), c])), prog: new Map(progress.map((p) => [p.chapterId, p])) };
  }, [url]);

  const loadDetail = () => {
    let fb = {};
    try { fb = JSON.parse(sessionStorage.getItem('mh.pick')) || {}; } catch {}
    if (fb.url !== url) fb = {};
    setErr(''); setD(null);
    ext && seriesDetail(ext, url, fb, langs ? { langs } : {}).then(setD).catch((e) => setErr(e.message));
  };
  useEffect(loadDetail, [extId, url, langs?.join()]); // eslint-disable-line
  if (!ext) return <div className="page"><p className="empty">Extensión no encontrada.</p></div>;

  const queued = new Set(jobs.filter((j) => j.status !== 'error').map((j) => j.url));
  const job = (c, seriesId) => ({ url: c.url, title: c.title, number: c.number, images: c.images, series: lib?.series?.title || d.title, cover: d.cover, sourceUrl: url.startsWith('http') ? url : undefined, extId: ext.id, seriesId });
  // Descargar: la obra queda en la biblioteca vinculada a esta fuente (así no depende del título).
  const download = async (list) => {
    try { const { series } = await followSeries(ext, url, d, { seriesId: lib?.series?.id }); enqueue(list.map((c) => job(c, series.id))); }
    catch (e) { setErr(e.message); }
  };
  const local = (c) => lib?.byUrl.get(norm(c.url));
  const downloaded = (c) => { const l = local(c); return l && !l.online; };
  const pending = d ? d.chapters.filter((c) => !downloaded(c) && !queued.has(c.url)) : [];
  const last = lib?.series?.lastChapterId && [...(lib.byUrl.values())].find((c) => c.id === lib.series.lastChapterId);

  /** Abre el lector: guarda la obra y la lista de capítulos (sin imágenes) y va al capítulo. */
  const read = async (c) => {
    setBusy(c.url);
    try {
      const { idByUrl } = await followSeries(ext, url, d, { seriesId: lib?.series?.id });
      go(`/r/${idByUrl.get(norm(c.url))}`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };
  const resume = last && d?.chapters.find((c) => norm(c.url) === norm(last.url));
  const first = d?.chapters[0];

  return (
    <div className="page">
      <header className="top">
        <button className="icon-btn" onClick={() => history.back()} aria-label="Volver"><Icon n="back" /></button>
        <div className="actions">
          <button className="icon-btn" onClick={loadDetail} title="Recargar"><Icon n="refresh" /></button>
          <a className="icon-btn" href={url.startsWith('http') ? url : ext.url} target="_blank" rel="noreferrer" title="Abrir en el sitio"><Icon n="globe" /></a>
        </div>
      </header>
      <NoProxy />
      {err && <p className="error">{err}</p>}
      {!d && !err && <p className="muted center">Cargando ficha y capítulos…</p>}
      {d && (
        <>
          <div className="hero">
            <BgCover src={d.cover} referer={ext.url} hosts={extHosts(ext)} />
            <Cover src={d.cover} title={d.title} referer={ext.url} hosts={extHosts(ext)} />
            <div>
              <h1>{d.title}</h1>
              <div className="meta-row muted">
                {d.author && <span><b>Autor:</b> {d.author}</span>}
                {d.artist && d.artist !== d.author && <span><b>Arte:</b> {d.artist}</span>}
                {d.status && <span className={'status-chip' + (d.status === 'Finalizado' ? ' fin' : '')}>{d.status}</span>}
                <span>{d.chapters.length} capítulos · {ext.name}</span>
              </div>
              {d.genres?.length > 0 && <div className="genres">{d.genres.map((g) => <span key={g}>{g}</span>)}</div>}
              {d.altTitles?.length > 0 && <p className="muted small alt-titles">También: {d.altTitles.slice(0, 4).join(' · ')}</p>}
              {d.description && <p className="desc">{d.description}</p>}
              <MdCredit d={d} />
              <div className="row">
                {first && <button className="btn primary" disabled={!!busy} onClick={() => read(resume || first)}><Icon n="book" size={16} /> {resume ? `Continuar: ${resume.title}` : 'Comenzar a leer'}</button>}
                {pending.length > 0 && <button className="btn" onClick={() => download(pending)}><Icon n="down" size={16} /> Descargar {pending.length === d.chapters.length ? 'todo' : `${pending.length} faltantes`}</button>}
                {lib?.series && <button className="btn" onClick={() => go(`/s/${lib.series.id}`)}><Icon n="book" size={16} /> En biblioteca</button>}
              </div>
            </div>
          </div>
          <h3 className="sec">Capítulos {d.chapters.length > 0 && <span className="muted small">({d.chapters.length})</span>}</h3>
          <MdLangPick ext={ext} d={d} value={langs?.join(',')} onChange={setLangs} />
          {!d.chapters.length && <DiagBox ext={ext} diag={d.diag} what="Capítulos" startOpen />}
          <ul className="chapters">
            {[...d.chapters].reverse().map((c) => {
              const l = local(c), p = l && lib.prog.get(l.id), have = downloaded(c), q = queued.has(c.url);
              const state = [chOrigin(c), fmtDate(c), have ? 'descargado' : q ? 'en cola' : '', p?.done ? 'leído' : p ? `pág. ${p.page + 1}/${p.total}` : ''].filter(Boolean).join(' · ');
              return (
                <li key={c.url} className={(p?.done ? 'read' : '') + (l && l.id === lib.series?.lastChapterId ? ' reading' : '')}>
                  <button className="ch-btn" onClick={() => read(c)} disabled={!!busy} title="Leer">
                    <span className="ch-title">{busy === c.url ? 'Abriendo…' : c.title}</span>
                    {state && <span className="muted small">{state}</span>}
                  </button>
                  {!have && !q && <button className="icon-btn" title="Descargar" onClick={() => download([c])}><Icon n="down" /></button>}
                  {have && <Icon n="check" />}
                </li>
              );
            })}
          </ul>
          {d.chapters.length > 0 && d.diag && <DiagBox ext={ext} diag={d.diag} what="Capítulos" />}
        </>
      )}
    </div>
  );
}
