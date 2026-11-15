import { useCallback, useEffect, useRef, useState } from 'react';
import { get, byIndex } from '../db.js';
import { byNumber, loadPages, saveProgress, updateSeries } from '../library.js';
import { translatePage, clearTranslations, fitFont } from '../translate.js';
import { useSettings } from '../settings.js';
import { Icon } from '../ui.jsx';
import { activeProxy, proxied, fetchVia } from '../sources/web.js';
import { sourceKey, seriesSources, equivalent } from '../online.js';
import { getExtension } from '../sources/extensions.js';
import { pageBlob } from '../imgload.js';

function PageErr({ i, why, onRetry }) {
  return (
    <div className="pg-err" data-i={i} onClick={(e) => e.stopPropagation()}>
      <b>No se pudo cargar la página {i + 1}</b>
      <span className="muted small">{why}</span>
      <button className="btn sm" onClick={onRetry}>Reintentar</button>
    </div>
  );
}

/**
 * Página de una extensión JSON (con dominios autorizados): nunca se pone la URL remota en un <img>,
 * porque el navegador seguiría redirecciones a cualquier dominio. Se pide con fetchVia estricto
 * (proxy propio con "hosts" desde el primer intento; sin backend, acceso directo sin seguir
 * redirecciones) y se muestra como Blob. Carga diferida: se pide al acercarse a la pantalla.
 */
