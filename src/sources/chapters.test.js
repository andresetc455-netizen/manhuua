// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { extract } from './web.js';
import { chaptersFromJson, nextJsonPage, finalize, parseDate, seriesMeta, normStatus } from './chapters.js';

const B = 'https://sitio.test';
const ficha = (extra = '') => `<html><head><title>Obra X | Sitio</title><meta property="og:image" content="/covers/x.jpg"><meta property="og:description" content="Sinopsis de X"></head><body>
<h1>Obra X</h1><div class="info"><p><b>Autor:</b> Lin Shu</p><p><b>Estado:</b> En emisión</p></div><div class="genres"><a href="/g/a">Acción</a><a href="/g/f">Fantasía</a></div>
<ul class="chapter-list">${[5, 4, 3, 2, 1].map((n) => `<li><a href="/obra-x/capitulo-${n}">Capítulo ${n}</a><time datetime="2026-01-0${n}">hace ${n} días</time></li>`).join('')}
<li><a href="/obra-x/capitulo-3/">Capítulo 3</a></li></ul>
<a href="/obra-x/capitulo-1">Primer capítulo</a>
${extra}<aside><a href="/otra-obra/capitulo-99">Otra Obra Capítulo 99</a></aside></body></html>`;
const related = `<section>${[1, 2, 3, 4].map((n) => `<a href="/obra-${n}"><img src="/covers/r${n}.jpg"></a>`).join('')}</section>`;

describe('capítulos desde HTML', () => {
  it('una ficha con portadas relacionadas sigue siendo ficha (bug anterior)', () => {
    const r = extract(ficha(related), `${B}/obra-x`);
    expect(r.kind).toBe('series');
    expect(r.images).toEqual([]);
    expect(r.chapters.map((c) => c.number)).toEqual([1, 2, 3, 4, 5]); // ordenados, sin duplicados
    expect(r.chapters.every((c) => c.url.includes('/obra-x/'))).toBe(true); // no mezcla otra obra
    expect(r.chapters[0].date).toBe('2026-01-01');
  });
  it('datos de la obra: autor, estado, géneros, descripción, portada', () => {
    const doc = new DOMParser().parseFromString(ficha(), 'text/html');
    const m = seriesMeta(doc, `${B}/obra-x`);
    expect(m).toMatchObject({ title: 'Obra X', author: 'Lin Shu', status: 'En curso', description: 'Sinopsis de X', cover: `${B}/covers/x.jpg` });
    expect(m.genres).toEqual(['Acción', 'Fantasía']);
  });
  it('un capítulo: imágenes de lectura en orden, sin logo ni portadas enlazadas', () => {
    const html = `<title>Obra X Capítulo 3</title><a href="/"><img src="/img/logo.png"></a><a href="/obra-x/capitulo-2">Capítulo anterior</a>
      <div id="r">${[1, 2, 3, 4].map((p) => `<img data-src="/pages/3/${p}.jpg" src="data:image/gif;base64,R0">`).join('')}</div><a href="/obra-y"><img src="/covers/y.jpg"></a>`;
    const r = extract(html, `${B}/obra-x/capitulo-3`);
    expect(r.kind).toBe('chapter');
    expect(r.number).toBe(3);
    expect(r.images).toEqual([1, 2, 3, 4].map((p) => `${B}/pages/3/${p}.jpg`));
  });
  it('un capítulo con una página servida desde otra carpeta/CDN no la pierde', () => {
    const html = `<title>Obra X Capítulo 4</title><div id="reader"><img src="/p/4/1.jpg"><img src="https://cdn.otro/x/4-2.jpg"><img src="/p/4/3.jpg"><img src="/p/4/4.jpg"></div>`;
    expect(extract(html, `${B}/obra-x/capitulo-4`).images).toEqual([`${B}/p/4/1.jpg`, 'https://cdn.otro/x/4-2.jpg', `${B}/p/4/3.jpg`, `${B}/p/4/4.jpg`]);
  });
  it('una página sin capítulos ni imágenes no inventa nada', () => {
    const r = extract('<h1>Nada</h1><p>texto</p>', `${B}/x`);
    expect(r.kind).toBe('empty');
    expect(r.chapters).toEqual([]);
  });
});

