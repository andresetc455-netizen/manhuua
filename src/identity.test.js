// @vitest-environment happy-dom
// Identidad de extensiones JSON (id + dominio), confirmación de cambios sensibles e imágenes estrictas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const man = (over = {}) => ({
  manhuua: 1, id: 'demo', name: 'Demo', version: '1.0.0', baseUrl: 'https://api.demo.test', hosts: ['cdn.demo.test'],
  catalog: { url: '{base}/series?page={page}', list: 'data', fields: { id: 'id', title: 'title' } },
  detail: { url: '{base}/series/{id}' },
  chapters: { url: '{base}/series/{id}/chapters', list: 'data', fields: { id: 'id', number: 'n' } },
  pages: { url: '{base}/pages/{chapterId}', list: 'images[]' },
  ...over,
});

let X;
beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  X = await import('./sources/extensions.js');
});

describe('identidad de extensiones JSON', () => {
  it('dominio normalizado', () => {
    expect(X.normDomain('https://API.Demo.TEST./v1')).toBe('api.demo.test');
    expect(X.normDomain('http://localhost:9920/a')).toBe('localhost:9920');
    expect(X.normDomain('https://a.test:443/')).toBe('a.test');
  });
  it('la identidad incluye el dominio de baseUrl', () => {
    expect(X.identityOf({ manifest: man() })).toBe('manifest:demo@api.demo.test');
    expect(X.identityOf({ manifest: man({ baseUrl: 'https://otro.test' }) })).not.toBe(X.identityOf({ manifest: man() }));
  });
  it('mismo id desde otro dominio: fuente distinta, no reemplaza ni hereda', async () => {
    const a = await X.installManifest(man());
    const b = await X.installManifest(man({ baseUrl: 'https://otro.test' }));
    expect(a.id).toBe('mf-demo');
    expect(b.id).not.toBe(a.id);
    expect(X.getExtension(a.id).url).toBe('https://api.demo.test');
    expect(b.name).toMatch(/otro\.test/);
    // capítulos guardados con la fuente original nunca se resuelven con la homónima
    expect(X.extensionForUrl('mf:demo/c/1', a.id).id).toBe(a.id);
    X.removeExtension(a.id);
    expect(X.extensionForUrl('mf:demo/c/1', a.id)).toBeUndefined();
    // la reinstalación de la homónima no recibe la id eliminada
    X.removeExtension(b.id);
    const b2 = await X.installManifest(man({ baseUrl: 'https://otro.test' }));
    expect(b2.id).toBe(b.id);
    const a2 = await X.installManifest(man());
    expect(a2.id).toBe(a.id);
  });
  it('actualización con cambio de dominio: pide confirmación; cancelar no cambia nada', async () => {
    const a = await X.installManifest(man(), 'https://api.demo.test/m.json');
    const m2 = man({ version: '2.0.0', baseUrl: 'https://nuevo.test', referer: 'https://nuevo.test/' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(m2))));
    const seen = [];
    await expect(X.refreshExtension(a.id, { confirm: (c) => (seen.push(c.changes.map((x) => x.field)), false) })).rejects.toMatchObject({ cancelled: true });
    expect(seen[0]).toEqual(['dominio', 'referer']);
    expect(X.getExtension(a.id).manifest.baseUrl).toBe('https://api.demo.test');
    await expect(X.refreshExtension(a.id)).rejects.toMatchObject({ cancelled: true }); // sin confirmación explícita: no se aplica
    const r = await X.refreshExtension(a.id, { confirm: () => true });
    expect(r.ext.id).toBe(a.id);
    expect(X.getExtension(a.id).manifest.baseUrl).toBe('https://nuevo.test');
  });
  it('mismo dominio: hosts nuevos o referer distinto piden confirmación; versión sola no', async () => {
    const a = await X.installManifest(man());
    const ask = vi.fn(() => false);
    await expect(X.installManifest(man({ hosts: ['cdn.demo.test', 'img.evil.test'] }), undefined, { confirm: ask })).rejects.toMatchObject({ cancelled: true });
    expect(ask.mock.calls[0][0].text).toMatch(/img\.evil\.test/);
    expect(X.getExtension(a.id).manifest.hosts).toEqual(['cdn.demo.test']);
    const v2 = await X.installManifest(man({ version: '1.1.0', hosts: [] }));
    expect(v2.id).toBe(a.id);
    expect(X.getExtension(a.id).version).toBe('1.1.0');
  });
});

describe('imágenes estrictas', () => {
  it('pageBlob usa fetchVia con hosts y rechaza redirecciones no declaradas (sin proxies públicos)', async () => {
    const { pageBlob } = await import('./imgload.js');
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (u, o) => { calls.push([u, o]); const r = new Response(new Blob(['x'], { type: 'image/png' })); Object.defineProperty(r, 'url', { value: 'https://evil.test/p.png' }); return r; }));
    const e = await pageBlob('https://cdn.demo.test/p.png', undefined, ['api.demo.test', 'cdn.demo.test']).catch((x) => x);
    expect(e).toMatchObject({ policy: true, toHost: 'evil.test' });
    expect(calls.every(([u]) => !/corsproxy|allorigins|codetabs/.test(u))).toBe(true);
    expect(calls[0][1]).toEqual({ redirect: 'manual' });
  });
  it('un error del proxy propio por redirección bloqueada llega con el diagnóstico completo', async () => {
    localStorage.setItem('manhuua.settings', JSON.stringify({ proxy: 'https://px.test/proxy?url=' }));
    vi.resetModules();
    const W = await import('./sources/web.js');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('manhuua-proxy: Redirección…', { status: 403, headers: { 'x-manhuua-error': '1', 'x-manhuua-blocked-url': 'https://evil.test/x.png', 'x-manhuua-blocked-reason': 'host' } })));
    const e = await W.fetchVia('https://cdn.demo.test/p.png', 'blob', undefined, undefined, { hosts: ['cdn.demo.test'] }).catch((x) => x);
    expect(e).toMatchObject({ policy: true, from: 'https://cdn.demo.test/p.png', toHost: 'evil.test', suggest: 'evil.test' });
  });
});
