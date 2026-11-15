// Lector de texto para novelas propias (TXT/EPUB importados). Solo muestra texto plano por párrafos:
// nunca HTML de la fuente. Tamaño, tipografía, tema y ancho configurables; posición guardada por párrafo.
import { useEffect, useRef, useState } from 'react';
import { get, byIndex, getAll, pageRange } from '../db.js';
import { byNumber, saveProgress } from '../library.js';
import { useSettings } from '../settings.js';
import { Icon, go } from '../ui.jsx';

const FONTS = { serif: 'Georgia, "Times New Roman", serif', sans: 'system-ui, -apple-system, "Segoe UI", sans-serif', mono: 'ui-monospace, Menlo, Consolas, monospace' };
export const NOVEL_DEFAULTS = { novelSize: 19, novelFont: 'serif', novelTheme: 'dark', novelWidth: 680, novelLine: 1.7 };

export default function NovelReader({ chapterId }) {
  const [s0, setS] = useSettings();
  const s = { ...NOVEL_DEFAULTS, ...s0 };
  const [st, setSt] = useState(null);
  const [panel, setPanel] = useState(''); // '' | 'toc' | 'opts'
  const [pos, setPos] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const chapter = await get('chapters', chapterId);
      if (!chapter) return alive && setSt({ missing: true });
      const [series, list, prog, blobs] = await Promise.all([get('series', chapter.seriesId), byIndex('chapters', 'seriesId', chapter.seriesId), get('progress', chapterId), getAll('pages', pageRange(chapterId))]);
      list.sort(byNumber);
      let doc;
      try { doc = JSON.parse(await blobs[0].text()); } catch { doc = null; }
      if (!alive) return;
      if (!doc?.paras?.length) return setSt({ chapter, series, list, error: 'El capítulo no tiene texto guardado.' });
      const start = prog && !prog.done ? Math.min(prog.page, doc.paras.length - 1) : 0;
      setSt({ chapter, series, list, paras: doc.paras, start });
      setPos(start);
      saveProgress(chapter, start, doc.paras.length);
    })();
    return () => { alive = false; };
  }, [chapterId]);

  // Restaura la posición y la guarda al desplazarse (primer párrafo visible, con pausa de 400 ms).
  useEffect(() => {
    if (!st?.paras || !ref.current) return;
    const el = ref.current;
    if (st.start) el.querySelector(`[data-i="${st.start}"]`)?.scrollIntoView({ block: 'start' });
    else el.scrollTop = 0;
    let t;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const top = el.getBoundingClientRect().top;
        const ps = el.querySelectorAll('[data-i]');
        let i = 0;
        for (const p of ps) { if (p.getBoundingClientRect().bottom > top + 8) { i = +p.dataset.i; break; } }
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) i = st.paras.length - 1;
        setPos(i);
        saveProgress(st.chapter, i, st.paras.length);
      }, 400);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(t); el.removeEventListener('scroll', onScroll); };
  }, [st]);

  if (!st) return <div className="novel-reader"><p className="muted center">Cargando…</p></div>;
  if (st.missing) return <div className="novel-reader"><p className="empty">El capítulo no existe. <a href="#/">Volver</a></p></div>;
  const i = st.list.findIndex((c) => c.id === st.chapter.id);
  const prev = st.list[i - 1], next = st.list[i + 1];
  const nav = (c) => c && go(`/r/${c.id}`);
  const pct = st.paras ? Math.round(((pos + 1) / st.paras.length) * 100) : 0;
  const theme = s.novelTheme;

  return (
    <div className={'novel-reader nt-' + theme}>
      <header className="novel-bar">
        <button className="icon-btn" aria-label="Volver" onClick={() => go(`/s/${st.chapter.seriesId}`)}><Icon n="back" /></button>
        <span className="grow novel-title"><b>{st.series?.title}</b><span className="muted small">{st.chapter.title} · {pct}%</span></span>
        <button className="icon-btn" aria-label="Índice" title="Índice de capítulos" onClick={() => setPanel(panel === 'toc' ? '' : 'toc')}><Icon n="menu" /></button>
        <button className="icon-btn" aria-label="Opciones de lectura" title="Opciones de lectura" onClick={() => setPanel(panel === 'opts' ? '' : 'opts')}><Icon n="gear" /></button>
      </header>
      {panel === 'toc' && (
        <nav className="novel-panel" aria-label="Índice">
          <ol>{st.list.map((c) => <li key={c.id} className={c.id === st.chapter.id ? 'on' : ''}><a href={`#/r/${c.id}`} onClick={() => setPanel('')}>{c.title}</a></li>)}</ol>
        </nav>
      )}
      {panel === 'opts' && (
        <div className="novel-panel novel-opts">
          <label>Tamaño <input type="range" min="14" max="30" value={s.novelSize} onChange={(e) => setS({ novelSize: +e.target.value })} /> <span>{s.novelSize}px</span></label>
          <label>Tipografía <select value={s.novelFont} onChange={(e) => setS({ novelFont: e.target.value })}><option value="serif">Con serifa</option><option value="sans">Sin serifa</option><option value="mono">Monoespaciada</option></select></label>
          <label>Tema <select value={theme} onChange={(e) => setS({ novelTheme: e.target.value })}><option value="dark">Oscuro</option><option value="light">Claro</option><option value="sepia">Sepia</option></select></label>
          <label>Ancho <input type="range" min="420" max="1000" step="20" value={s.novelWidth} onChange={(e) => setS({ novelWidth: +e.target.value })} /> <span>{s.novelWidth}px</span></label>
          <label>Interlineado <input type="range" min="1.3" max="2.2" step="0.1" value={s.novelLine} onChange={(e) => setS({ novelLine: +e.target.value })} /> <span>{s.novelLine}</span></label>
        </div>
      )}
      <article ref={ref} className="novel-body" style={{ '--nw': s.novelWidth + 'px', fontSize: s.novelSize, fontFamily: FONTS[s.novelFont] || FONTS.serif, lineHeight: s.novelLine }}>
        <div className="novel-col">
          {st.error ? <p className="empty">{st.error}</p> : st.paras.map((p, k) => (p.h ? <h2 key={k} data-i={k}>{p.t}</h2> : <p key={k} data-i={k}>{p.t}</p>))}
          <div className="novel-nav">
            <button className="btn" disabled={!prev} onClick={() => nav(prev)}>‹ Anterior</button>
            <button className="btn primary" disabled={!next} onClick={() => nav(next)}>{next ? 'Siguiente ›' : 'Último capítulo'}</button>
          </div>
        </div>
      </article>
    </div>
  );
}