describe('capítulos desde JSON', () => {
  const next = { props: { pageProps: { serie: { title: 'Jade', description: 'Desc', author: [{ name: 'Mei Han' }], status: 'completed', genres: [{ name: 'Fantasía' }],
    chapters: [2, 1, 3].map((n) => ({ number: n, title: `Capítulo ${n}`, url: `/jade/cap-${n}`, publishedAt: `2025-10-0${n}T10:00:00Z` })) } } } };
  it('Next.js: capítulos con URL y fecha, y datos de la obra', () => {
    const html = `<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`;
    const r = extract(html, `${B}/jade`);
    expect(r.kind).toBe('series');
    expect(r.chapters.map((c) => [c.number, c.url, c.date])).toEqual([1, 2, 3].map((n) => [n, `${B}/jade/cap-${n}`, `2025-10-0${n}`]));
    expect(r.chaptersStrategy).toMatch(/Next/);
    expect(r.meta).toMatchObject({ author: 'Mei Han', status: 'Finalizado' });
  });
  it('sin URL en los datos: no se inventan enlaces', () => {
    const d = JSON.parse(JSON.stringify(next)); d.props.pageProps.serie.chapters.forEach((c) => delete c.url);
    const r = chaptersFromJson(d, B);
    expect(r.chapters).toEqual([]);
    expect(r.unresolved).toBe(3);
  });
  it('sin URL pero con slug que aparece en un enlace real de la página: se usa ese enlace', () => {
    const r = chaptersFromJson({ list: [{ number: 1, slug: 'c-1' }, { number: 2, slug: 'c-2' }] }, B, { links: [`${B}/read/c-1`, `${B}/read/c-2`] });
    expect(r.chapters.map((c) => c.url)).toEqual([`${B}/read/c-1`, `${B}/read/c-2`]);
  });
  it('API JSON con paginación', () => {
    const page = { chapters: [{ chapter_number: 1, name: 'Ep 1', read_url: '/c/1', created_at: '2026-03-01' }], next_page_url: '/obra/rey-2.json' };
    expect(chaptersFromJson(page, B).chapters[0]).toMatchObject({ number: 1, url: `${B}/c/1`, date: '2026-03-01' });
    expect(nextJsonPage(page, B)).toBe(`${B}/obra/rey-2.json`);
    expect(nextJsonPage({ next_page_url: null }, B)).toBe(null);
  });
});

describe('utilidades', () => {
  it('ordena y quita duplicados por URL y número', () => {
    const l = finalize([{ url: `${B}/c/2`, number: 2 }, { url: `${B}/c/1/`, number: 1 }, { url: `${B}/c/1`, number: 1 }, { url: `${B}/c/2-bis`, number: 2 }]);
    expect(l.map((c) => c.url)).toEqual([`${B}/c/1/`, `${B}/c/2`]);
  });
  it('sin números respeta el orden de la fuente (más nuevo primero → se invierte)', () => {
    expect(finalize([{ url: 'a', number: 3 }, { url: 'b', number: null }, { url: 'c', number: 1 }]).map((c) => c.url)).toEqual(['c', 'b', 'a']);
  });
  it('interpreta fechas solo si son inequívocas', () => {
    expect(parseDate('2026-02-03T10:00')).toBe('2026-02-03');
    expect(parseDate('3/2/2026')).toBe('2026-02-03');
    expect(parseDate('3 de febrero de 2026')).toBe('2026-02-03');
    expect(parseDate('Feb 3, 2026')).toBe('2026-02-03');
    expect(parseDate('hace 2 días')).toBe(null);
  });
  it('normaliza estados', () => {
    expect(normStatus('ongoing')).toBe('En curso');
    expect(normStatus('Finalizado')).toBe('Finalizado');
    expect(normStatus('hiatus')).toBe('En pausa');
  });
});
