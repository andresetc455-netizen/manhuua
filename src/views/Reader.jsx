import { useCallback, useEffect, useRef, useState } from 'react';
import { get, byIndex } from '../db.js';
import { byNumber, loadPages, saveProgress, updateSeries } from '../library.js';
import { translatePage, clearTranslations, fitFont } from '../translate.js';
import { useSettings } from '../settings.js';
import { Icon } from '../ui.jsx';

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

function Vertical({ urls, start, gap, maxWidth, onPage, onTap, footer, jumpRef, tr }) {
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
    if (ok) e.currentTarget.classList.add('ok');
    if (!ready.current && i <= start && ++loaded.current > start) {
      refs.current[start]?.scrollIntoView({ block: 'start' });
      ready.current = true;
    }
  };
  return (
    <div className="vertical" style={{ '--gap': gap + 'px', '--mw': maxWidth ? maxWidth + 'px' : 'none' }} onClick={onTap}>
      {urls.map((u, i) => (
        <div key={u} ref={(el) => (refs.current[i] = el)} data-i={i} className="pgw">
          <img className="pg" src={u} alt={`Página ${i + 1}`}
            loading={i <= start + 2 ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onLoad={settle(i, true)} onError={settle(i, false)} />
          {tr?.[i]?.items && <TrOverlay data={tr[i]} />}
        </div>
      ))}
      <div ref={(el) => (refs.current[urls.length] = el)} data-i={urls.length - 1}>{footer}</div>
    </div>
  );
}

function Paged({ urls, cur, setCur, dir, fit, onTap, onEnd, tr }) {
  const touch = useRef(null);
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
        <img src={urls[cur]} alt={`Página ${cur + 1}`} referrerPolicy="no-referrer" />
        {tr?.[cur]?.items && <TrOverlay data={tr[cur]} />}
      </div>
      {urls[cur + 1] && <link rel="preload" as="image" href={urls[cur + 1]} />}
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
  useWakeLock(s.keepAwake);

  useEffect(() => {
    let alive = true, dispose;
    (async () => {
      const chapter = await get('chapters', chapterId);
      if (!chapter) return setSt({ missing: true });
      const [series, list, prog] = await Promise.all([get('series', chapter.seriesId), byIndex('chapters', 'seriesId', chapter.seriesId), get('progress', chapterId)]);
      const pages = await loadPages(chapter);
      dispose = pages.dispose;
      if (!alive) return dispose();
      list.sort(byNumber);
      const start = prog && !prog.done ? Math.min(prog.page, pages.urls.length - 1) : 0;
      setCur(start);
      setEnd(false);
      setSt({ chapter, series, list, urls: pages.urls, start });
      setTr({}); setTrMsg('');
      setTrOn(!!series?.translate);
    })();
    return () => { alive = false; dispose?.(); };
  }, [chapterId]);

  useEffect(() => {
    if (!st?.chapter) return;
    const t = setTimeout(() => saveProgress(st.chapter, cur, st.urls.length), 350);
    return () => clearTimeout(t);
  }, [cur, st]);

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
        try { done[i] = await translatePage(st.chapter.id, i, st.urls[i]); }
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

  const idx = st.list.findIndex((c) => c.id === chapterId);
  const prev = st.list[idx - 1], next = st.list[idx + 1];
  const open = (c) => c && location.replace(`#/r/${c.id}`);
  const back = () => location.replace(`#/s/${st.chapter.seriesId}`);
  const n = st.urls.length;
  const endBox = (
    <div className="chapter-end">
      <p>Fin de <b>{st.chapter.title}</b></p>
      {next ? <button className="btn primary" onClick={(e) => { e.stopPropagation(); open(next); }}>Siguiente: {next.title}</button>
            : <button className="btn" onClick={(e) => { e.stopPropagation(); back(); }}>No hay más capítulos · Volver</button>}
    </div>
  );

  return (
    <div className="reader">
      <header className={'r-top' + (ui ? '' : ' hide')}>
        <button className="icon-btn" onClick={back} aria-label="Volver"><Icon n="back" /></button>
        <div className="r-title"><b>{st.series?.title}</b><span>{st.chapter.title}</span></div>
        <button className={'icon-btn' + (trOn ? ' accent' : '')} title="Traducir (inglés → español)" onClick={toggleTr}
          onContextMenu={(e) => { e.preventDefault(); if (confirm('¿Rehacer la traducción de este capítulo?')) clearTranslations(st.chapter.id).then(() => { setTr({}); setTrOn(false); setTimeout(() => setTrOn(true)); }); }}>
          <Icon n="translate" />
        </button>
        <button className="icon-btn" title={s.mode === 'vertical' ? 'Modo paginado' : 'Modo vertical'} onClick={() => setS({ mode: s.mode === 'vertical' ? 'paged' : 'vertical' })}>
          <Icon n={s.mode === 'vertical' ? 'pages' : 'scroll'} />
        </button>
      </header>

      {s.mode === 'vertical'
        ? <Vertical key={chapterId} urls={st.urls} start={st.start} gap={s.gap} maxWidth={s.maxWidth} onPage={onPage} onTap={toggle} footer={endBox} jumpRef={jump} tr={trOn ? tr : null} />
        : <Paged urls={st.urls} cur={cur} setCur={setCur} dir={s.dir} fit={s.fit} onTap={toggle} onEnd={() => { saveProgress(st.chapter, n - 1, n); setEnd(true); }} tr={trOn ? tr : null} />}

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
