// Ficha unificada: una obra con todas sus fuentes. Los capítulos se muestran por fuente (selector)
// y nunca se mezclan entre fuentes.
import { useEffect, useState } from 'react';
import { getExtension, seriesDetail, isEnabled, extHosts } from '../sources/extensions.js';
import { classify } from '../sources/engine.js';
import { enqueue, useDownloads } from '../downloads.js';
import { useDb, getAll, byIndex } from '../db.js';
import { followSeries, normUrl } from '../online.js';
import { linkWorks, splitWorks } from '../unify.js';
import { updateSeries } from '../library.js';
import { Icon, Cover, BgCover, Favicon, go } from '../ui.jsx';
import { DiagBox, MdCredit, MdLangPick, chOrigin, OfficialLinks } from './Extension.jsx';

const fmtDate = (c) => (c.date ? new Date(c.date + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : c.dateText || '');
const readWork = (k) => { try { return JSON.parse(sessionStorage.getItem('mh.work:' + k)); } catch { return null; } };

export default function WorkView({ workKey }) {
  const [work, setWork] = useState(() => readWork(workKey));
  const [det, setDet] = useState({}); // key → {state, d, label}
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [langs, setLangs] = useState(null); // idioma de lectura elegido (fuentes que lo permiten, p. ej. MangaDex)
  const jobs = useDownloads();
  const srcs = (work?.sources || []).map((s) => ({ ...s, ext: getExtension(s.extId) })).filter((s) => s.ext);

  const lib = useDb(async () => {
    const urls = new Set(srcs.map((s) => s.item.url));
    const series = (await getAll('series')).find((s) => urls.has(s.sourceUrl) || s.sources?.some((x) => urls.has(x.url))) || null;
    const chapters = series ? await byIndex('chapters', 'seriesId', series.id) : [];
    const progress = series ? await byIndex('progress', 'seriesId', series.id) : [];
    return { series, byUrl: new Map(chapters.map((c) => [normUrl(c.url), c])), prog: new Map(progress.map((p) => [p.chapterId, p])) };
  }, [workKey, work?.sources?.length]);

  const load = () => {
    setDet(Object.fromEntries(srcs.map((s) => [s.key, { state: 'loading' }])));
    srcs.forEach((s) => {
      if (!isEnabled(s.ext)) return setDet((p) => ({ ...p, [s.key]: { state: 'error', label: 'Desactivada' } }));
      seriesDetail(s.ext, s.item.url, s.item, s.ext.type === 'mangadex' && langs ? { langs } : {})
        .then((d) => { const c = classify(d.diag); setDet((p) => ({ ...p, [s.key]: d.chapters.length ? { state: 'ok', d } : d.metadataOnly && !d.diag?.httpError ? { state: 'meta', d, label: 'solo ficha (no aloja capítulos)' } : { state: 'error', d, label: c.state === 'ok' || c.state === 'extraction' ? 'sin capítulos' : c.label } })); })
        .catch((e) => setDet((p) => ({ ...p, [s.key]: { state: 'error', label: e.message } })));
    });
  };
  useEffect(load, [workKey, work?.sources?.length, langs?.join()]); // eslint-disable-line
  // Fuente elegida: la última usada en la biblioteca o, si no, la primera de la lista que responda
  // (en orden de la lista, no la que conteste antes). Lo que elija el usuario no se cambia.
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (picked && det[sel]?.state === 'ok') return;
    const ok = (s) => det[s.key]?.state === 'ok';
    const act = lib?.series?.activeSource && srcs.find((s) => s.extId === lib.series.activeSource);
    const pending = srcs.find((s) => !det[s.key] || det[s.key].state === 'loading');
    const first = (act && ok(act) && act) || srcs.find(ok);
    if (first && (!sel || !ok(srcs.find((s) => s.key === sel) || {}) || !pending || srcs.indexOf(first) < srcs.findIndex((s) => s.key === sel))) setSel(first.key);
  }, [det, lib]); // eslint-disable-line
  const choose = (k) => { setPicked(true); setSel(k); };

  if (!work) return <div className="page"><p className="empty">Esta ficha ya no está en memoria. Buscala de nuevo en <a href="#/browse">Explorar</a> o abrila desde la <a href="#/">Biblioteca</a>.</p></div>;

  const okd = srcs.map((s) => det[s.key]?.d).filter(Boolean);
  // Portada: se recuerda de qué fuente vino para aplicarle sus dominios autorizados.
  const [coverUrl, coverExt] = [...srcs.map((s) => [det[s.key]?.d?.cover, s.ext]), [work.cover, work.coverExt || srcs[0]?.ext]].find(([v]) => v) || [];
  const pick = (f) => [...okd.map((d) => d[f]), work[f]].find((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
  const desc = [work.description, ...okd.map((d) => d.description)].filter(Boolean).sort((a, b) => b.length - a.length)[0];
  const genres = [...new Set([...(work.genres || []), ...okd.flatMap((d) => d.genres || [])])];
  const cur = srcs.find((s) => s.key === sel);
  const d = cur && det[cur.key]?.d;
  const queued = new Set(jobs.filter((j) => j.status !== 'error').map((j) => j.url));
  const local = (c) => lib?.byUrl.get(normUrl(c.url));
  const downloaded = (c) => { const l = local(c); return l && !l.online; };

  /** Guarda la obra con todas las fuentes que respondieron (cada una con sus propios capítulos). */
  const follow = async () => {
    let seriesId = lib?.series?.id, ids = new Map();
    const order = [cur, ...srcs.filter((s) => s !== cur)].filter((s) => s && det[s.key]?.state === 'ok');
    for (const s of order) {
      const r = await followSeries(s.ext, s.item.url, { ...det[s.key].d, title: seriesId ? det[s.key].d.title : work.title, altTitles: [...(work.altTitles || []), ...(s.item.altTitles || [])] }, { seriesId });
      seriesId = r.series.id; r.idByUrl.forEach((v, k) => ids.set(k, v));
    }
    return { seriesId, ids };
  };
  const read = async (c) => {
    setBusy(c.url); setErr('');
    try { const { ids, seriesId } = await follow(); await updateSeries(seriesId, { activeSource: cur.extId }); go(`/r/${ids.get(normUrl(c.url))}`); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const download = async (list) => {
    try { const { seriesId } = await follow(); enqueue(list.map((c) => ({ url: c.url, title: c.title, number: c.number, images: c.images, series: work.title, cover: d.cover, extId: cur.extId, seriesId, sourceUrl: /^https?:/.test(cur.item.url) ? cur.item.url : undefined }))); }
    catch (e) { setErr(e.message); }
  };
  const last = lib?.series?.lastChapterId && [...lib.byUrl.values()].find((c) => c.id === lib.series.lastChapterId);
  const resume = last && d?.chapters.find((c) => normUrl(c.url) === normUrl(last.url));
  const pending = d ? d.chapters.filter((c) => !downloaded(c) && !queued.has(c.url)) : [];

  const merge = (m) => {
    linkWorks(m.mine, m.key);
    const w = { ...work, sources: [...work.sources, { extId: m.extId, item: m.item, key: m.key }], maybe: work.maybe.filter((x) => x.key !== m.key) };
    sessionStorage.setItem('mh.work:' + workKey, JSON.stringify(w)); setWork(w);
  };
  const separate = (m) => {
    splitWorks(m.mine, m.key);
    const w = { ...work, maybe: work.maybe.filter((x) => x.key !== m.key) };
    sessionStorage.setItem('mh.work:' + workKey, JSON.stringify(w)); setWork(w);
  };
  const detach = (s) => {
    work.sources.filter((o) => o.key !== s.key).forEach((o) => splitWorks(o.key, s.key));
    const w = { ...work, sources: work.sources.filter((o) => o.key !== s.key) };
    sessionStorage.setItem('mh.work:' + workKey, JSON.stringify(w)); setWork(w);
  };

  return (
    <div className="page">
      <header className="top">
        <button className="icon-btn" onClick={() => history.back()} aria-label="Volver"><Icon n="back" /></button>
        <div className="actions"><button className="icon-btn" onClick={load} title="Recargar"><Icon n="refresh" /></button></div>
      </header>
      {err && <p className="error">{err}</p>}
      <div className="hero">
        <BgCover src={coverUrl} referer={coverExt?.url} hosts={extHosts(coverExt)} />
        <Cover src={coverUrl} title={work.title} referer={coverExt?.url} hosts={extHosts(coverExt)} />
        <div>
          <h1>{work.title}</h1>
          {work.altTitles?.length > 0 && <p className="muted small alt-titles">También: {work.altTitles.slice(0, 4).join(' · ')}</p>}
          <div className="meta-row muted">
            {pick('author') && <span><b>Autor:</b> {pick('author')}</span>}
            {pick('artist') && pick('artist') !== pick('author') && <span><b>Arte:</b> {pick('artist')}</span>}
            {pick('status') && <span className={'status-chip' + (pick('status') === 'Finalizado' ? ' fin' : '')}>{pick('status')}</span>}
          </div>
          {genres.length > 0 && <div className="genres">{genres.map((g) => <span key={g}>{g}</span>)}</div>}
          {desc && <p className="desc">{desc}</p>}
          <MdCredit d={okd.find((x) => x.ids?.mangadex)} />
          <OfficialLinks d={{ officialLinks: [...okd, work].flatMap((x) => x.officialLinks || []).filter((l, i, a) => a.findIndex((y) => y.url === l.url) === i) }} />
          <div className="row">
            {d?.chapters[0] && <button className="btn primary" disabled={!!busy} onClick={() => read(resume || d.chapters[0])}><Icon n="book" size={16} /> {resume ? `Continuar: ${resume.title}` : 'Comenzar a leer'}</button>}
            {pending.length > 0 && <button className="btn" onClick={() => download(pending)}><Icon n="down" size={16} /> Descargar {pending.length === d.chapters.length ? 'todo' : `${pending.length} faltantes`}</button>}
            {lib?.series ? <button className="btn" onClick={() => go(`/s/${lib.series.id}`)}><Icon n="book" size={16} /> En biblioteca</button>
              : okd.length > 0 && <button className="btn" onClick={() => follow().then(({ seriesId }) => go(`/s/${seriesId}`)).catch((e) => setErr(e.message))}><Icon n="plus" size={16} /> Agregar a biblioteca</button>}
          </div>
        </div>
      </div>

      <h3 className="sec">Fuentes <span className="muted small">({srcs.length})</span></h3>
      <ul className="src-list">
        {srcs.map((s) => {
          const x = det[s.key] || {};
          return (
            <li key={s.key} className={(s.key === sel ? 'on ' : '') + (x.state || '')}>
              <button className="src-pick" disabled={x.state !== 'ok'} onClick={() => choose(s.key)}>
                <Favicon ext={s.ext} /><b>{s.ext.name}</b>
                <span className="muted small">{x.state === 'loading' ? 'consultando…' : x.state === 'ok' ? `${x.d.chapters.length} capítulos${x.d.chapters.at(-1)?.number != null ? ` · último ${x.d.chapters.at(-1).number}` : ''}` : x.label}</span>
              </button>
              {x.state === 'meta' && x.d.link && <a className="btn sm" href={x.d.link} target="_blank" rel="noreferrer noopener">Ver ficha</a>}
              {srcs.length > 1 && <button className="btn sm" title="Esta ficha no es la misma obra" onClick={() => detach(s)}>Separar</button>}
            </li>
          );
        })}
      </ul>
      {work.maybe?.length > 0 && (
        <div className="maybe">
          <p className="small"><b>Posibles coincidencias</b> (no se unen solas porque podrían ser obras distintas):</p>
          {work.maybe.map((m) => (
            <div key={m.key} className="row small">
              <span className="grow">{m.title} · {getExtension(m.extId)?.name || 'fuente'}</span>
              <button className="btn sm" onClick={() => merge(m)}>Es la misma obra</button>
              <button className="btn sm" onClick={() => separate(m)}>Son distintas</button>
            </div>
          ))}
        </div>
      )}

      {cur && d && (
        <>
          <h3 className="sec">Capítulos en {cur.ext.name} <span className="muted small">({d.chapters.length})</span></h3>
          <MdLangPick ext={cur.ext} d={d} value={langs?.join(',')} onChange={setLangs} />
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
        </>
      )}
      {srcs.filter((s) => det[s.key]?.state === 'error' && det[s.key].d?.diag).map((s) => (
        <div key={s.key}><h3 className="sec small">{s.ext.name}: {det[s.key].label}</h3><DiagBox ext={s.ext} diag={det[s.key].d.diag} what="Capítulos" /></div>
      ))}
    </div>
  );
}
