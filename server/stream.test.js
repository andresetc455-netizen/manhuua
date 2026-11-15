// @vitest-environment node
// Proxy: transmisión sin guardar la respuesta entera en memoria, tope de tamaño durante la
// transmisión, corte si el sitio deja de enviar y concurrencia global acotada (503 + Retry-After).
import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';

describe('proxy: transporte de imágenes', () => {
  let srv, port, proc, pport;
  const IMG = Buffer.alloc(300_000, 7);
  const start = () => new Promise((res) => {
    srv = http.createServer((q, r) => {
      if (q.url === '/img') { r.writeHead(200, { 'content-type': 'image/png' }); return r.end(IMG); }
      if (q.url === '/big') { r.writeHead(200, { 'content-type': 'image/png' }); let k = 0; const t = setInterval(() => { r.write(Buffer.alloc(256 * 1024, 1)); if (++k === 12) { clearInterval(t); r.end(); } }, 5); return; }
      if (q.url === '/slow') { r.writeHead(200, { 'content-type': 'image/png' }); r.write(Buffer.alloc(1000)); return; } // queda colgado
      r.writeHead(404); r.end();
    }).listen(0, '127.0.0.1', () => { port = srv.address().port; res(); });
  });
  const startProxy = (env) => new Promise((res) => {
    pport = 20000 + Math.floor(Math.random() * 20000);
    proc = spawn(process.execPath, ['server/proxy.mjs'], { env: { ...process.env, PORT: String(pport), SERVE_STATIC: 'false', ALLOW_PRIVATE: 'true', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => /backend en/.test(String(d)) && res());
  });
  afterAll(() => { srv?.close(); proc?.kill(); });
  const url = (p) => `http://127.0.0.1:${pport}/proxy?url=${encodeURIComponent(`http://127.0.0.1:${port}${p}`)}`;

  it('imagen completa e idéntica, con x-final-url', async () => {
    await start(); await startProxy({ MAX_BYTES: '1000000', FETCH_TIMEOUT_MS: '1500', PROXY_CONCURRENCY: '1', PROXY_QUEUE: '0' });
    const r = await fetch(url('/img'));
    expect(r.status).toBe(200);
    expect(r.headers.get('x-final-url')).toBe(`http://127.0.0.1:${port}/img`);
    expect(Buffer.from(await r.arrayBuffer()).equals(IMG)).toBe(true);
  }, 20000);
  it('respuesta que supera MAX_BYTES durante la transmisión: se corta', async () => {
    const r = await fetch(url('/big'));
    const got = await r.arrayBuffer().then((b) => b.byteLength, () => -1);
    expect(got).toBeLessThan(3 * 1024 * 1024);
  }, 20000);
  it('sitio que deja de enviar: se corta por tiempo; mientras tanto la concurrencia está llena → 503', async () => {
    const t0 = Date.now();
    const slow = fetch(url('/slow')).then((r) => r.arrayBuffer()).then(() => 'completo', () => 'cortado');
    await new Promise((s) => setTimeout(s, 300));
    const busy = await fetch(url('/img'));
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('5');
    expect(await slow).toBe('cortado');
    expect(Date.now() - t0).toBeLessThan(6000);
    expect((await fetch(url('/img'))).status).toBe(200); // el lugar se libera
  }, 20000);
});