function StrictPageImg({ src, i, referer, hosts, eager, className, onLoad, onError }) {
  const ref = useRef(null);
  const [want, setWant] = useState(!!eager);
  const [url, setUrl] = useState(null);
  const [why, setWhy] = useState('');
  const [tries, setTries] = useState(0);
  const [h, setH] = useState(0); // alto conservado al liberar la página (el scroll no salta)
  useEffect(() => { if (eager) setWant(true); }, [eager]);
  // Capítulos largos: una página ya cargada que queda lejos (más de ~4 pantallas) se libera (Object URL
  // y Blob) y vuelve a pedirse al acercarse (caché del navegador). La memoria no crece con la sesión.
  useEffect(() => {
    if (!url || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver((es) => { if (es.every((e) => !e.isIntersecting) && el.offsetHeight) { setH(el.offsetHeight); setWant(false); } }, { rootMargin: '400% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [url]);
  useEffect(() => {
    if (want || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setWant(true); }, { rootMargin: '150% 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [want, src, url]); // url: al liberar la página se observa el nuevo marcador (no la imagen anterior)
  useEffect(() => {
    if (!want) { setUrl(null); return; }
    let alive = true, obj = null;
    setUrl(null); setWhy('');
    pageBlob(src, referer, hosts, { force: tries > 0 }).then(
      (b) => { if (!alive) return; obj = URL.createObjectURL(b); setUrl(obj); },
      (e) => { if (!alive) return; setWhy(e.message); onError?.(); },
    );
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); }; // el Object URL se libera al cambiar o salir
  }, [want, src, tries]); // eslint-disable-line
  if (why) return <PageErr i={i} why={why} onRetry={() => { setWhy(''); setTries((t) => t + 1); }} />;
  if (!url) return <div ref={ref} className={(className || 'pg') + ' pg-wait'} style={h ? { height: h, minHeight: 0 } : undefined} data-i={i} aria-label={`Cargando página ${i + 1}`} />;
  return <img ref={ref} className={className} src={url} alt={`Página ${i + 1}`} decoding="async" onLoad={onLoad} onError={() => { setWhy('La imagen recibida está dañada o no es una imagen.'); onError?.(); }} />;
}

/** Página del lector: extensiones JSON en línea → modo estricto; el resto, como siempre. */
function PageImg(props) {
  return props.online && props.hosts?.length ? <StrictPageImg {...props} /> : <PlainPageImg {...props} />;
}

/**
 * Página de un capítulo descargado o de una extensión HTML. En línea intenta primero la imagen
 * directa (sin gastar el backend); si falla, la pide por el proxy. Si no carga, "Reintentar".
 */
function PlainPageImg({ src, i, online, referer, hosts, eager, className, onLoad, onError }) {
  const [url, setUrl] = useState(src);
  const [stage, setStage] = useState(0); // 0 directa · 1 proxy · 2 error
  const [why, setWhy] = useState('');
  const blob = useRef(null);
  const drop = () => { if (blob.current) { URL.revokeObjectURL(blob.current); blob.current = null; } };
  useEffect(() => { drop(); setUrl(src); setStage(0); setWhy(''); return drop; }, [src]);
  const fail = async () => {
    if (online && stage === 0) {
      if (activeProxy()) { setStage(1); setUrl(proxied(src, referer, hosts)); return; }
      try { const b = await fetchVia(src, 'blob', referer, undefined, { hosts }); drop(); blob.current = URL.createObjectURL(b); setStage(1); setUrl(blob.current); return; }
      catch (e) { setWhy(e.message); }
    }
    setStage(2); onError?.();
  };
  if (stage === 2) {
    let host = ''; try { host = new URL(src).host; } catch {}
    return (
      <div className="pg-err" data-i={i} onClick={(e) => e.stopPropagation()}>
        <b>No se pudo cargar la página {i + 1}</b>
        <span className="muted small">{why || (online ? `La imagen no respondió (${host}).` : 'La imagen guardada está dañada.')}</span>
        <button className="btn sm" onClick={() => { drop(); setWhy(''); setStage(0); setUrl(src); }}>Reintentar</button>
      </div>
    );
  }
  return <img className={className} src={url} alt={`Página ${i + 1}`} loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onLoad={onLoad} onError={fail} />;
}

function useWakeLock(on) {
  useEffect(() => {
    if (!on || !navigator.wakeLock) return;
    let lock;
    const req = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    const vis = () => document.visibilityState === 'visible' && req();
    req();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release().catch(() => {}); };
  }, [on]);
}

/** Texto traducido superpuesto sobre la página. */
function TrOverlay({ data }) {
  const ref = useRef();
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / data.w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);
  return (
    <div className="tr-layer" ref={ref}>
      {scale > 0 && data.items.map((it, k) => {
        const px = 0.08 * it.w, py = 0.08 * it.h;
        return (
          <div key={k} className="tr-box" title={it.text} style={{
            left: `${((it.x - px) / data.w) * 100}%`, top: `${((it.y - py) / data.h) * 100}%`,
            width: `${((it.w + 2 * px) / data.w) * 100}%`, minHeight: `${((it.h + 2 * py) / data.h) * 100}%`,
            fontSize: fitFont(it) * scale + 'px',
          }}>{it.tr}</div>
        );
      })}
    </div>
  );
}

function Vertical({ urls, start, gap, maxWidth, onPage, onTap, footer, jumpRef, tr, online, referer, hosts }) {
  const refs = useRef([]);
  const ready = useRef(start === 0);
  const loaded = useRef(0);

  useEffect(() => {
    window.scrollTo(0, 0);
    const io = new IntersectionObserver((es) => {
      if (!ready.current) return;
      for (const e of es) if (e.isIntersecting) onPage(+e.target.dataset.i);
    }, { rootMargin: '-50% 0px -50% 0px' });
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [urls, onPage]);

  jumpRef.current = (i) => refs.current[i]?.scrollIntoView({ block: 'start' });

  const settle = (i, ok) => (e) => {
    if (ok && e) e.currentTarget.classList.add('ok');
    if (!ready.current && i <= start && ++loaded.current > start) {
      refs.current[start]?.scrollIntoView({ block: 'start' });
      ready.current = true;
    }
  };
  return (
    <div className="vertical" style={{ '--gap': gap + 'px', '--mw': maxWidth ? maxWidth + 'px' : 'none' }} onClick={onTap}>
      {urls.map((u, i) => (
        <div key={i} ref={(el) => (refs.current[i] = el)} data-i={i} className="pgw">
          <PageImg className="pg" src={u} i={i} online={online} referer={referer} hosts={hosts} eager={i <= start + 2} onLoad={settle(i, true)} onError={() => settle(i, false)()} />
          {tr?.[i]?.items && <TrOverlay data={tr[i]} />}
        </div>
      ))}
      <div ref={(el) => (refs.current[urls.length] = el)} data-i={urls.length - 1}>{footer}</div>
    </div>
  );
}

function Paged({ urls, cur, setCur, dir, fit, onTap, onEnd, tr, online, referer, hosts }) {
  const touch = useRef(null);
  const strict = online && hosts?.length > 0;
  // Siguiente página precargada por el mismo camino verificado (no con <link preload>, que seguiría redirecciones).
  useEffect(() => { if (strict && urls[cur + 1]) pageBlob(urls[cur + 1], referer, hosts).catch(() => {}); }, [strict, cur, urls]); // eslint-disable-line
  const go = useCallback((d) => {
    const n = cur + d;
    if (n < 0) return;
    if (n >= urls.length) return onEnd();
    setCur(n);
    window.scrollTo(0, 0);
  }, [cur, urls.length, setCur, onEnd]);
  const flip = (d) => (dir === 'rtl' ? -d : d);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowRight') go(flip(1));
      else if (e.key === 'ArrowLeft') go(flip(-1));
      else if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });
  const click = (e) => {
    const x = e.clientX / innerWidth;
    const d = x < 0.33 ? -1 : x > 0.67 ? 1 : 0;
    d ? go(flip(d)) : onTap();
  };
  return (
    <div className={'paged fit-' + fit} onClick={click}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 60) go(flip(dx < 0 ? 1 : -1)); }}>
      <div className="pgw-paged">
        <PageImg src={urls[cur]} i={cur} online={online} referer={referer} hosts={hosts} eager />
        {tr?.[cur]?.items && <TrOverlay data={tr[cur]} />}
      </div>
      {urls[cur + 1] && !strict && <link rel="preload" as="image" href={urls[cur + 1]} />}
    </div>
  );
}

