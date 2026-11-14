// Proxy CORS para usar Manhuua publicada en GitHub Pages (que no tiene servidor propio).
// Cloudflare (gratis): Workers & Pages → Create → Worker → pegar este código → Deploy.
// Después, en la app: Ajustes → Red → Proxy:  https://TU-WORKER.workers.dev/?url=
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const u = new URL(req.url);
    const target = u.searchParams.get('url') || '';
    if (!/^https?:\/\//i.test(target)) return new Response('manhuua-proxy: parámetro url inválido', { status: 400, headers: CORS });
    const t = new URL(target);
    const r = await fetch(t, { redirect: 'follow', headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'es,en;q=0.8', referer: u.searchParams.get('referer') || t.origin + '/' } });
    const h = new Headers(CORS);
    h.set('content-type', r.headers.get('content-type') || 'application/octet-stream');
    h.set('cache-control', 'public, max-age=1800');
    return new Response(r.body, { status: r.status, headers: h });
  },
};
