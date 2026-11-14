import { useEffect, useState } from 'react';
import { useSettings } from '../settings.js';
import { activeProxy, detectProxy } from '../sources/web.js';
import { useExtensions, removeExtension, updateExtension } from '../sources/extensions.js';
import { Favicon, Icon } from '../ui.jsx';
import { openDb } from '../db.js';

const Opt = ({ label, value, options, onChange }) => (
  <label className="opt">{label}
    <select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  </label>
);

export default function Settings() {
  const [s, set] = useSettings();
  const exts = useExtensions();
  const [usage, setUsage] = useState('');
  const [auto, setAuto] = useState('');
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(`${(e.usage / 1048576).toFixed(1)} MB usados de ${(e.quota / 1073741824).toFixed(1)} GB`));
    detectProxy().then(setAuto);
  }, []);

  return (
    <div className="page narrow">
      <header className="top"><h1>Ajustes</h1></header>
      <h3 className="sec">Lector</h3>
      <div className="card-box">
        <Opt label="Modo de lectura" value={s.mode} onChange={(v) => set({ mode: v })} options={[['vertical', 'Vertical (scroll continuo)'], ['paged', 'Paginado']]} />
        <Opt label="Dirección (paginado)" value={s.dir} onChange={(v) => set({ dir: v })} options={[['ltr', 'Izquierda → derecha'], ['rtl', 'Derecha → izquierda']]} />
        <Opt label="Ajuste (paginado)" value={s.fit} onChange={(v) => set({ fit: v })} options={[['screen', 'Pantalla completa'], ['width', 'Ancho']]} />
        <label className="opt">Separación entre páginas: {s.gap}px<input type="range" min="0" max="40" value={s.gap} onChange={(e) => set({ gap: +e.target.value })} /></label>
        <label className="opt">Ancho máximo: {s.maxWidth ? s.maxWidth + 'px' : 'sin límite'}<input type="range" min="0" max="1600" step="20" value={s.maxWidth} onChange={(e) => set({ maxWidth: +e.target.value })} /></label>
        <label className="opt check"><input type="checkbox" checked={s.keepAwake} onChange={(e) => set({ keepAwake: e.target.checked })} /> Mantener pantalla encendida al leer</label>
      </div>
      <h3 className="sec">Apariencia</h3>
      <div className="card-box">
        <Opt label="Tema" value={s.theme} onChange={(v) => set({ theme: v })} options={[['dark', 'Oscuro'], ['light', 'Claro'], ['system', 'Sistema']]} />
      </div>
      <h3 className="sec">Traducción automática</h3>
      <div className="card-box">
        <p className="hint" style={{ margin: 0 }}>En el lector tocá el botón de traducir: detecta el texto de los globos (OCR en el dispositivo) y lo superpone traducido. Mantener presionado el botón rehace la traducción del capítulo.</p>
        <Opt label="Servicio" value={s.trProvider} onChange={(v) => set({ trProvider: v })} options={[['mymemory', 'MyMemory (gratis, sin clave, límite diario)'], ['libre', 'LibreTranslate (servidor propio o con clave)']]} />
        <div className="row">
          <Opt label="De" value={s.trFrom} onChange={(v) => set({ trFrom: v })} options={[['en', 'Inglés']]} />
          <Opt label="A" value={s.trTo} onChange={(v) => set({ trTo: v })} options={[['es', 'Español'], ['pt', 'Portugués'], ['en', 'Inglés']]} />
        </div>
        {s.trProvider === 'mymemory' ? (
          <label className="opt">Email (opcional, sube el límite diario de MyMemory)
            <input type="email" value={s.trEmail} onChange={(e) => set({ trEmail: e.target.value })} placeholder="tu@email.com" />
          </label>
        ) : (
          <>
            <label className="opt">URL de LibreTranslate<input value={s.libreUrl} onChange={(e) => set({ libreUrl: e.target.value })} /></label>
            <label className="opt">API key (si el servidor la pide)<input value={s.libreKey} onChange={(e) => set({ libreKey: e.target.value })} /></label>
          </>
        )}
      </div>
      <h3 className="sec">Portadas</h3>
      <div className="card-box">
        <label className="opt check"><input type="checkbox" checked={s.coverAuto} onChange={(e) => set({ coverAuto: e.target.checked })} /> Buscar portadas automáticamente en AniList y Kitsu al importar o descargar</label>
        <p className="hint" style={{ margin: 0 }}>Generación con IA (opcional): API compatible con OpenAI Images. Sin clave, la opción no aparece.</p>
        <label className="opt">URL del endpoint<input value={s.genUrl} onChange={(e) => set({ genUrl: e.target.value })} inputMode="url" /></label>
        <div className="row">
          <label className="opt">Modelo<input value={s.genModel} onChange={(e) => set({ genModel: e.target.value })} /></label>
          <label className="opt">Tamaño<input value={s.genSize} onChange={(e) => set({ genSize: e.target.value })} /></label>
        </div>
        <label className="opt">API key (se guarda solo en este dispositivo)<input type="password" value={s.genKey} onChange={(e) => set({ genKey: e.target.value })} autoComplete="off" /></label>
      </div>
      <h3 className="sec">Red</h3>
      <div className="card-box">
        <label className="opt">Proxy CORS (prefijo; se le agrega la URL codificada, o usá {'{url}'})
          <input value={s.proxy || ''} onChange={(e) => set({ proxy: e.target.value })} placeholder={auto || 'http://192.168.0.10:8787/proxy?url='} />
        </label>
        <label className="opt check"><input type="checkbox" checked={s.publicProxy !== false} onChange={(e) => set({ publicProxy: e.target.checked })} /> Usar proxy público automático si no hay uno propio (corsproxy.io / allorigins)</label>
        <p className="hint">Activo: {activeProxy() || (s.publicProxy !== false ? 'proxy público automático' : 'ninguno')}{auto ? ' (detectado automáticamente)' : ''}. El proxy público ve las URLs que pedís; para más privacidad y velocidad usá tu propio proxy (server/cloudflare-worker.js).</p>
      </div>
      <h3 className="sec">Extensiones</h3>
      <div className="card-box">
        {!exts.length && <p className="muted">Agregalas desde el menú lateral.</p>}
        {exts.map((x) => (
          <div key={x.id} className="ext-row">
            <Favicon ext={x} />
            <div className="grow">
              <input value={x.name} onChange={(e) => updateExtension(x.id, { name: e.target.value })} />
              <input value={x.searchUrl || ''} placeholder="URL de búsqueda con {q}" onChange={(e) => updateExtension(x.id, { searchUrl: e.target.value })} />
              <span className="muted small">{x.url}</span>
            </div>
            <button className="icon-btn" onClick={() => confirm(`¿Quitar ${x.name}?`) && removeExtension(x.id)}><Icon n="trash" /></button>
          </div>
        ))}
      </div>
      <h3 className="sec">Almacenamiento</h3>
      <div className="card-box">
        <p className="muted">{usage || '—'}</p>
        <button className="btn danger" onClick={() => {
          if (!confirm('¿Borrar TODA la biblioteca y el progreso?')) return;
          openDb().then((d) => { d.close(); const r = indexedDB.deleteDatabase('manhuua'); r.onsuccess = r.onerror = () => location.reload(); });
        }}>Borrar todos los datos</button>
      </div>
    </div>
  );
}
