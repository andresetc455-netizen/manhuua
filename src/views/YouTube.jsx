// Panel de YouTube al costado del lector (PC). Reproduce videos, playlists o directos con el
// reproductor oficial embebido. Opcional: conectar la cuenta (Google OAuth) para ver tus playlists.
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../settings.js';
import { Icon } from '../ui.jsx';

/** Interpreta un link o ID de YouTube. Devuelve {video?, list?} o null. */
export function parseYouTube(input = '') {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return { video: s };
  if (/^(PL|UU|LL|FL|OL|RD)[\w-]{10,}$/.test(s)) return { list: s };
  let u;
  try { u = new URL(/^https?:\/\//.test(s) ? s : 'https://' + s); } catch { return null; }
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$|youtube-nocookie\.com$/.test(u.hostname)) return null;
  const list = u.searchParams.get('list') || undefined;
  let video = u.searchParams.get('v') || undefined;
  const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || (u.hostname.endsWith('youtu.be') && u.pathname.match(/^\/([\w-]{11})/));
  if (m) video = m[1];
  return video || list ? { video, list } : null;
}

export function embedUrl({ video, list }) {
  const p = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1', playsinline: '1' });
  if (list) p.set('list', list);
  return `https://www.youtube.com/embed/${video || 'videoseries'}?${p}`;
}

const RECENT = 'manhuua.yt.recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; } };
const saveRecent = (r) => { try { localStorage.setItem(RECENT, JSON.stringify(r.slice(0, 12))); } catch {} };

/* ---- Conexión opcional con la cuenta (YouTube Data API, solo lectura) ---- */
let gisP = null;
const loadGis = () => (gisP ??= new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = () => res(window.google); s.onerror = () => rej(new Error('No se pudo cargar el inicio de sesión de Google'));
  document.head.appendChild(s);
}));

async function connectAccount(clientId) {
  const google = await loadGis();
  return new Promise((res, rej) => {
    google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: 'https://www.googleapis.com/auth/youtube.readonly',
      callback: (r) => (r.error ? rej(new Error(r.error)) : res(r.access_token)),
    }).requestAccessToken();
  });
}
async function myPlaylists(token) {
  const get = (path) => fetch(`https://www.googleapis.com/youtube/v3/${path}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  const [pl, ch] = await Promise.all([get('playlists?part=snippet,contentDetails&mine=true&maxResults=50'), get('channels?part=contentDetails&mine=true')]);
  if (pl.error) throw new Error(pl.error.message);
  const out = (pl.items || []).map((p) => ({ list: p.id, title: p.snippet.title, thumb: p.snippet.thumbnails?.medium?.url, count: p.contentDetails?.itemCount }));
  const likes = ch.items?.[0]?.contentDetails?.relatedPlaylists?.likes;
  if (likes) out.unshift({ list: likes, title: 'Videos que me gustan', thumb: null });
  return out;
}

export default function YouTubePanel() {
  const [s, set] = useSettings();
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');
  const [recent, setRecent] = useState(loadRecent);
  const [token, setToken] = useState(null);
  const [lists, setLists] = useState(null);
  const drag = useRef(null);
  const width = s.ytWidth || 420;

  useEffect(() => { document.documentElement.style.setProperty('--yt-w', s.ytOpen ? width + 'px' : '0px'); }, [s.ytOpen, width]);
  useEffect(() => () => document.documentElement.style.setProperty('--yt-w', '0px'), []);
  if (!s.ytOpen) return null;

  const play = (src, label) => {
    const p = typeof src === 'string' ? parseYouTube(src) : src;
    if (!p) return setErr('No es un link de YouTube válido (video, playlist, shorts o directo).');
    setErr(''); setInput('');
    set({ ytCurrent: p });
    const item = { ...p, label: label || (p.video ? `Video ${p.video}` : `Playlist ${p.list.slice(0, 10)}…`), at: Date.now() };
    const r = [item, ...recent.filter((x) => x.video !== p.video || x.list !== p.list)];
    setRecent(r); saveRecent(r);
  };
  const connect = async () => {
    setErr('');
    try { const t = await connectAccount(s.ytClientId.trim()); setToken(t); setLists(await myPlaylists(t)); }
    catch (e) { setErr(e.message); }
  };
  const onDrag = (e) => {
    e.preventDefault();
    const move = (ev) => set({ ytWidth: Math.min(900, Math.max(300, innerWidth - ev.clientX)) });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); drag.current?.classList.remove('on'); };
    drag.current?.classList.add('on');
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  return (
    <aside className="yt-panel" style={{ width }}>
      <div className="yt-drag" ref={drag} onPointerDown={onDrag} title="Arrastrá para cambiar el ancho" />
      <header className="yt-head">
        <b><Icon n="play" size={16} fill /> YouTube</b>
        <button className="icon-btn" onClick={() => set({ ytOpen: false })} title="Cerrar panel"><Icon n="x" /></button>
      </header>
      <div className="yt-player">
        {s.ytCurrent
          ? <iframe key={JSON.stringify(s.ytCurrent)} src={embedUrl(s.ytCurrent)} title="Reproductor de YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          : <div className="yt-empty">Pegá abajo el link de un video, playlist o directo.</div>}
      </div>
      <form className="yt-form" onSubmit={(e) => { e.preventDefault(); play(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://youtube.com/watch?v=… o playlist" inputMode="url" />
        <button className="btn primary sm">Reproducir</button>
      </form>
      {err && <p className="error small">{err}</p>}
      <div className="yt-scroll">
        {s.ytClientId ? (
          token
            ? <>
                <h4 className="sec">Mis playlists</h4>
                <ul className="yt-list">{(lists || []).map((p) => (
                  <li key={p.list}><button onClick={() => play({ list: p.list }, p.title)}>{p.thumb ? <img src={p.thumb} alt="" /> : <span className="yt-ph"><Icon n="star" /></span>}<span><b>{p.title}</b>{p.count != null && <span className="muted small">{p.count} videos</span>}</span></button></li>
                ))}</ul>
              </>
            : <button className="btn wide" onClick={connect}>Conectar mi cuenta de YouTube</button>
        ) : (
          <p className="hint">Si tenés la sesión de YouTube iniciada en este navegador, el reproductor la usa (Premium, historial). Para ver tus playlists acá, cargá un ID de cliente de Google en Ajustes → YouTube.</p>
        )}
        {recent.length > 0 && <h4 className="sec">Recientes</h4>}
        <ul className="yt-list">{recent.map((r) => (
          <li key={(r.video || '') + (r.list || '')}><button onClick={() => play(r, r.label)}>
            {r.video ? <img src={`https://i.ytimg.com/vi/${r.video}/mqdefault.jpg`} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span className="yt-ph"><Icon n="pages" /></span>}
            <span><b>{r.label}</b><span className="muted small">{r.list ? 'Playlist' : 'Video'}</span></span>
          </button></li>
        ))}</ul>
      </div>
    </aside>
  );
}
