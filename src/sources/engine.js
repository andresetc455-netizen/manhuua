// Motor de carga para extensiones: HTML estático → datos embebidos → renderizado (si hay
// servidor de renderizado) y diagnóstico de por qué una página no muestra obras.
import { loadSettings } from '../settings.js';
import { fetchVia } from './web.js';
import { BACKEND } from '../backend.js';

/* ---------- renderizador (server/render.mjs vía server/proxy.mjs) ---------- */

let autoRender = '';
let detectP = null;
/** Detecta (una sola vez) el renderizador del servidor incluido, si la app se sirve desde él. */
export function detectRender() {
  detectP ??= (async () => {
    if (BACKEND) return (autoRender = `${BACKEND}/render`);
    try {
      const r = await fetch('./render', { cache: 'no-store' });
      if (r.status === 400 && (await r.text()).includes('manhuua-render')) autoRender = './render';
    } catch {}
    return autoRender;
  })();
  return detectP;
}
export const renderBase = () => loadSettings().renderUrl?.trim() || autoRender;

/** Pide al servidor que abra la página en un navegador real y espere a que aparezca el contenido. */
export async function renderPage(url, kind = 'catalog') {
  const base = renderBase();
  if (!base) throw new Error('No hay servidor de renderizado');
  const r = await fetch(`${base}${base.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}&kind=${kind}`);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok && !j.html) throw new Error(j.error || `HTTP ${r.status}`);
  return j; // {html, status, finalUrl, jsErrors, wait:{n, ms, reason}, antibot}
}

/* ---------- inspección de HTML ---------- */

const ANTIBOT = /just a moment|attention required|cf-browser-verification|challenge-platform|captcha|verify you are human|ddos-guard|checking your browser/i;

export function inspectHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  const text = (body?.textContent || '').replace(/\s+/g, ' ').trim();
  const root = doc.querySelector('#__next, #__nuxt, #app, #root, #___gatsby, [data-reactroot], app-root');
  const scripts = doc.querySelectorAll('script').length;
  return {
    bytes: html.length,
    title: doc.title,
    textChars: text.length,
    scripts,
    links: doc.querySelectorAll('a[href]').length,
    imgs: doc.querySelectorAll('img, picture source, [style*="background-image"]').length,
    spaRoot: root ? `#${root.id || root.tagName.toLowerCase()}` : null,
    spaLikely: !!root && (root.textContent || '').trim().length < 200 || (scripts > 5 && text.length < 400),
    embedded: [
      doc.querySelector('#__NEXT_DATA__') && 'Next.js',
      doc.querySelector('#__NUXT_DATA__') && 'Nuxt',
      doc.querySelector('script[type="application/ld+json"]') && 'JSON-LD',
    ].filter(Boolean),
    antibot: ANTIBOT.test(doc.title) || ANTIBOT.test(html.slice(0, 20000)) && text.length < 2000,
  };
}

/**
 * Carga una página para extraer algo de ella. `count(html, url)` dice cuántas cosas útiles hay
 * (obras, capítulos o imágenes). Si el HTML estático no alcanza y hay renderizador, renderiza.
 */
