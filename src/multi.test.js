// @vitest-environment happy-dom
// Búsqueda simultánea en muchas fuentes: concurrencia acotada, fuentes independientes y cancelación.
import { describe, it, expect, vi } from 'vitest';

describe('searchAll con muchas fuentes', () => {
  it('25 fuentes: nunca más de 4 a la vez; una que falla no corta las demás; cancelar detiene las pendientes', async () => {
    vi.resetModules();
    let active = 0, peak = 0, started = 0;
    vi.doMock('./sources/extensions.js', () => ({
      recordStatus: () => {},
      browse: async (x) => { started++; active++; peak = Math.max(peak, active); await new Promise((s) => setTimeout(s, 15)); active--; if (x.id === 'f3') throw new Error('caída'); return { items: [{ url: x.id, title: x.id }], diag: { attempts: [{ ok: true }], count: 1 } }; },
    }));
    const { searchAll } = await import('./sources/multi.js');
    const exts = Array.from({ length: 25 }, (_, i) => ({ id: 'f' + i }));
    const res = await searchAll(exts, 'x', null);
    expect(peak).toBeLessThanOrEqual(4);
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
});
