// Cambiar la portada de una serie: buscar en AniList/Kitsu, subir archivo, URL o generar con IA.
import { useEffect, useRef, useState } from 'react';
import { searchCovers, usedCoverUrls, setCover, clearCover, generateCover, canGenerate, PROVIDERS } from '../covers.js';
import { Sheet, Icon } from '../ui.jsx';

export default function CoverSheet({ series, onClose }) {
  const [q, setQ] = useState(series.title);
  const [state, setState] = useState('idle');
  const [cands, setCands] = useState([]);
  const [used, setUsed] = useState(new Set());
  const [err, setErr] = useState('');
  const [url, setUrl] = useState('');
  const file = useRef();

  const search = async (e) => {
    e?.preventDefault();
    setState('loading'); setErr('');
    try {
      const [c, u] = await Promise.all([searchCovers(q), usedCoverUrls(series.id)]);
      setCands(c); setUsed(u); setState('ok');
    } catch (x) { setErr(x.message); setState('error'); }
  };
  useEffect(() => { search(); }, []); // eslint-disable-line

  const run = async (fn) => {
    setState('saving'); setErr('');
    try { await fn(); onClose(); } catch (x) { setErr(x.message); setState('ok'); }
  };

  return (
    <Sheet title="Portada" onClose={onClose}>
      <div className="form">
        <form className="search" onSubmit={search}>
          <Icon n="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título (en inglés o romanizado suele dar mejores resultados)" />
        </form>
        {state === 'loading' && <p className="muted">Buscando en AniList y Kitsu…</p>}
        {state === 'saving' && <p className="muted">Guardando portada…</p>}
        {err && <p className="error">{err}</p>}
        {state === 'ok' && !cands.length && <p className="muted">Sin resultados. Probá con el título en inglés o subí una imagen.</p>}
        <div className="cover-pick">
          {cands.map((c) => {
            const taken = used.has(c.url);
            return (
              <button key={c.url} className="pick-item" disabled={taken || state === 'saving'} title={taken ? 'Ya la usa otra serie' : c.title}
                onClick={() => run(() => setCover(series.id, c.url, { provider: c.provider, id: c.id, url: c.url, link: c.link }, { lock: true, meta: c }))}>
                <div className="cover"><img src={c.url} alt="" loading="lazy" referrerPolicy="no-referrer" /></div>
                <span className="pick-title">{c.title}</span>
                <span className="muted small">{PROVIDERS[c.provider]}{c.origin ? ' · ' + c.origin : ''}{taken ? ' · en uso' : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="row">
          <button className="btn" onClick={() => file.current.click()}><Icon n="image" size={16} /> Subir imagen</button>
          {canGenerate() && <button className="btn" onClick={() => run(() => generateCover(series.id))}><Icon n="image" size={16} /> Generar con IA</button>}
          <button className="btn" onClick={() => run(() => clearCover(series.id))}>Quitar portada</button>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && run(() => setCover(series.id, e.target.files[0], { provider: 'file' }, { lock: true }))} />
        <form className="row" onSubmit={(e) => { e.preventDefault(); url && run(() => setCover(series.id, url, { provider: 'url', url }, { lock: true })); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…o pegá la URL de una imagen" inputMode="url" style={{ flex: 1 }} />
          <button className="btn">Usar URL</button>
        </form>
        <p className="hint">Portadas de AniList y Kitsu (bases de datos públicas). La imagen elegida se guarda en el dispositivo y no se repite entre series.</p>
      </div>
    </Sheet>
  );
}
