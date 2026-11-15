import { useEffect, useState } from 'react';
import { useSettings } from './settings.js';
import { useExtensions, addExtension, isEnabled, confirmChanges } from './sources/extensions.js';
import { detectProxy } from './sources/web.js';
import { detectRender } from './sources/engine.js';
import { useDownloads } from './downloads.js';
import { Icon, Favicon, Sheet, go } from './ui.jsx';
import Library from './views/Library.jsx';
import SeriesView from './views/SeriesView.jsx';
import Reader from './views/Reader.jsx';
import Downloads from './views/Downloads.jsx';
import Settings from './views/Settings.jsx';
import { ExtensionHome, RemoteSeries } from './views/Extension.jsx';
import { Updates, History, Browse, More } from './views/Feeds.jsx';
import YouTubePanel from './views/YouTube.jsx';
import { migrateSources, relinkSources } from './online.js';
import Extensions, { StateDot } from './views/Extensions.jsx';
import WorkView from './views/WorkView.jsx';

function useRoute() {
  const [h, set] = useState(location.hash);
  useEffect(() => {
    const f = () => set(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
}

function useTheme(theme) {
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = t;
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#121216' : '#f6f4f1');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function AddExtension({ onClose }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [searchUrl, setSearchUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const x = await addExtension({ url, name, searchUrl, confirm: confirmChanges }); onClose(); go(`/ext/${x.id}`); }
    catch (err) { alert(err.message); setBusy(false); }
  };
  return (
    <Sheet title="Agregar extensión" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>URL del sitio (portada o directorio de series)
          <input required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ejemplo.com/series" inputMode="url" autoFocus />
        </label>
        <label>Nombre (opcional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Se detecta automáticamente" />
        </label>
        <label>URL de búsqueda (opcional, usá {'{q}'})
          <input value={searchUrl} onChange={(e) => setSearchUrl(e.target.value)} placeholder="https://ejemplo.com/buscar?q={q}" inputMode="url" />
        </label>
        <p className="hint">También acepta un catálogo .json propio o una extensión JSON (ver <a href="#/extensions" onClick={onClose}>Extensiones</a>). Usalo solo con sitios cuyo contenido tengas derecho a descargar.</p>
        <button className="btn primary" disabled={busy}>{busy ? 'Agregando…' : 'Agregar'}</button>
      </form>
    </Sheet>
  );
}

function Sidebar({ route, open, onClose, onAdd }) {
  const exts = useExtensions();
  const dl = useDownloads().filter((j) => !['listo', 'error', 'omitido'].includes(j.status)).length;
  const cur = route[0] || '';
  const item = (hash, icon, label, active, extra) => (
    <a href={'#/' + hash} className={'side-item' + (active ? ' active' : '')} onClick={onClose}>
      {icon}<span>{label}</span>{extra}
    </a>
  );
  return (
    <>
      <div className={'side-backdrop' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="brand"><img src="./icon.svg" alt="" width="28" height="28" /> Manhuua</div>
        <nav>
          {item('', <Icon n="book" />, 'Biblioteca', cur === '' || cur === 's')}
          {item('updates', <Icon n="bell" />, 'Novedades', cur === 'updates')}
          {item('history', <Icon n="clock" />, 'Historial', cur === 'history')}
          {item('browse', <Icon n="compass" />, 'Explorar', cur === 'browse' || cur === 'ext' || cur === 'w')}
          {item('downloads', <Icon n="down" />, 'Descargas', cur === 'downloads', dl ? <b className="pill">{dl}</b> : null)}
          {item('settings', <Icon n="gear" />, 'Ajustes', cur === 'settings')}
        </nav>
        <div className="side-sep">Extensiones</div>
        <nav className="ext-list">
          {exts.filter(isEnabled).map((x) => item(`ext/${x.id}`, <Favicon ext={x} />, x.name, cur === 'ext' && route[1] === x.id, <StateDot x={x} />))}
          <button className="side-item add" onClick={() => { onClose(); onAdd(); }}><Icon n="plus" /><span>Agregar extensión</span></button>
          {item('extensions', <Icon n="gear" />, 'Gestionar extensiones', cur === 'extensions')}
        </nav>
      </aside>
    </>
  );
}

export default function App() {
  const route = useRoute();
  const [s] = useSettings();
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  useTheme(s.theme);
  useEffect(() => { detectProxy(); detectRender(); }, []);
  // Biblioteca: fija la fuente de los datos anteriores y, cuando cambian las extensiones instaladas,
  // recupera la asociación con las que se reinstalaron (misma identidad). No borra datos.
  const installed = useExtensions();
  const idsKey = installed.map((x) => x.id).sort().join(',');
  useEffect(() => {
    migrateSources().then(() => relinkSources(installed)).catch((e) => console.warn('biblioteca/fuentes', e));
  }, [idsKey]); // eslint-disable-line

  const [view, a, b, c] = route;
  if (view === 'r') return <div className={'reader-wrap' + (s.ytOpen ? ' with-yt' : '')}><Reader key={a} chapterId={a} /><YouTubePanel /></div>;

  let page;
  if (view === 's') page = <SeriesView key={a} id={a} />;
  else if (view === 'downloads') page = <Downloads />;
  else if (view === 'updates') page = <Updates />;
  else if (view === 'history') page = <History />;
  else if (view === 'browse') page = <Browse onAdd={() => setAdding(true)} />;
  else if (view === 'more') page = <More />;
  else if (view === 'settings') page = <Settings />;
  else if (view === 'extensions') page = <Extensions />;
  else if (view === 'w') page = <WorkView key={a} workKey={a} />;
  else if (view === 'ext' && b === 's') page = <RemoteSeries key={c} extId={a} url={c} />;
  else if (view === 'ext') page = <ExtensionHome key={a} extId={a} />;
  else page = <Library />;

  return (
    <div className="shell">
      <Sidebar route={route} open={menu} onClose={() => setMenu(false)} onAdd={() => setAdding(true)} />
      <main className="main">
        <button className="icon-btn menu-btn" onClick={() => setMenu(true)} aria-label="Menú"><Icon n="menu" /></button>
        {page}
      </main>
      <nav className="tabbar">
        {[['', 'book', 'Biblioteca', ['', 's']], ['updates', 'bell', 'Novedades', ['updates']], ['history', 'clock', 'Historial', ['history']], ['browse', 'compass', 'Explorar', ['browse', 'ext', 'w']], ['more', 'dots', 'Más', ['more', 'downloads', 'settings', 'extensions']]].map(([h, i, l, m]) => (
          <a key={h} href={'#/' + h} className={m.includes(view || '') ? 'on' : ''}><Icon n={i} size={22} /><span>{l}</span></a>
        ))}
      </nav>
      {adding && <AddExtension onClose={() => setAdding(false)} />}
    </div>
  );
}
