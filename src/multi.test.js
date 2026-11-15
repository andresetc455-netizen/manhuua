// @vitest-environment happy-dom
// Búsqueda simultánea en muchas fuentes: concurrencia acotada, fuentes independientes y cancelación.
import { describe, it, expect, vi } from 'vitest';

describe('searchAll con muchas fuentes', () => {
  it('25 fuentes: nunca más de 8 a la vez; una que falla no corta las demás; cancelar detiene las pendientes', async () => {
    vi.resetModules();
    let active = 0, peak = 0, started = 0;
    vi.doMock('./sources/extensions.js', () => ({
      recordStatus: () => {},
      browse: async (x) => { started++; active++; peak = Math.max(peak, active); await new Promise((s) => setTimeout(s, 15)); active--; if (x.id === 'f3') throw new Error('caída'); return { items: [{ url: x.id, title: x.id }], diag: { attempts: [{ ok: true }], count: 1 } }; },
    }));
    const { searchAll } = await import('./sources/multi.js');
    const exts = Array.from({ length: 25 }, (_, i) => ({ id: 'f' + i }));
    const res = await searchAll(exts, 'x', null);
    expect(peak).toBeLessThanOrEqual(8);
    expect(res.filter((r) => r.state === 'ok')).toHaveLength(24);
    expect(res.find((r) => r.extId === 'f3').state).toBe('error');
    started = 0;
    const ctl = new AbortController(); const seen = [];
    const p = searchAll(exts, 'y', (r) => seen.push(r), { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 5);
    await p;
    expect(started).toBeLessThanOrEqual(8);
    vi.doUnmock('./sources/extensions.js');
  });

  it('paginación independiente por fuente, sin duplicados, con caché y falla aislada', async () => {
    vi.resetModules();
    const calls = [];
    vi.doMock('./sources/extensions.js', () => ({
      recordStatus: () => {},
      browse: async (x, o) => {
        calls.push(`${x.id}:${o.page}:${o.url || ''}`);
        if (x.id === 'b' && o.page === 2) throw new Error('caída en página 2');
        const items = x.id === 'rep' ? [{ url: 'r1', title: 'R' }] : [{ url: `${x.id}${o.page}a`, title: 'A' }, { url: `${x.id}1a`, title: 'dup' }];
        return { items, next: o.page < 3 ? (x.id === 'a' ? `https://a.test/p${o.page + 1}` : `md:browse/${o.page + 1}`) : null, total: 9, diag: { attempts: [{ ok: true }], count: items.length } };
      },
    }));
    const { searchAll, searchMore, clearSearchCache } = await import('./sources/multi.js');
    const exts = [{ id: 'a' }, { id: 'b' }, { id: 'rep' }];
    const r1 = await searchAll(exts, '', null);
    expect(r1.map((r) => r.items.length)).toEqual([1, 1, 1]); // duplicados dentro de la misma página se quitan;
    const a2 = await searchMore(exts[0], r1[0], '');
    expect(a2.items.map((i) => i.url)).toEqual(['a1a', 'a2a']);
    expect(calls).toContain('a:2:https://a.test/p2'); // URL http de la fuente
    const b2 = await searchMore(exts[1], r1[1], '');
    expect(b2.items).toHaveLength(1); expect(b2.moreError).toMatch(/página 2/); expect(b2.state).toBe('ok');
    const rep2 = await searchMore(exts[2], r1[2], '');
    expect(rep2.next).toBeNull(); // la página no trajo nada nuevo: no se ofrece "más"
    expect(calls.filter((c) => c.startsWith('b:2'))[0]).toBe('b:2:'); // md: no se pasa como url
    const before = calls.length;
    await searchAll(exts, '', null);
    expect(calls.length).toBe(before); // caché
    clearSearchCache();
    await searchAll(exts, '', null);
    expect(calls.length).toBe(before + 3);
    vi.doUnmock('./sources/extensions.js');
  });
});
