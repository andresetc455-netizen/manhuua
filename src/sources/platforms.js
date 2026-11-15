// Directorio de las 25 plataformas auditadas (docs/FUENTES.md). No hace pedidos: solo describe
// cada plataforma, su clasificación y su dominio oficial, para:
//  - mostrarlas en Extensiones con su estado (integrada, solo metadatos, lectura externa…);
//  - reconocer los enlaces oficiales que informa MangaDex (attributes.links) y rotularlos.
// Clasificación: A = integración completa autorizada · B = catálogo y metadatos autorizados ·
// C = enlaces externos a la lectura oficial · D = no integrable actualmente.
// Nada de esto descarga ni muestra contenido de esas plataformas.

export const PLATFORMS = [
  { id: 'mangadex', name: 'MangaDex', url: 'https://mangadex.org', hosts: ['mangadex.org'], cls: 'A', state: 'native', langs: 'Multilingüe (incluye es-la y es)', note: 'API oficial y pública. Integrada: catálogo, fichas, capítulos y lectura por MangaDex@Home a través del backend.' },
  { id: 'mangaplus', name: 'MANGA Plus', url: 'https://mangaplus.shueisha.co.jp', hosts: ['mangaplus.shueisha.co.jp'], cls: 'C', state: 'external', langs: 'Inglés, español y otros', note: 'Sin API pública para terceros; imágenes cifradas y restricciones por región. Sus capítulos aparecen en MangaDex como enlaces externos.' },
  { id: 'viz', name: 'VIZ', url: 'https://www.viz.com', hosts: ['viz.com'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Lectura con suscripción y restringida por región. Sin API pública.' },
  { id: 'kmanga', name: 'K MANGA', url: 'https://kmanga.kodansha.com', hosts: ['kmanga.kodansha.com'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Servicio de pago de Kodansha, disponible solo en algunas regiones. Sin API pública.' },
  { id: 'webtoon', name: 'WEBTOON', url: 'https://www.webtoons.com', hosts: ['webtoons.com'], cls: 'C', state: 'external', langs: 'Inglés, español y otros', note: 'Sin API pública. Sus términos prohíben el scraping y la recopilación automatizada (sección 6).' },
  { id: 'tapas', name: 'Tapas', url: 'https://tapas.io', hosts: ['tapas.io'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Sin API pública. Episodios con monedas o espera.' },
  { id: 'tappytoon', name: 'Tappytoon', url: 'https://www.tappytoon.com', hosts: ['tappytoon.com'], cls: 'C', state: 'external', langs: 'Inglés, francés, alemán', note: 'Servicio de pago con cuenta. Sin API pública.' },
  { id: 'lezhin', name: 'Lezhin Comics', url: 'https://www.lezhinus.com', hosts: ['lezhinus.com', 'lezhin.com'], cls: 'C', state: 'external', langs: 'Inglés (y coreano, japonés en sus sitios)', note: 'Servicio de pago con cuenta. Sin API pública.' },
  { id: 'manta', name: 'Manta', url: 'https://manta.net', hosts: ['manta.net'], cls: 'C', state: 'external', langs: 'Inglés y otros', note: 'Suscripción. Sin API pública.' },
  { id: 'toomics', name: 'Toomics', url: 'https://toomics.com', hosts: ['toomics.com'], cls: 'C', state: 'external', langs: 'Inglés, español y otros', note: 'Servicio de pago con cuenta. Sin API pública.' },
  { id: 'comikey', name: 'Comikey', url: 'https://comikey.com', hosts: ['comikey.com'], cls: 'C', state: 'external', langs: 'Inglés, español y otros', note: 'Lectura con cuenta y capítulos de pago. Sin API pública. Sus capítulos pueden aparecer en MangaDex como enlaces externos.' },
  { id: 'inkr', name: 'INKR', url: 'https://inkr.com', hosts: ['inkr.com'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Sin API pública. Lectura con cuenta y pago.' },
  { id: 'webcomics', name: 'WebComics', url: 'https://www.webcomicsapp.com', hosts: ['webcomicsapp.com'], cls: 'C', state: 'external', langs: 'Inglés y otros', note: 'Aplicación de pago. Sin API pública.' },
  { id: 'coolmic', name: 'Coolmic', url: 'https://coolmic.me', hosts: ['coolmic.me'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Servicio de pago con cuenta. Sin API pública.' },
  { id: 'sevenseas', name: 'Seven Seas', url: 'https://sevenseasentertainment.com', hosts: ['sevenseasentertainment.com'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Editorial: no ofrece lectura en línea; vende en tiendas. Sin API pública.' },
  { id: 'yenpress', name: 'Yen Press', url: 'https://yenpress.com', hosts: ['yenpress.com'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Editorial: venta en tiendas y su propia app. Sin API pública.' },
  { id: 'izepress', name: 'Ize Press', url: 'https://izepress.com', hosts: ['izepress.com'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Sello de Yen Press para manhwa. Sin API pública.' },
  { id: 'jnovel', name: 'J-Novel Club', url: 'https://j-novel.club', hosts: ['j-novel.club'], cls: 'C', state: 'external', langs: 'Inglés', note: 'Su API interna exige iniciar sesión con una suscripción; Manhuua no guarda credenciales de terceros.' },
  { id: 'mangaupdates', name: 'MangaUpdates', url: 'https://www.mangaupdates.com', hosts: ['mangaupdates.com'], cls: 'B', state: 'native', langs: 'Fichas en inglés (títulos en varios idiomas)', note: 'API pública v1. Integrada solo para metadatos: no aloja capítulos.' },
  { id: 'naverwebtoon', name: 'Naver Webtoon', url: 'https://comic.naver.com', hosts: ['comic.naver.com'], cls: 'C', state: 'external', langs: 'Coreano', note: 'Sin API pública. Servicio coreano.' },
  { id: 'naverseries', name: 'Naver Series', url: 'https://series.naver.com', hosts: ['series.naver.com'], cls: 'C', state: 'external', langs: 'Coreano', note: 'Servicio de pago con cuenta. Sin API pública.' },
  { id: 'kakaopage', name: 'KakaoPage', url: 'https://page.kakao.com', hosts: ['page.kakao.com'], cls: 'C', state: 'external', langs: 'Coreano', note: 'Servicio de pago con cuenta. Sin API pública.' },
  { id: 'kakaowebtoon', name: 'Kakao Webtoon', url: 'https://webtoon.kakao.com', hosts: ['webtoon.kakao.com'], cls: 'C', state: 'external', langs: 'Coreano (y otros en sus sitios regionales)', note: 'Sin API pública.' },
  { id: 'piccoma', name: 'Piccoma', url: 'https://piccoma.com', hosts: ['piccoma.com'], cls: 'C', state: 'external', langs: 'Japonés, francés', note: 'Servicio de pago restringido por región. Sin API pública.' },
  { id: 'kuaikan', name: 'KuaiKan Manhua', url: 'https://www.kuaikanmanhua.com', hosts: ['kuaikanmanhua.com'], cls: 'C', state: 'external', langs: 'Chino', note: 'Sin API pública. Servicio chino, restringido por región.' },
];

export const CLASS_LABEL = { A: 'Integración completa', B: 'Solo metadatos', C: 'Lectura externa', D: 'No integrable' };

/** Plataforma conocida a la que pertenece una URL (por dominio o subdominio), o undefined. */
export function platformOf(url) {
  let h; try { h = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return undefined; }
  return PLATFORMS.find((p) => p.hosts.some((d) => h === d || h.endsWith('.' + d)));
}

/**
 * Enlaces de lectura oficial de una obra a partir de los enlaces que publica MangaDex
 * (attributes.links: "engtl" = traducción oficial en inglés, "raw" = original). Solo HTTPS.
 */
export function officialLinks(links = {}) {
  const out = [];
  for (const [k, kind] of [['engtl', 'traducción oficial'], ['raw', 'edición original']]) {
    const v = links?.[k];
    if (typeof v !== 'string') continue;
    let u; try { u = new URL(v); } catch { continue; }
    if (u.protocol !== 'https:' || u.username || u.password) continue;
    const p = platformOf(u.href);
    if (!out.some((o) => o.url === u.href)) out.push({ url: u.href, kind, platform: p?.name || u.hostname.replace(/^www\./, '') });
  }
  return out;
}
