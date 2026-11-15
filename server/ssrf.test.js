// @vitest-environment node
// Pruebas de SSRF: clasificación de IPs, lookup con IP fijada (DNS rebinding) y redirecciones.
import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { classifyIp, isPrivateIp, safeLookup, safeRequest, assertPublicUrl, blockedHostname, parseHostPolicy, hostAllowed } from './security.mjs';

const lookupOnce = (lk, host) => new Promise((res) => lk(host, { all: true }, (err, list) => res({ err, list })));

describe('clasificación de direcciones', () => {
  it('IPv4 privadas, loopback, link-local, CGNAT, multicast y reservadas', () => {
    for (const ip of ['10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.1.1', '100.64.0.1', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9'])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.128.0.1', '11.0.0.1']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('IPv6 loopback, no especificada, ULA, link-local, multicast, documentación', () => {
    for (const ip of ['::1', '0:0:0:0:0:0:0:1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1', 'fec0::1', '3fff::1', '100::1'])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['2606:4700:4700::1111', '2a00:1450:4001:81a::200e', '2001:4860:4860::8888']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('IPv4 mapeada en IPv6 en todas sus escrituras', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7F00:0001', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:127.0.0.1', '[::ffff:7f00:1]', '::ffff:a9fe:a9fe', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '::ffff:c0a8:101', '::ffff:8.8.8.8', '::127.0.0.1', '::7f00:1'])
      expect(classifyIp(ip).blocked, ip).toBe(true);
    expect(classifyIp('::ffff:7f00:1').reason).toMatch(/127\.0\.0\.1/);
  });
  it('IPv4 incrustada: NAT64, 6to4 y Teredo', () => {
    expect(isPrivateIp('64:ff9b::7f00:1')).toBe(true);
    expect(isPrivateIp('64:ff9b::a9fe:a9fe')).toBe(true);
    expect(isPrivateIp('64:ff9b::808:808')).toBe(false); // NAT64 de 8.8.8.8: pública
    expect(isPrivateIp('2002:7f00:1::1')).toBe(true);
    expect(isPrivateIp('2002:0808:0808::1')).toBe(true); // 6to4: obsoleto, se bloquea igual
    expect(isPrivateIp('2001:0:4136:e378:8000:63bf:80ff:fffe')).toBe(true); // Teredo → 127.0.0.1
  });
  it('metadatos cloud', () => {
    for (const ip of ['169.254.169.254', '169.254.170.2', '100.100.100.200', '192.0.0.192', 'fd00:ec2::254', '::ffff:169.254.169.254'])
      expect(classifyIp(ip).blocked, ip).toBe(true);
    expect(classifyIp('169.254.169.254').reason).toBe('metadatos cloud');
    for (const h of ['metadata', 'metadata.google.internal', 'instance-data', 'intranet', 'printer.local', 'x.localhost', 'nas.home.arpa', 'db.internal']) expect(blockedHostname(h), h).toBeTruthy();
    expect(blockedHostname('ejemplo.com')).toBe(null);
  });
});

describe('lookup seguro (DNS)', () => {
  it('DNS con varias respuestas: si una es interna se rechaza todo', async () => {
    const lk = safeLookup({ resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }] });
    const r = await lookupOnce(lk, 'mixto.ejemplo');
    expect(r.err?.code).toBe(403);
    expect(r.err.message).toMatch(/10\.0\.0\.7/);
  });
  it('respuestas AAAA mapeadas a IPv4 interna', async () => {
    const lk = safeLookup({ resolver: async () => [{ address: '::ffff:7f00:1', family: 6 }] });
    expect((await lookupOnce(lk, 'rebind.ejemplo')).err?.code).toBe(403);
  });
  it('si el DNS falla no se relaja la seguridad', async () => {
    const lk = safeLookup({ resolver: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } });
    expect((await lookupOnce(lk, 'nada.ejemplo')).err?.code).toBe(502);
    const empty = safeLookup({ resolver: async () => [] });
    expect((await lookupOnce(empty, 'vacio.ejemplo')).err?.code).toBe(502);
  });
  it('cambio de resolución entre validación y conexión: se usa la IP validada (una sola resolución)', async () => {
    let calls = 0;
    const resolver = async () => (++calls === 1 ? [{ address: '203.0.113.200', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
    // 203.0.113.0/24 está bloqueada; para medir la conexión usamos una IP pública de prueba.
    let calls2 = 0;
    const resolver2 = async () => (++calls2 === 1 ? [{ address: '192.88.98.1', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
    let connectedTo = null;
    const p = safeRequest('http://rebind.ejemplo:9/', { resolver: resolver2, timeoutMs: 800 });
    // La conexión a 192.88.98.1 no va a responder (sin red): lo que importa es a dónde intentó conectar.
    await p.catch((e) => { connectedTo = e.address || e.message; });
    expect(calls2).toBe(1);
    expect(String(connectedTo)).not.toMatch(/127\.0\.0\.1/);
    await expect(assertPublicUrl('http://rebind.ejemplo/', { lookup: resolver })).rejects.toMatchObject({ code: 403 });
  });
  it('safeRequest rechaza IPs internas literales y nombres locales sin conectar', async () => {
    for (const u of ['http://127.0.0.1:1/', 'http://[::1]:1/', 'http://[::ffff:7f00:1]:1/', 'http://169.254.169.254/latest/meta-data/', 'http://0x7f000001/', 'http://2130706433/', 'http://localhost/', 'http://metadata.google.internal/'])
      await expect(safeRequest(u, { timeoutMs: 1000 }), u).rejects.toMatchObject({ code: 403 });
    await expect(safeRequest('http://u:p@ejemplo.com/', {})).rejects.toMatchObject({ code: 400 });
    await expect(safeRequest('file:///etc/passwd', {})).rejects.toMatchObject({ code: 400 });
  });
});

describe('servidor real: redirecciones y política de dominios', () => {
  let srv, port, proc, pport;
  const start = () => new Promise((res) => {
    srv = http.createServer((q, r) => {
      if (q.url === '/a-interno') { r.writeHead(302, { location: 'http://127.0.0.1:' + port + '/secreto' }); return r.end(); }
      if (q.url === '/a-mapeada') { r.writeHead(302, { location: 'http://[::ffff:7f00:1]:' + port + '/secreto' }); return r.end(); }
      if (q.url === '/a-metadatos') { r.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return r.end(); }
      if (q.url === '/a-externo') { r.writeHead(302, { location: 'http://otro.ejemplo:' + port + '/x' }); return r.end(); }
      r.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); r.end('{"ok":1}');
    }).listen(0, '127.0.0.1', () => { port = srv.address().port; res(); });
  });
  const startProxy = (env) => new Promise((res) => {
    pport = 20000 + Math.floor(Math.random() * 20000);
    proc = spawn(process.execPath, ['server/proxy.mjs'], { env: { ...process.env, PORT: String(pport), SERVE_STATIC: 'false', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => /backend en/.test(String(d)) && res());
  });
  afterAll(() => { srv?.close(); proc?.kill(); });
  const get = async (q) => { const r = await fetch(`http://127.0.0.1:${pport}/proxy?${new URLSearchParams(q)}`); return { status: r.status, body: await r.text(), final: r.headers.get('x-final-url') }; };

  it('modo producción: destinos internos y redirecciones hacia ellos se bloquean', async () => {
    await start(); await startProxy({ NODE_ENV: 'production' });
    for (const url of [`http://127.0.0.1:${port}/`, `http://[::ffff:7f00:1]:${port}/`, `http://[::1]:${port}/`, 'http://169.254.169.254/', 'http://10.0.0.1/', 'http://localhost:' + port + '/']) {
      const r = await get({ url }); expect(r.status, url).toBe(403); expect(r.body).toMatch(/no permitido/);
    }
  }, 20000);
  it('modo prueba (ALLOW_PRIVATE): redirección a dominio no autorizado se rechaza', async () => {
    proc.kill(); await startProxy({ ALLOW_PRIVATE: 'true' });
    expect((await get({ url: `http://127.0.0.1:${port}/ok` })).status).toBe(200);
    const ext = await get({ url: `http://127.0.0.1:${port}/a-externo`, hosts: `127.0.0.1:${port}` });
    expect(ext.status).toBe(403); expect(ext.body).toMatch(/Redirección a un dominio no autorizado por la extensión \(otro\.ejemplo/);
    expect((await get({ url: `http://127.0.0.1:${port}/ok`, hosts: 'api.ejemplo.com' })).status).toBe(403);
    expect((await get({ url: `http://127.0.0.1:${port}/ok`, hosts: 'com' })).status).toBe(403); // la lista solo restringe
    expect((await get({ url: `http://127.0.0.1:${port}/ok`, hosts: '*' })).status).toBe(400);
    expect((await get({ url: `http://127.0.0.1:${port}/ok`, hosts: `127.0.0.1:${port}` })).status).toBe(200);
  }, 20000);
  it('política de hosts', () => {
    const l = parseHostPolicy('api.a.com, *.img.org, p.a.com:8443');
    expect(hostAllowed('https://api.a.com/x', l)).toBe(true);
    expect(hostAllowed('https://s.img.org/x', l)).toBe(true);
    expect(hostAllowed('https://img.org/x', l)).toBe(false);
    expect(hostAllowed('https://p.a.com/x', l)).toBe(false);
    expect(hostAllowed('https://api.a.com.evil.com/x', l)).toBe(false);
    expect(() => parseHostPolicy('*')).toThrow();
    expect(() => parseHostPolicy('a..com')).toThrow();
  });
});