export async function loadDoc(url, { kind = 'catalog', count, min = 1 }) {
  await detectRender();
  const diag = { url, kind, attempts: [], startedAt: Date.now() };
  let html = null, n = 0, base = url;
  try {
    html = await fetchVia(url, 'text', undefined, diag.attempts);
    diag.finalUrl = diag.attempts.find((a) => a.ok)?.finalUrl;
    if (diag.finalUrl) base = diag.finalUrl;
    Object.assign(diag, inspectHtml(html));
    n = diag.staticCount = count(html, base);
    diag.via = 'HTML estático';
  } catch (e) { Object.assign(diag, { httpError: e.message, httpStatus: e.status, errorSource: e.source, challenge: e.challenge }); }

  // No se reintenta con el navegador si el sitio ya respondió con un error HTTP (403, 404, 429…)
  // ni si el problema es del backend: renderizar no cambia esas respuestas.
  const skipRender = diag.errorSource === 'site' || diag.errorSource === 'backend' || /^\s*[[{]/.test(html || '');
  if (skipRender && n < min && diag.httpError) diag.renderSkipped = diag.errorSource === 'backend' ? 'error del backend' : `el sitio respondió HTTP ${diag.httpStatus}`;
  if (n < min && renderBase() && !diag.antibot && !skipRender) {
    try {
      const r = await renderPage(url, kind);
      diag.render = { status: r.status, finalUrl: r.finalUrl, jsErrors: r.jsErrors || [], wait: r.wait, antibot: r.antibot, bytes: r.html?.length };
      if (r.antibot) diag.antibot = true;
      if (r.html) {
        const m = (diag.renderCount = count(r.html, r.finalUrl || url));
        if (m > n || !html) { html = r.html; n = m; base = r.finalUrl || url; diag.via = 'renderizado (navegador)'; diag.rendered = inspectHtml(r.html); }
      }
    } catch (e) { diag.renderError = e.message; }
  }
  diag.count = n;
  diag.ms = Date.now() - diag.startedAt;
  if (!html) throw Object.assign(new Error(diag.httpError || diag.renderError || 'No se pudo cargar la página'), { diag });
  return { html, base, diag };
}

/** Explica en palabras por qué no hay resultados (o qué limita los que hay). */
const SITE_MSG = {
  401: 'La fuente pide iniciar sesión (HTTP 401). Manhuua no usa cuentas de terceros.',
  403: 'La fuente bloqueó el acceso (HTTP 403).',
  404: 'La página no existe en la fuente (HTTP 404): revisá la URL.',
  410: 'La página ya no existe en la fuente (HTTP 410).',
  429: 'La fuente limita la cantidad de peticiones (HTTP 429): esperá unos minutos.',
  451: 'La fuente no permite el acceso por motivos legales (HTTP 451).',
};

/** Explica en palabras por qué no hay resultados (o qué limita los que hay). */
export function explain(d, what = 'obras') {
  const out = [];
  const ok = d.attempts?.some((a) => a.ok);
  if (!ok && !d.render?.bytes) {
    const last = [...(d.attempts || [])].reverse().find((a) => !a.ok) || {};
    const src = d.errorSource || last.source;
    const st = d.httpStatus ?? last.status;
    if (src === 'backend') {
      const m = d.httpError || last.error || '';
      if (/origen no permitido/i.test(m)) out.push(`El backend rechazó la petición: el dominio de la app (${location.origin}) no está en ALLOWED_ORIGINS de Render.`);
      else if (st === 403) out.push('El backend rechazó el destino (dirección interna o no permitida).');
      else if (st === 429) out.push('Se alcanzó el límite de peticiones del backend: esperá un minuto.');
      else if (st === 503) out.push('El backend está ocupado (renderizador en uso): probá de nuevo en unos segundos.');
      else if (st === 504 || st === 502) out.push(`El backend no obtuvo respuesta del sitio (${m.replace(/^Proxy propio:\s*/, '')}).`);
      else out.push(`Error del backend: ${m}`);
    } else if (src === 'site' && st) {
      out.push(SITE_MSG[st] || (st >= 500 ? `La fuente tuvo un error interno (HTTP ${st}).` : `La fuente respondió HTTP ${st}.`));
      if (st === 403 || st === 503) {
        out.push(d.challenge || last.challenge ? 'Respondió con una verificación antibots (Cloudflare u otra).' : 'Suele deberse a una protección antibots o a que el sitio no acepta peticiones desde servidores (IPs de centros de datos como Render).');
        out.push('Manhuua no evade esas protecciones. Si el sitio ofrece una API pública o un catálogo autorizado, agregalo como extensión de API JSON.');
      }
      out.push('No se reintentó: otra vía no cambia la respuesta del sitio.');
    } else {
      const codes = d.attempts?.map((a) => `${a.via}: ${a.error}`).join(' · ');
      out.push(`No hubo respuesta (${codes || d.httpError || 'sin datos'}): el sitio o el backend no está disponible, o el navegador bloqueó la lectura (CORS).`);
    }
    return out;
  }
  if (!d.antibot && d.bytes != null && d.bytes < 400 && !d.spaRoot && !d.scripts && (d.textChars ?? 0) < 20 && !d.render?.bytes) { out.push(`La fuente respondió, pero vacía (${d.bytes} bytes).`); return out; }
  if (d.antibot) { out.push('La página es una verificación antibots/CAPTCHA, no el contenido. Manhuua no la evade: abrí el sitio en el navegador o usá una fuente con API pública.'); return out; }
  if (d.count > 0) {
    if (d.via?.startsWith('renderizado')) out.push(`El HTML estático no tenía ${what}; aparecieron al ejecutar el JavaScript de la página.`);
    if (d.covers === 0) out.push('Se encontraron obras pero ninguna portada: las imágenes se cargan con un atributo o script no reconocido.');
    return out;
  }
  if (d.spaLikely) {
    out.push(`La página se genera con JavaScript (aplicación SPA${d.spaRoot ? `, contenedor ${d.spaRoot}` : ''}): el HTML que entrega el servidor no trae las ${what}.`);
    if (d.embedded?.length) out.push(`Tiene datos embebidos (${d.embedded.join(', ')}) pero no contienen una lista reconocible de ${what}.`);
    if (!renderBase()) out.push('Para estas páginas hace falta el renderizador: ejecutá Manhuua con "npm run serve" (incluye navegador) o configurá la URL de renderizado en Ajustes. Si el sitio tiene una API pública, agregala como extensión de API JSON.');
    else if (d.renderError) out.push(`El renderizador falló: ${d.renderError}.`);
    else if (d.render) out.push(`Se renderizó la página (${d.render.wait?.ms ?? '?'} ms, ${d.render.wait?.reason || ''}) y tampoco aparecieron ${what}.`);
  } else if (d.links > 0 && d.imgs > 0) {
    out.push(`El HTML tiene ${d.imgs} imágenes y ${d.links} enlaces, pero no forman tarjetas de ${what} reconocibles. Probá con la URL del listado/directorio del sitio (no la portada) o una página de búsqueda.`);
  } else if (d.imgs === 0) {
    out.push('El HTML no tiene imágenes: puede ser una página de error, una redirección o contenido cargado por JavaScript.');
  }
  if (d.render?.jsErrors?.length) out.push(`Errores de JavaScript en la página: ${d.render.jsErrors.slice(0, 3).join(' | ')}`);
  if (!out.length) out.push(`No se encontraron ${what} en la página.`);
  return out;
}

/** Estados de una extensión (gestor de extensiones). */
export const STATES = {
  available: 'Disponible', ok: 'Funcionando', blocked: 'Fuente bloqueada', notfound: 'No disponible', limited: 'Limitada',
  conn: 'Error de conexión', incompatible: 'API incompatible', extraction: 'Sin datos reconocibles', disabled: 'Desactivada',
};
/** Tipo de error, para no confundir un bloqueo de la fuente con una falla de Manhuua. */
export const ERROR_KINDS = {
  source: 'error de la fuente', backend: 'error del backend (Render)', cors: 'bloqueo CORS del navegador', network: 'sin conexión / fuente caída',
  extraction: 'error de extracción', incompatible: 'API incompatible', antibot: 'protección antibots',
};
/**
 * Clasifica el diagnóstico de una carga. Devuelve {state, kind, httpStatus, label}.
 * 401/403/451 → fuente bloqueada; 404/410 → no disponible; 429 → limitada; sin respuesta → conexión.
 */
export function classify(d = {}) {
  const fail = [...(d.attempts || [])].reverse().find((a) => !a.ok) || {};
  const ok = d.attempts?.some((a) => a.ok) || d.render?.bytes || d.via === 'catalogo JSON';
  const st = d.httpStatus ?? (ok ? undefined : fail.status);
  const src = d.errorSource || (ok ? undefined : fail.source);
  const out = (state, kind) => ({ state, kind, httpStatus: st, label: STATES[state] + (st && state !== 'ok' && state !== 'incompatible' ? ` (${st})` : '') });
  if (d.incompatible) return out('incompatible', 'incompatible');
  if (!ok) {
    if (src === 'backend') return out('conn', 'backend');
    if (st && src !== 'network') {
      const anti = d.challenge || fail.challenge;
      if ([401, 403, 451].includes(st) || (st === 503 && anti)) return out('blocked', anti ? 'antibot' : 'source');
      if ([404, 410].includes(st)) return out('notfound', 'source');
      if (st === 429) return out('limited', 'source');
      return out('conn', 'source');
    }
    const cors = (d.attempts || []).some((a) => /CORS/.test(a.error || '')) || /CORS/.test(d.httpError || '');
    return out('conn', cors && !(d.attempts || []).some((a) => a.via !== 'directo') ? 'cors' : 'network');
  }
  if (d.antibot) return out('blocked', 'antibot');
  if (!d.count) return out('extraction', 'extraction');
  return out('ok', null);
}
