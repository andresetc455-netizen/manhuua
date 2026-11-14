// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertPublicUrl, originAllowed, parseOrigins, rateLimiter, limiter, loadConfig } from './security.mjs';

describe('seguridad del backend', () => {
  it('detecta IPs internas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('bloquea destinos internos y esquemas raros', async () => {
    const lookup = async (h) => (h === 'interno.ejemplo' ? [{ address: '10.0.0.5' }] : [{ address: '93.184.216.34' }]);
    await expect(assertPublicUrl('http://127.0.0.1:8080/', { lookup })).rejects.toMatchObject({ code: 403 });
    await expect(assertPublicUrl('http://localhost/', { lookup })).rejects.toMatchObject({ code: 403 });
    await expect(assertPublicUrl('http://interno.ejemplo/', { lookup })).rejects.toMatchObject({ code: 403 });
    await expect(assertPublicUrl('file:///etc/passwd', { lookup })).rejects.toMatchObject({ code: 400 });
    await expect(assertPublicUrl('http://user:pw@sitio.com/', { lookup })).rejects.toMatchObject({ code: 400 });
    await expect(assertPublicUrl('https://sitio.com/x', { lookup })).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl('http://127.0.0.1/', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
  it('valida orígenes con comodín', () => {
    const l = parseOrigins('https://manhuua.pages.dev/, https://*.manhuua.pages.dev');
    expect(originAllowed('https://manhuua.pages.dev', l)).toBe(true);
    expect(originAllowed('https://abc123.manhuua.pages.dev', l)).toBe(true);
    expect(originAllowed('https://evil.com', l)).toBe(false);
    expect(originAllowed('https://manhuua.pages.dev.evil.com', l)).toBe(false);
    expect(originAllowed('https://x.evil.com', [])).toBe(true);
  });
  it('limita peticiones por IP y por minuto', () => {
    let t = 0; const rl = rateLimiter(3, () => t);
    expect([1, 2, 3, 4].map(() => rl('a').ok)).toEqual([true, true, true, false]);
    expect(rl('b').ok).toBe(true);
    t = 60000; expect(rl('a').ok).toBe(true);
  });
  it('cola acotada para el navegador', async () => {
    const run = limiter(1, 1); let release;
    const a = run(() => new Promise((r) => { release = r; }));
    const b = run(async () => 'b');
    await expect(run(async () => 'c')).rejects.toMatchObject({ code: 503 });
    release('a'); expect(await a).toBe('a'); expect(await b).toBe('b');
  });
  it('producción bloquea IPs privadas por defecto', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).allowPrivate).toBe(false);
    expect(loadConfig({}).allowPrivate).toBe(true);
  });
});
