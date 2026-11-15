// Renderizador opcional: abre la página en Chromium (Playwright), espera a que el contenido
// aparezca de verdad (condición + DOM estable, no tiempos fijos) y devuelve el HTML resultante.
// Requiere:  npm i playwright  &&  npx playwright install chromium
// No evade CAPTCHA ni protecciones antibots: si las detecta, lo informa y se detiene.
import { createRequire } from 'node:module';
import { safeRequest, readLimited } from './security.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ANTIBOT = /just a moment|attention required|captcha|verify you are human|checking your browser|ddos-guard/i;
let browserP = null;

async function loadPlaywright() {
  try { return await import('playwright'); }
  catch {
    try { return createRequire(import.meta.url)('playwright'); }
    catch { throw Object.assign(new Error('Renderizador no disponible: instalá Playwright con "npm i playwright && npx playwright install chromium"'), { code: 501 }); }
  }
}
// Con direcciones internas bloqueadas, Chromium no sale a la red por su cuenta: cada petición HTTP(S)
// la hace el servidor con la IP validada (safeRequest) y se entrega con route.fulfill. Todo lo que no
// pase por esa ruta (WebSocket, conexiones anticipadas, WebRTC) queda sin salida: proxy inexistente,
// sin precarga DNS y WebRTC sin UDP directo.
const LOCKDOWN = ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--dns-prefetch-disable', '--disable-features=NetworkPrediction,DnsOverHttps', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp'];
let lockedDown = null;
async function browser(allowPrivate) {
  if (browserP && lockedDown !== !allowPrivate) { await closeBrowser(); }
  if (!browserP) {
    lockedDown = !allowPrivate;
    browserP = loadPlaywright()
      .then((pw) => pw.chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', ...(allowPrivate ? [] : LOCKDOWN)] }))
      .then((b) => { b.on('disconnected', () => { browserP = null; }); return b; })
      .catch((e) => { browserP = null; throw e; });
  }
  return browserP;
}
/** ¿Está Playwright instalado? (no abre el navegador). */
export async function renderAvailable() { try { await loadPlaywright(); return true; } catch { return false; } }
export async function closeBrowser() { if (browserP) await (await browserP.catch(() => null))?.close().catch(() => {}); browserP = null; }

const HEAVY = new Set(['image', 'media', 'font']);
const MAX_SUB = 15 * 1024 * 1024;
const HOP = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'content-encoding']);

export async function render(url, kind = 'catalog', { maxMs = 20000, allowPrivate = true } = {}) {
  const b = await browser(allowPrivate);
  const ctx = await b.newContext({ userAgent: UA, locale: 'es-ES', viewport: { width: 1280, height: 1600 }, serviceWorkers: 'block' });
  // Solo hace falta el HTML: no descarga imágenes/video/fuentes (ahorra memoria y red) y, en
  // producción, no deja que la página pida direcciones internas.
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    if (HEAVY.has(req.resourceType())) return route.abort();
    if (allowPrivate) return route.continue();
    if (!/^https?:/i.test(req.url())) return route.abort('blockedbyclient');
    try {
      const hdr = Object.fromEntries(Object.entries(await req.allHeaders()).filter(([k]) => !k.startsWith(':') && !['host', 'connection', 'accept-encoding'].includes(k)));
      // Chromium seguiría una redirección entregada con fulfill por fuera de esta ruta (y sin salida,
      // por el proxy inexistente): las redirecciones se siguen acá, validando cada salto.
      let url = req.url(), method = req.method(), body = req.postDataBuffer() || undefined, r;
      for (let hop = 0; ; hop++) {
        r = await safeRequest(url, { method, headers: hdr, body, timeoutMs: Math.min(15000, maxMs), allowPrivate: false });
        const loc = r.status >= 300 && r.status < 400 && r.get('location');
        if (!loc) break;
        r.body.resume();
        if (hop >= 5) throw new Error('Demasiadas redirecciones');
        url = new URL(loc, url).href;
        if (r.status !== 307 && r.status !== 308) { method = 'GET'; body = undefined; }
      }
      let out = await readLimited({ headers: { get: r.get }, body: r.body }, MAX_SUB);
      const headers = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !HOP.has(k)).map(([k, v]) => [k, Array.isArray(v) ? v.join('\n') : String(v)]));
      // Documento redirigido: la página conserva su URL original, así que se fija la base real.
      if (url !== req.url() && req.resourceType() === 'document' && /html/i.test(headers['content-type'] || '')) {
        const base = `<base href="${url.replace(/"/g, '%22')}">`;
        const html = out.toString('utf8');
        out = Buffer.from(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html);
      }
      return route.fulfill({ status: r.status, headers, body: out });
    } catch { return route.abort('blockedbyclient'); }
  });
  if (!allowPrivate) await ctx.routeWebSocket(/.*/, (ws) => ws.close()).catch(() => {});
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && jsErrors.push(m.text().slice(0, 200)));
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: maxMs });
    const status = resp?.status() ?? 0;
    const title = await page.title().catch(() => '');
    if (ANTIBOT.test(title)) return { status, finalUrl: page.url(), html: await page.content(), jsErrors, antibot: true, wait: { reason: 'verificación antibots detectada' } };
    // Espera por condición: suficientes elementos útiles y el DOM sin cambios durante 700 ms.
    const wait = await page.evaluate(({ kind, maxMs }) => new Promise((resolve) => {
      const sel = kind === 'chapter' ? 'img'
        : kind === 'series' ? 'a[href*="cap" i], a[href*="chapter" i], a[href*="episod" i], a[href*="/ep-" i], [class*="chapter" i] a[href], [class*="capitulo" i] a[href]'
        : 'a[href] img, a[href] picture, a[href] [style*="background-image"], [class*="card"] img, article img, li img';
      const min = kind === 'chapter' ? 3 : 2;
      const t0 = performance.now();
      let last = performance.now();
      const mo = new MutationObserver(() => { last = performance.now(); });
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'data-src', 'style', 'class'] });
      let scrolled = 0;
      const tick = () => {
        const n = document.querySelectorAll(sel).length;
        const now = performance.now();
        if (n >= min && now - last > 700) {
          if (scrolled < 2) { scrolled++; window.scrollTo(0, document.body.scrollHeight); last = now; setTimeout(tick, 150); return; } // dispara carga diferida
          mo.disconnect(); resolve({ n, ms: Math.round(now - t0), reason: 'contenido detectado y estable' }); return;
        }
        if (now - t0 > maxMs) { mo.disconnect(); resolve({ n, ms: Math.round(now - t0), reason: n ? 'tiempo máximo (contenido parcial)' : 'tiempo máximo sin contenido' }); return; }
        setTimeout(tick, 150);
      };
      tick();
    }), { kind, maxMs: maxMs - 2000 });
    return { status, finalUrl: page.url(), html: await page.content(), jsErrors, wait };
  } finally { await ctx.close().catch(() => {}); }
}
