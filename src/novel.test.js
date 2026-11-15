// @vitest-environment happy-dom
// Novelas propias: TXT y EPUB a párrafos de texto plano (sin HTML), capítulos, EPUB con DRM rechazado.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { splitText, htmlToParas, parseEpub, parseNovels, TEXT_TYPE } from './importers.js';

const epub = async ({ drm = false } = {}) => {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  if (drm) z.file('META-INF/encryption.xml', '<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/c1.xhtml"/></CipherData></EncryptedData></encryption>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Mi novela</dc:title><dc:creator>Autora X</dc:creator></metadata>
    <manifest><item id="cov" href="cover.xhtml"/><item id="c1" href="text/c1.xhtml"/><item id="c2" href="text/c2.xhtml"/></manifest><spine><itemref idref="cov"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
  z.file('OEBPS/cover.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="x.jpg"/></body></html>');
  const page = (n) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><style>p{}</style></head><body><h1>Capítulo ${n}</h1><p>Primer párrafo del capítulo ${n}, con <b>negrita</b> y texto suficiente.</p><script>alert(1)</script><p onclick="x()">Segundo &lt;img src=x onerror=alert(1)&gt; párrafo.</p></body></html>`;
  z.file('OEBPS/text/c1.xhtml', page(1)); z.file('OEBPS/text/c2.xhtml', page(2));
  return new File([await z.generateAsync({ type: 'blob' })], 'mi-novela.epub');
};

describe('novelas propias', () => {
  it('TXT: corta por encabezados de capítulo y arma párrafos', () => {
    const c = splitText('Prólogo\n\nHabía una vez.\n\nCapítulo 1\nUno.\n\nDos líneas\nseguidas.\n\nChapter 2\nFin.', 'x');
    expect(c.map((x) => x.title)).toEqual(['Prólogo', 'Capítulo 1', 'Chapter 2']);
    expect(c[1].paras.map((p) => p.t)).toEqual(['Uno.', 'Dos líneas seguidas.']);
  });
  it('TXT sin encabezados: un solo capítulo', () => {
    expect(splitText('a\n\nb', 'Libro')).toEqual([{ title: 'Libro', paras: [{ t: 'a' }, { t: 'b' }] }]);
  });
  it('XHTML → texto plano: sin scripts ni etiquetas', () => {
    const p = htmlToParas('<html xmlns="http://www.w3.org/1999/xhtml"><body><h2>T</h2><p>Hola <i>mundo</i></p><script>evil()</script></body></html>');
    expect(p).toEqual([{ t: 'T', h: 1 }, { t: 'Hola mundo' }]);
  });
  it('EPUB: metadatos, orden del spine, salta la portada y no conserva HTML', async () => {
    const b = await parseEpub(await epub());
    expect(b.title).toBe('Mi novela'); expect(b.author).toBe('Autora X');
    expect(b.chapters.map((c) => c.title)).toEqual(['Capítulo 1', 'Capítulo 2']);
    expect(b.chapters[0].paras[2].t).toBe('Segundo <img src=x onerror=alert(1)> párrafo.'); // queda como texto, React lo escapa
    expect(JSON.stringify(b)).not.toMatch(/alert\(1\)<\/script>|<b>/);
  });
  it('EPUB con DRM: se rechaza', async () => {
    await expect(parseEpub(await epub({ drm: true }))).rejects.toThrow(/DRM/);
  });
  it('parseNovels: grupos de tipo texto con un Blob JSON por capítulo', async () => {
    const g = await parseNovels([await epub(), new File(['Capítulo 1\nHola.'], 'otra 3.txt')]);
    expect(g.map((x) => [x.series, x.kind, x.number])).toEqual([['Mi novela', 'text', 1], ['Mi novela', 'text', 2], ['otra', 'text', 3]]);
    expect(g[0].pages[0].type).toBe(TEXT_TYPE);
    expect(JSON.parse(await g[0].pages[0].text()).paras[0]).toEqual({ t: 'Capítulo 1', h: 1 });
  });
});
