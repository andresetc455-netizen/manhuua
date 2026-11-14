// Renderizador opcional: abre la página en Chromium (Playwright), espera a que el contenido
// aparezca de verdad (condición + DOM estable, no tiempos fijos) y devuelve el HTML resultante.
// Requiere:  npm i playwright  &&  npx playwright install chromium
// No evade CAPTCHA ni protecciones antibots: si las detecta, lo informa y se detiene.
import { createRequire } from 'node:module';
import { assertPublicUrl } from './security.mjs';

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
async function browser() {
  if (!browserP) {
    browserP = loadPlaywright()
      .then((pw) => pw.chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] }))
      .then((b) => { b.on('disconnected', () => { browserP = null; }); return b; })
      .catch((e) => { browserP = null; throw e; });
  }
  return browserP;
}
/** ¿Está Playwright instalado? (no abre el navegador). */
export async function renderAvailable() { try { await loadPlaywright(); return true; } catch { return false; } }
export async function closeBrowser() { if (browserP) await (await browserP.catch(() => null))?.close().catch(() => {}); browserP = null; }

const HEAVY = new Set(['image', 'media', 'font']);

export async function render(url, kind = 'catalog', { maxMs = 20000, allowPrivate = true } = {}) {
  const b = await browser();
  const ctx = await b.newContext({ userAgent: UA, locale: 'es-ES', viewport: { width: 1280, height: 1600 }, serviceWorkers: 'block' });
  // Solo hace falta el HTML: no descarga imágenes/video/fuentes (ahorra memoria y red) y, en
  // producción, no deja que la página pida direcciones internas.
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    if (HEAVY.has(req.resourceType())) return route.abort();
    if (!allowPrivate) { try { await assertPublicUrl(req.url()); } catch { return route.abort('blockedbyclient'); } }
    return route.continue();
  });
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
