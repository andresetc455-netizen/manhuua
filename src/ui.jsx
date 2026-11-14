import { useEffect, useState } from 'react';
import { proxied, activeProxy } from './sources/web.js';
import { hueOf } from './covers.js';

const P = {
  back: 'M15 18l-6-6 6-6',
  plus: 'M12 5v14M5 12h14',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.1V3a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1.3z',
  book: 'M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5zM4 19.5A2.5 2.5 0 006.5 22H20v-5',
  down: 'M12 3v12m0 0l-5-5m5 5l5-5M4 21h16',
  check: 'M5 12l5 5L20 7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  folder: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  scroll: 'M8 3v18M16 3v18M3 8h5M16 16h5',
  pages: 'M4 4h7v16H4zM13 4h7v16h-7z',
  play: 'M7 4l12 8-12 8z',
  x: 'M6 6l12 12M18 6L6 18',
  translate: 'M3 5h9M7.5 3v2M5 5c0 4 3 7 6.5 8M10 5c0 3-3 7-6.5 8M13 21l4-9 4 9M14.5 18h5',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  bell: 'M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  compass: 'M12 21a9 9 0 100-18 9 9 0 000 18zM16 8l-2 6-6 2 2-6z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18',
};
export function Icon({ n, size = 20, fill }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[n]} />
    </svg>
  );
}

/** src para Blob (local) o URL remota (vía proxy si hay uno, con referer). */
export function useSrc(v, referer) {
  const [src, set] = useState(null);
  useEffect(() => {
    if (!v) return set(null);
    if (typeof v === 'string') return set(activeProxy() ? proxied(v, referer) : v);
    const u = URL.createObjectURL(v);
    set(u);
    return () => URL.revokeObjectURL(u);
  }, [v, referer]);
  return src;
}

/** Portada 2:3. Si no hay imagen (o falla), muestra una portada tipográfica de respaldo. */
export function Cover({ src, title, kind, referer, children }) {
  const s = useSrc(src, referer);
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [s]);
  const show = s && !bad;
  return (
    <div className="cover">
      {show
        ? <img src={s} alt={title || ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
        : <FallbackCover title={title} kind={kind} />}
      {children}
    </div>
  );
}

function FallbackCover({ title = '', kind }) {
  const h = hueOf(title);
  return (
    <div className="cover-fb" style={{ '--h': h }} aria-label={`${title} (sin portada)`}>
      <span className="fb-initial">{(title.trim()[0] || '?').toUpperCase()}</span>
      <span className="fb-title">{title}</span>
      <span className="fb-kind">{kind || 'Sin portada'}</span>
    </div>
  );
}

/** Fondo difuminado con la portada (banner de ficha). */
export function BgCover({ src, referer }) {
  const s = useSrc(src, referer);
  return <div className="bg-cover" style={s ? { backgroundImage: `url("${s}")` } : undefined} aria-hidden="true" />;
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon n="x" /></button></header>
        {children}
      </div>
    </div>
  );
}

export function Favicon({ ext }) {
  const [bad, setBad] = useState(false);
  return bad || !ext.icon
    ? <span className="fav-ph">{ext.name.slice(0, 1).toUpperCase()}</span>
    : <img className="fav" src={ext.icon} alt="" onError={() => setBad(true)} referrerPolicy="no-referrer" />;
}

export const go = (h) => { location.hash = h; };
