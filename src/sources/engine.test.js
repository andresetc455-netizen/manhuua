// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { listSeries } from './extensions.js';
import { itemsFromJson, devalue, findLists } from './jsonwalk.js';
import { inspectHtml, explain } from './engine.js';

const BASE = 'https://ejemplo.test/directorio';

describe('extracción de catálogos HTML', () => {
  it('tarjetas clásicas: imagen dentro del enlace', () => {
    const html = '<div class="card"><a href="/serie/a"><img src="/a.jpg" alt="Obra A"></a></div><div class="card"><a href="/serie/b"><img data-src="/b.jpg" alt="Obra B"></a></div>';
    const r = listSeries(html, BASE);
    expect(r.items.map((i) => i.title)).toEqual(['Obra A', 'Obra B']);
    expect(r.items[1].cover).toBe('https://ejemplo.test/b.jpg');
  });
  it('picture/srcset y enlace fuera de la imagen', () => {
    const html = [1, 2, 3].map((i) => `<article><div class="thumb"><picture><source srcset="/c${i}.webp 1x"><img alt=""></picture></div><div class="info"><a href="/serie/${i}">Título ${i}</a></div></article>`).join('');
    const r = listSeries(html, BASE);
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({ title: 'Título 1', cover: 'https://ejemplo.test/c1.webp', url: 'https://ejemplo.test/serie/1' });
  });
  it('descarta logos y enlaces a capítulos', () => {
    const html = '<a href="/"><img src="/logo.png" alt="Sitio"></a><a href="/serie/x/capitulo-3"><img src="/x.jpg" alt="Cap"></a>';
    expect(listSeries(html, BASE).items).toHaveLength(0);
  });
  it('datos embebidos de Next.js cuando el HTML está vacío', () => {
    const data = { props: { pageProps: { list: [{ title: 'Uno', slug: 'uno', thumbnail: { url: '/1.jpg' } }, { title: 'Dos', slug: 'dos', thumbnail: { url: '/2.jpg' } }, { title: 'Tres', slug: 'tres', thumbnail: { url: '/3.jpg' } }] } } };
    const html = `<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
    const r = listSeries(html, BASE, { urlTemplate: 'https://ejemplo.test/obra/{slug}' });
    expect(r.items.map((i) => i.url)).toEqual(['https://ejemplo.test/obra/uno', 'https://ejemplo.test/obra/dos', 'https://ejemplo.test/obra/tres']);
    expect(r.strategy).toMatch(/Next\.js/);
  });
  it('detecta paginación por enlace "siguiente" o parámetro page', () => {
    expect(listSeries('<a rel="next" href="?page=2">2</a>', BASE).next).toBe('https://ejemplo.test/directorio?page=2');
    const html = '<a href="/s/1"><img src="/1.jpg" alt="Obra"></a>';
    expect(listSeries(html, 'https://ejemplo.test/lista?page=3').next).toBe('https://ejemplo.test/lista?page=4');
  });
});

describe('JSON genérico (APIs y datos embebidos)', () => {
  it('encuentra la lista correcta en una respuesta tipo JSON:API', () => {
    const data = { meta: { total: 2 }, data: [{ id: 7, attributes: { title: 'Siete', poster: { url: 'https://cdn/7.jpg' }, slug: 'siete' } }, { id: 8, attributes: { title: 'Ocho', poster: { url: 'https://cdn/8.jpg' }, slug: 'ocho' } }] };
    const r = itemsFromJson(data, 'https://api.test/v1/list', { urlTemplate: 'https://sitio/{slug}' });
    expect(r.items).toEqual([{ url: 'https://sitio/siete', title: 'Siete', cover: 'https://cdn/7.jpg' }, { url: 'https://sitio/ocho', title: 'Ocho', cover: 'https://cdn/8.jpg' }]);
  });
  it('hidrata el formato devalue de Nuxt', () => {
    const raw = [['Reactive', 1], { list: 2 }, [3, 6], { name: 4, cover: 5, url: 9 }, 'Uno', '/1.jpg', { name: 7, cover: 8, url: 10 }, 'Dos', '/2.jpg', '/o/1', '/o/2'];
    const d = devalue(raw);
    expect(d.list[1]).toEqual({ name: 'Dos', cover: '/2.jpg', url: '/o/2' });
    expect(findLists(d)[0].items).toHaveLength(2);
  });
});

describe('diagnóstico', () => {
  it('reconoce una SPA vacía y explica la causa', () => {
    const d = { attempts: [{ ok: true }], count: 0, ...inspectHtml('<html><body><div id="app"></div></body></html>') };
    expect(d.spaLikely).toBe(true);
    expect(explain(d).join(' ')).toMatch(/JavaScript/);
  });
  it('reconoce una verificación antibots', () => {
    const d = { attempts: [{ ok: true }], count: 0, ...inspectHtml('<title>Just a moment...</title><body>Checking your browser</body>') };
    expect(explain(d).join(' ')).toMatch(/antibots/);
  });
  it('informa fallas HTTP', () => {
    expect(explain({ attempts: [{ ok: false, via: 'directo', error: 'HTTP 404', status: 404 }], count: 0 }).join(' ')).toMatch(/404/);
  });
});