export default function Reader({ chapterId }) {
  const [s, setS] = useSettings();
  const [st, setSt] = useState(null);
  const [cur, setCur] = useState(0);
  const [ui, setUi] = useState(true);
  const [end, setEnd] = useState(false);
  const jump = useRef(() => {});
  const [trOn, setTrOn] = useState(false);
  const [tr, setTr] = useState({});
  const [trMsg, setTrMsg] = useState('');
  const curRef = useRef(0);
  curRef.current = cur;
  const [reload, setReload] = useState(0);
  useWakeLock(s.keepAwake);

  useEffect(() => {
    let alive = true, dispose;
    (async () => {
      const chapter = await get('chapters', chapterId);
      if (!chapter) return setSt({ missing: true });
      const [series, list, prog] = await Promise.all([get('series', chapter.seriesId), byIndex('chapters', 'seriesId', chapter.seriesId), get('progress', chapterId)]);
      list.sort(byNumber);
      if (!chapter.pageCount && !chapter.remotePages) setSt({ chapter, series, list, loading: true });
      let pages;
      try { pages = await loadPages(chapter, { force: reload > 0 }); }
      catch (e) { if (alive) setSt({ chapter, series, list, error: e }); return; }
      dispose = pages.dispose;
      if (!alive) return dispose();
      if (!pages.urls.length) return setSt({ chapter, series, list, error: new Error('El capítulo no tiene páginas.') });
      const start = prog && !prog.done ? Math.min(prog.page, pages.urls.length - 1) : 0;
      setCur(start);
      setEnd(false);
      setSt({ chapter, series, list, urls: pages.urls, start, online: !!pages.online, referer: pages.referer, hosts: pages.hosts });
      saveProgress(chapter, start, pages.urls.length); // recuerda el último capítulo abierto al instante
      setTr({}); setTrMsg('');
      setTrOn(!!series?.translate);
    })();
    return () => { alive = false; dispose?.(); };
  }, [chapterId, reload]);

  const lastPos = useRef(null);
  useEffect(() => {
    if (!st?.urls) return;
    lastPos.current = { chapter: st.chapter, page: cur, total: st.urls.length };
    const t = setTimeout(() => { saveProgress(st.chapter, cur, st.urls.length); lastPos.current = null; }, 350);
    return () => clearTimeout(t);
  }, [cur, st]);
  // Al salir del lector (o cambiar de capítulo) se guarda la última posición aunque no haya pasado la espera.
  useEffect(() => () => { const l = lastPos.current; if (l) saveProgress(l.chapter, l.page, l.total); }, []);

  // Traducción: procesa primero la página actual y luego las más cercanas
  useEffect(() => {
    if (!trOn || !st?.urls) return;
    let alive = true;
    (async () => {
      const done = {};
      const n = st.urls.length;
      for (let k = 0; k < n && alive; k++) {
        let i = -1;
        for (let d = 0; d < n && i < 0; d++) {
          for (const j of [curRef.current + d, curRef.current - d]) if (j >= 0 && j < n && !(j in done)) { i = j; break; }
        }
        if (i < 0) break;
        setTrMsg(`Traduciendo ${k + 1}/${n}…`);
        // Páginas en línea: el OCR necesita leer la imagen. Extensiones JSON: mismo camino verificado
        // que el lector; HTML: fetchVia de siempre (una sola vez por el proxy, sin anidarlo).
        const u = st.urls[i];
        const src = !st.online ? u : st.hosts?.length ? () => pageBlob(u, st.referer, st.hosts) : () => fetchVia(u, 'blob', st.referer);
        try { done[i] = await translatePage(st.chapter.id, i, src); }
        catch (e) { done[i] = { error: e.message }; if (/límite|limit|quota|fetch/i.test(e.message)) { setTrMsg('Error: ' + e.message); alive && setTr({ ...done }); return; } }
        if (alive) setTr({ ...done });
      }
      alive && setTrMsg('');
    })();
    return () => { alive = false; };
  }, [trOn, st]);

  const toggleTr = () => {
    const v = !trOn;
    setTrOn(v);
    if (!v) { setTr({}); setTrMsg(''); }
    if (st?.series) updateSeries(st.series.id, { translate: v });
  };

  const onPage = useCallback((i) => setCur(i), []);
  const toggle = useCallback(() => setUi((v) => !v), []);

  if (!st) return <div className="reader dark" />;
  if (st.missing) return <div className="page"><p className="empty">Capítulo no encontrado. <a href="#/">Volver</a></p></div>;

  // Anterior/siguiente dentro de la misma fuente: nunca se mezclan capítulos de fuentes distintas.
  const mySrc = sourceKey(st.chapter, st.series);
  const same = st.list.filter((c) => sourceKey(c, st.series) === mySrc);
  const idx = same.findIndex((c) => c.id === chapterId);
  const prev = same[idx - 1], next = same[idx + 1];
  const srcKeys = [...new Set(st.list.map((c) => sourceKey(c, st.series)))];
  const srcName = (k) => k === 'local' ? 'Local' : getExtension(k)?.name || seriesSources(st.series).find((x) => x.extId === k)?.extName || 'Fuente eliminada';
  const switchSource = (k) => {
    if (k === mySrc) return;
    const r = equivalent(st.chapter, st.list, st.series, k);
    if (!r) return;
    if (!r.exact && !confirm(`No hay una equivalencia segura en ${srcName(k)}: ${r.reason}.\n\n¿Abrir "${r.chapter.title}"?`)) return;
    updateSeries(st.series.id, { activeSource: k });
    location.replace(`#/r/${r.chapter.id}`);
  };
  const srcSelect = srcKeys.length > 1 && (
    <select className="src-select" value={mySrc} onChange={(e) => switchSource(e.target.value)} title="Fuente de lectura" aria-label="Fuente de lectura">
      {srcKeys.map((k) => <option key={k} value={k}>{srcName(k)}</option>)}
    </select>
  );
  const open = (c) => c && location.replace(`#/r/${c.id}`);
  const back = () => location.replace(`#/s/${st.chapter.seriesId}`);
  if (st.loading || st.error) {
    const reasons = st.error?.diag?.reasons || [];
    return (
      <div className="reader">
        <header className="r-top">
          <button className="icon-btn" onClick={back} aria-label="Volver"><Icon n="back" /></button>
          <div className="r-title"><b>{st.series?.title}</b><span>{st.chapter.title}{st.chapter.group ? ` · ${st.chapter.group}` : ""}{/^md:/.test(st.chapter.url || "") ? " · MangaDex" : ""}</span></div>
          {srcSelect}
        </header>
        <div className="r-state">
          {st.loading ? <p className="muted">Cargando el capítulo desde la fuente…</p> : (
            <>
              <p className="error">No se pudo abrir el capítulo: {st.error.message}</p>
              {reasons.map((r, k) => <p key={k} className="muted small">{r}</p>)}
              <div className="row">
                <button className="btn primary" onClick={() => setReload((n) => n + 1)}>Reintentar</button>
                {/^https?:/.test(st.chapter.url || '') && <a className="btn" href={st.chapter.url} target="_blank" rel="noreferrer">Abrir en el sitio</a>}
              </div>
            </>
          )}
          <div className="row">
            <button className="btn" disabled={!prev} onClick={() => open(prev)}>Anterior</button>
            <button className="btn" disabled={!next} onClick={() => open(next)}>Siguiente</button>
          </div>
        </div>
      </div>
    );
  }
  const n = st.urls.length;
  const endBox = (
    <div className="chapter-end">
      <p>Fin de <b>{st.chapter.title}</b></p>
      {/^md:/.test(st.chapter.url || "") && <p className="muted small">Traducción: {st.chapter.group || "sin grupo"} · vía <a href="https://mangadex.org" target="_blank" rel="noreferrer">MangaDex</a></p>}
      {next ? <button className="btn primary" onClick={(e) => { e.stopPropagation(); open(next); }}>Siguiente: {next.title}</button>
            : <button className="btn" onClick={(e) => { e.stopPropagation(); back(); }}>No hay más capítulos · Volver</button>}
    </div>
  );

  return (
    <div className="reader">
      <header className={'r-top' + (ui ? '' : ' hide')}>
        <button className="icon-btn" onClick={back} aria-label="Volver"><Icon n="back" /></button>
        <div className="r-title"><b>{st.series?.title}</b><span>{st.chapter.title}{st.chapter.group ? ` · ${st.chapter.group}` : ""}{/^md:/.test(st.chapter.url || "") ? " · MangaDex" : ""}</span></div>
        {srcSelect}
        <button className={'icon-btn' + (trOn ? ' accent' : '')} title="Traducir (inglés → español)" onClick={toggleTr}
          onContextMenu={(e) => { e.preventDefault(); if (confirm('¿Rehacer la traducción de este capítulo?')) clearTranslations(st.chapter.id).then(() => { setTr({}); setTrOn(false); setTimeout(() => setTrOn(true)); }); }}>
          <Icon n="translate" />
        </button>
        <button className={'icon-btn desk-only' + (s.ytOpen ? ' accent' : '')} title="Panel de YouTube" onClick={() => setS({ ytOpen: !s.ytOpen })}><Icon n="yt" /></button>
        <button className="icon-btn" title={s.mode === 'vertical' ? 'Modo paginado' : 'Modo vertical'} onClick={() => setS({ mode: s.mode === 'vertical' ? 'paged' : 'vertical' })}>
          <Icon n={s.mode === 'vertical' ? 'pages' : 'scroll'} />
        </button>
      </header>

      {s.mode === 'vertical'
        ? <Vertical key={chapterId + ':' + reload} urls={st.urls} start={st.start} gap={s.gap} maxWidth={s.maxWidth} onPage={onPage} onTap={toggle} footer={endBox} jumpRef={jump} tr={trOn ? tr : null} online={st.online} referer={st.referer} hosts={st.hosts} />
        : <Paged urls={st.urls} cur={cur} setCur={setCur} dir={s.dir} fit={s.fit} onTap={toggle} onEnd={() => { saveProgress(st.chapter, n - 1, n); setEnd(true); }} tr={trOn ? tr : null} online={st.online} referer={st.referer} hosts={st.hosts} />}

      {trOn && trMsg && <div className="tr-status">{trMsg}</div>}

      {end && s.mode === 'paged' && <div className="backdrop" onClick={() => setEnd(false)}>{endBox}</div>}

      <footer className={'r-bottom' + (ui ? '' : ' hide')}>
        <button className="icon-btn" disabled={!prev} onClick={() => open(prev)} title="Capítulo anterior"><Icon n="back" /></button>
        <input type="range" min="0" max={Math.max(0, n - 1)} value={cur} dir={s.mode === 'paged' && s.dir === 'rtl' ? 'rtl' : 'ltr'}
          onChange={(e) => { const i = +e.target.value; setCur(i); if (s.mode === 'vertical') jump.current(i); }} />
        <span className="r-count">{cur + 1}/{n}</span>
        <button className="icon-btn flip" disabled={!next} onClick={() => open(next)} title="Capítulo siguiente"><Icon n="back" /></button>
      </footer>
    </div>
  );
}
