// Gestor de extensiones: instalar (URL, JSON pegado o archivo), activar/desactivar, comprobar,
// actualizar y eliminar. Muestra el estado de cada fuente sin confundir un bloqueo de la fuente
// (403) con una falla de Manhuua.
import { useState } from 'react';
import { useExtensions, addExtension, updateExtension, removeExtension, checkExtension, refreshExtension, isEnabled, confirmChanges } from '../sources/extensions.js';
import { STATES, ERROR_KINDS } from '../sources/engine.js';
import { Icon, Favicon, go } from '../ui.jsx';

const TYPE = { web: 'Sitio web', api: 'API JSON', catalog: 'Catálogo JSON', manifest: 'Extensión JSON' };
const ago = (t) => {
  if (!t) return 'nunca';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : new Date(t).toLocaleDateString('es');
};
export function stateOf(x) {
  if (!isEnabled(x)) return { state: 'disabled', label: STATES.disabled };
  return x.status?.state ? { ...x.status, label: x.status.label || STATES[x.status.state] } : { state: 'available', label: STATES.available };
}
export const StateDot = ({ x }) => <span className={'st-dot st-' + stateOf(x).state} title={stateOf(x).label} />;

function Install() {
  const [url, setUrl] = useState('');
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const run = async (args) => {
    setBusy(true); setMsg(null);
    try {
      const x = await addExtension({ ...args, confirm: confirmChanges });
      setMsg({ ok: true, text: `Instalada: ${x.name}${x.version ? ` v${x.version}` : ''}. Comprobando…` });
      setUrl(''); setJson('');
      const st = await checkExtension(x.id);
      setMsg({ ok: st.state === 'ok', text: `${x.name}: ${st.label}${st.works ? ` · ${st.works} obras` : ''}${st.message ? ` · ${st.message}` : ''}` });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const file = async (e) => { const f = e.target.files?.[0]; if (f) setJson(await f.text()); e.target.value = ''; };
  return (
    <section className="ext-install">
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (url.trim()) run({ url }); }}>
        <label>Instalar desde una URL (sitio, API JSON o archivo de extensión .json)
          <div className="row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ejemplo.com/extension.json" inputMode="url" />
            <button className="btn primary" disabled={busy || !url.trim()}>Instalar</button></div>
        </label>
      </form>
      <details>
        <summary>Pegar o subir el JSON de una extensión</summary>
        <form className="form" onSubmit={(e) => { e.preventDefault(); try { run({ json: JSON.parse(json) }); } catch { setMsg({ ok: false, text: 'El texto no es JSON válido.' }); } }}>
          <textarea rows="6" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"manhuua": 1, "id": "mi-fuente", ...}' spellCheck="false" />
          <div className="row">
            <label className="btn sm"><input type="file" accept=".json,application/json" hidden onChange={file} /> Elegir archivo</label>
            <button className="btn primary sm" disabled={busy || !json.trim()}>Instalar JSON</button>
          </div>
        </form>
      </details>
      {msg && <p className={msg.ok ? 'ok-msg' : 'error'}>{msg.text}</p>}
      <p className="hint">Las extensiones JSON solo describen URLs y campos: no ejecutan código ni acceden a tu biblioteca (formato en docs/EXTENSIONS.md del repositorio). Usá fuentes y APIs públicas autorizadas.</p>
    </section>
  );
}

function Row({ x }) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const st = stateOf(x);
  const s = x.status || {};
  const act = async (k, fn) => { setBusy(k); setNote(''); try { await fn(); } catch (e) { setNote(e.message); } setBusy(''); };
  const facts = [
    s.httpStatus && `HTTP ${s.httpStatus}`,
    s.ms != null && `${s.ms} ms`,
    s.works != null && st.state !== 'disabled' && `${s.works} obras`,
    s.chapters != null && `${s.chapters} capítulos (1.ª obra)`,
    `comprobada ${ago(s.at)}`,
  ].filter(Boolean);
  return (
    <li className={'ext-row' + (st.state === 'disabled' ? ' off' : '')}>
      <div className="ext-row-head">
        <Favicon ext={x} />
        <span className="grow">
          <b>{x.name}</b>
          <span className="muted small">{TYPE[x.type] || x.type}{x.version ? ` · v${x.version}` : ''} · {(() => { try { return new URL(x.url).host; } catch { return x.url; } })()}</span>
        </span>
        <span className={'st-badge st-' + st.state}>{st.label}</span>
      </div>
      <div className="muted small">{facts.join(' · ')}{s.kind && st.state !== 'ok' && st.state !== 'disabled' ? ` · ${ERROR_KINDS[s.kind]}` : ''}</div>
      {s.message && st.state !== 'ok' && st.state !== 'disabled' && <p className="small ext-msg">{s.message}</p>}
      {s.chapterError && <p className="small ext-msg">Capítulos: {s.chapterError}</p>}
      {note && <p className="error small">{note}</p>}
      <div className="row">
        <button className="btn sm" disabled={!!busy || !isEnabled(x)} onClick={() => act('c', () => checkExtension(x.id))}><Icon n="refresh" size={14} /> {busy === 'c' ? 'Comprobando…' : 'Comprobar'}</button>
        {x.type === 'manifest' && x.manifestUrl && <button className="btn sm" disabled={!!busy} onClick={() => act('u', async () => { const r = await refreshExtension(x.id, { confirm: confirmChanges }); setNote(r.changed ? `Actualizada de v${r.from} a v${r.to}.` : 'Ya estaba actualizada.'); })}><Icon n="down" size={14} /> {busy === 'u' ? 'Actualizando…' : 'Actualizar'}</button>}
        <button className="btn sm" onClick={() => updateExtension(x.id, { enabled: !isEnabled(x) })}>{isEnabled(x) ? 'Desactivar' : 'Activar'}</button>
        {isEnabled(x) && <button className="btn sm" onClick={() => go(`/ext/${x.id}`)}>Abrir</button>}
        <button className="btn sm danger" onClick={() => confirm(`¿Eliminar la extensión "${x.name}"?\n\nTu biblioteca no se toca: las obras, portadas, progreso, historial y capítulos descargados se conservan.`) && removeExtension(x.id)}><Icon n="trash" size={14} /> Eliminar</button>
      </div>
    </li>
  );
}

export default function Extensions() {
  const exts = useExtensions();
  const [busy, setBusy] = useState(false);
  const checkAll = async () => { setBusy(true); await Promise.allSettled(exts.filter(isEnabled).map((x) => checkExtension(x.id))); setBusy(false); };
  const count = (k) => exts.filter((x) => stateOf(x).state === k).length;
  return (
    <div className="page narrow">
      <header className="top"><h1>Extensiones</h1>
        <div className="actions">{exts.length > 0 && <button className="btn sm" disabled={busy} onClick={checkAll}><Icon n="refresh" size={14} /> {busy ? 'Comprobando…' : 'Comprobar todas'}</button>}</div>
      </header>
      <Install />
      {exts.length > 0 && <p className="muted small">{exts.length} instaladas · {count('ok')} funcionando · {exts.filter((x) => ['blocked', 'notfound', 'conn', 'incompatible', 'limited', 'extraction'].includes(stateOf(x).state)).length} con problemas · {count('disabled')} desactivadas</p>}
      <ul className="ext-rows">{exts.map((x) => <Row key={x.id} x={x} />)}</ul>
      {!exts.length && <p className="empty">Todavía no hay extensiones.</p>}
    </div>
  );
}
