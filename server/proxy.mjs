// Servidor local: sirve la app (dist/) y un proxy CORS en /proxy?url=...&referer=...
// Uso: npm run serve  (PORT=8787 por defecto). Abrilo desde el celular en http://IP-de-tu-PC:8787
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = +process.env.PORT || 8787;
const DIST = path.resolve(import.meta.dirname, '../dist');
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const CORS = { 'access-control-allow-origin': '*' };

async function proxy(u, res) {
  const target = u.searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) { res.writeHead(400, CORS); return res.end('manhuua-proxy: parámetro url inválido'); }
  try {
    const t = new URL(target);
    const r = await fetch(t, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'es,en;q=0.8', referer: u.searchParams.get('referer') || t.origin + '/' },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...CORS, 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'public, max-age=1800' });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, CORS); res.end('manhuua-proxy: ' + e.message);
  }
}

async function serveStatic(u, res) {
  let file = path.join(DIST, decodeURIComponent(u.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html'); }
  catch { file = path.join(DIST, 'index.html'); }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Ejecutá primero: npm run build'); }
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...CORS, 'access-control-allow-headers': '*' }); return res.end(); }
  if (u.pathname.endsWith('/proxy')) return proxy(u, res);
  return serveStatic(u, res);
}).listen(PORT, '0.0.0.0', () => console.log(`Manhuua en http://localhost:${PORT}  (proxy en /proxy?url=)`));
