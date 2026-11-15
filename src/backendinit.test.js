// @vitest-environment happy-dom
// Inicialización del backend: abrir la app directamente en una ficha o catálogo de MangaDex (por URL o al
// recargar) no debe consultar MangaDex antes de conocer el backend, ni mostrar "necesita el backend" por eso.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MID = '11111111-1111-4111-8111-000000000001';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
let calls;
beforeEach(() => { localStorage.clear(); vi.resetModules(); calls = []; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('con VITE_BACKEND_URL (Cloudflare Pages)', () => {
  beforeEach(() => vi.stubEnv('VITE_BACKEND_URL', 'https://be.test/'));
  it('el proxy propio está activo apenas se carga el módulo, sin esperar a App.jsx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    const web = await import('./sources/web.js');
    const md = await import('./sources/mangadex.js');
    expect(web.activeProxy()).toBe('https://be.test/proxy?url=');
    expect(md.mdBackend()).toBe('https://be.test');
    expect(fetch).not.toHaveBeenCalled(); // nada de detección por red
  });
  it('la primera consulta de una ficha (antes de cualquier efecto) va al backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u) => { calls.push(String(u)); return json({ data: { id: MID, type: 'manga', attributes: { title: { en: 'X' } }, relationships: [] } }); }));
    const md = await import('./sources/mangadex.js');
    await md.mdCall('api', { path: `/manga/${MID}` });
    expect(calls).toEqual([`https://be.test/mangadex/api?path=%2Fmanga%2F${MID}`]);
  });
});

describe('sin VITE_BACKEND_URL (npm run serve o sitio estático)', () => {
  beforeEach(() => vi.stubEnv('VITE_BACKEND_URL', ''));
  it('servidor incluido: la consulta espera la detección y usa el proxy del mismo origen', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async (u) => {
      calls.push(String(u));
      if (String(u) === './proxy?url=') { await gate; return new Response('falta url (manhuua-proxy)', { status: 400 }); }
      return json({ data: [] });
    }));
    const md = await import('./sources/mangadex.js');
    const a = md.mdCall('api', { path: `/manga/${MID}/feed` }), b = md.mdCall('api', { path: '/manga', title: 'x' });
    await Promise.resolve();
    expect(calls).toEqual(['./proxy?url=']); // una sola detección, y MangaDex todavía no se consultó
    release();
    await Promise.all([a, b]);
    expect(calls[0]).toBe('./proxy?url=');
    expect(calls.slice(1).every((u) => u.startsWith('./mangadex/api?'))).toBe(true);
    expect(calls.filter((u) => u === './proxy?url=')).toHaveLength(1);
  });
  it('sin ningún backend: recién después de detectar se informa que hace falta, y se vuelve a intentar luego', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u) => { calls.push(String(u)); return new Response('not found', { status: 404 }); }));
    const md = await import('./sources/mangadex.js');
    await expect(md.mdCall('api', { path: '/manga' })).rejects.toMatchObject({ noBackend: true });
    await expect(md.mdCall('api', { path: '/manga' })).rejects.toMatchObject({ noBackend: true });
    expect(calls).toEqual(['./proxy?url=', './proxy?url=']); // no queda "sin backend" fijado para siempre
  });
  it('un proxy cargado en Ajustes tiene prioridad y no dispara detección', async () => {
    localStorage.setItem('manhuua.settings', JSON.stringify({ proxy: 'https://mio.test/proxy?url=' }));
    vi.stubGlobal('fetch', vi.fn(async (u) => { calls.push(String(u)); return json({ data: [] }); }));
    const md = await import('./sources/mangadex.js');
    await md.mdCall('api', { path: '/manga' });
    expect(calls).toEqual(['https://mio.test/mangadex/api?path=%2Fmanga']);
  });
});
