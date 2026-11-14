// Motor de carga para extensiones: HTML estático → datos embebidos → renderizado (si hay
// servidor de renderizado) y diagnóstico de por qué una página no muestra obras.
import { loadSettings } from '../settings.js';
import { fetchVia } from './web.js';

/* ---------- renderizador (server/render.mjs vía server/proxy.mjs) ---------- */

let autoRender = '';
let detectP = null;
/** Detecta (una sola vez) el renderizador del servidor incluido, si la app se sirve desde él. */
export function detectRender() {
  detectP ??= (async () => {
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
  } catch (e) { diag.httpError = e.message; }

  if (n < min && renderBase() && !diag.antibot) {
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
export function explain(d, what = 'obras') {
  const out = [];
  const ok = d.attempts?.some((a) => a.ok);
  if (!ok && !d.render) {
    const codes = d.attempts?.map((a) => `${a.via}: ${a.error}`).join(' · ');
    out.push(`No se pudo descargar la página (${codes || d.httpError}).`);
    if (d.attempts?.some((a) => a.status === 403 || a.status === 503)) out.push('El sitio rechaza las peticiones (403/503): suele ser una protección antibots o un bloqueo a proxies. Manhuua no evade esas protecciones.');
    return out;
  }
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
