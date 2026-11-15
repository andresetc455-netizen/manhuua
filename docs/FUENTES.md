# Auditoría de fuentes (etapas 1 y 2)

Fecha: 2026-11-15. Rama `deploy-cf-render`.

## Cómo se hizo y límites de esta auditoría

- **Pruebas reales: no se pudieron ejecutar.** El entorno de desarrollo (nube) no tiene salida de red a ninguno de los 27 dominios. Se probó `curl` contra cada uno y todos dieron conexión rechazada (código 000), incluidos `api.mangadex.org` y `api.mangaupdates.com`. Por eso **ninguna fuente se declara "funcional en producción"**: lo que figura como integrado está probado contra servidores simulados que reproducen el formato documentado. La prueba real la tiene que hacer el usuario desde la app publicada.
- Fuentes consultadas:
  - Documentación oficial de MangaDex (`api.mangadex.org/docs`: límites, MangaDex@Home, portadas, política de uso).
  - Noticias públicas sobre cierres de sitios: MangaSee/MangaLife en enero de 2025 y ComicK en 2025.
  - Conocimiento previo del funcionamiento público de cada plataforma.
  - Lo que no se pudo verificar en una fuente oficial está marcado como **sin verificar**.
- **Criterio del proyecto, que se mantiene:**
  - No se integran como fuentes predefinidas los sitios que publican scans sin licencia. Ya se había rechazado precargarlos.
  - No se evaden CAPTCHA, DRM, muros de pago, inicio de sesión ni protecciones antibots.
  - El usuario puede seguir agregando por su cuenta cualquier URL con el motor genérico (HTML/JSON), con las mismas protecciones de siempre.

## Clasificación

| Código | Significado |
|---|---|
| A | Integración completa autorizada (API oficial con lectura permitida) |
| B | Integración parcial |
| C | Solo catálogo y metadatos (sin lectura en la app; enlace a la plataforma) |
| D | API disponible, pero lectura restringida |
| E | Fuente bloqueada (rechaza servidores o automatización) |
| F | No integrable actualmente (licencia, pago/DRM, cierre o términos) |

## Tabla de compatibilidad

| # | Plataforma | API | Catálogo / búsqueda | Capítulos | Lectura en la app | Descargas | Clase | Motivo / limitaciones |
|---|---|---|---|---|---|---|---|---|
| 1 | MangaDex | Oficial, pública y documentada (REST JSON) | Sí (`/manga`) | Sí (`/manga/{id}/feed`) | Sí (MangaDex@Home, vía backend propio) | Sí, para uso personal | **A, integrada** | Exige proxy propio (sin CORS ni hotlinking), User-Agent real, ~5 req/s por IP, at-home 40/min, reportes a MangaDex@Home, crédito a MangaDex y grupos, sin publicidad ni pago. Algunos capítulos son enlaces externos (p. ej. MANGA Plus) y no se leen en la app. |
| 2 | NovelCool | No | HTML | HTML | — | — | F | Agregador de scans/traducciones sin licencia. Disponible solo como URL que agregue el usuario. |
| 3 | ManhwaWeb | No pública (SPA con API interna) | — | — | — | — | F | Scans sin licencia. API interna no documentada ni autorizada. |
| 4 | LeerCapítulo | No | HTML | HTML | — | — | F | Scans sin licencia. |
| 5 | OlympusXYZ | No pública | — | — | — | — | E / F | Responde 403 al backend (bloqueo a IPs de servidor ya observado). Scans sin licencia. |
| 6 | MANGA Plus (Shueisha) | No pública (API interna protobuf) | — | — | — | — | F | Servicio oficial gratuito, pero sin API para terceros. Restricciones regionales, imágenes cifradas por capítulo y términos que no autorizan clientes de terceros. Solo enlace externo; MangaDex ya enlaza sus capítulos oficiales. |
| 7 | MangaSee | — | — | — | — | — | F | Cerró en enero de 2025 (renombrado a WeebCentral). Scans sin licencia. |
| 8 | MangaPark | No | HTML/GraphQL interno | — | — | — | F | Scans sin licencia. |
| 9 | MangaKakalot | No | HTML | HTML | — | — | F | Scans sin licencia. Muchos clones y dominios cambiantes. |
| 10 | MangaBuddy | No | HTML | HTML | — | — | F | Scans sin licencia. |
| 11 | Bato.to | No | HTML | HTML | — | — | F | Scans sin licencia. Dominios espejo cambiantes. |
| 12 | ComicK | API interna (cerrada) | — | — | — | — | F | Cerró el servicio de lectura en 2025 (anunciado como seguimiento "legal"). API no documentada. |
| 13 | WeebCentral | No | HTML (htmx) | HTML | — | — | F | Sucesor de MangaSee, scans sin licencia. |
| 14 | MangaReader | No | HTML | HTML | — | — | F | Scans sin licencia. Imágenes ofuscadas. |
| 15 | WEBTOON | No pública. Hay RSS oficial por serie (**sin verificar** que siga vigente) | — | Lista de episodios por RSS | No | No | C (pendiente) | Imágenes protegidas por Referer (hotlink) y términos que prohíben la extracción. Como mucho, metadatos y enlace al episodio oficial. No se integró por no poder verificarlo. |
| 16 | Tapas | No pública | — | — | No | No | F | Contenido con pago/monedas e inicio de sesión. |
| 17 | Tappytoon | No pública | — | — | No | No | F | Pago, DRM y restricciones regionales. |
| 18 | Lezhin Comics | No pública | — | — | No | No | F | Pago, inicio de sesión y contenido adulto con verificación. |
| 19 | Pocket Comics | No pública | — | — | No | No | F | Pago, monedas e inicio de sesión. |
| 20 | Toomics | No pública | — | — | No | No | F | Suscripción y contenido adulto con verificación. |
| 21 | Manta | No pública (app con suscripción) | — | — | No | No | F | Suscripción y DRM. |
| 22 | MangaUpdates | Oficial, pública y documentada (`api.mangaupdates.com/v1`, OpenAPI) | Sí (búsqueda POST) | Solo novedades de grupos (no contenido) | No (no aloja capítulos) | No | C (recomendada, no integrada) | Base de datos de metadatos. Útil para unificar fichas; no aloja lectura. Pendiente por alcance: la búsqueda es POST y el backend solo hace GET. |
| 23 | Novel Updates | No | HTML (protegido por Cloudflare) | Enlaces a sitios de traductores | No | No | E / C | Índice de novelas que enlaza a terceros. Bloquea automatización. |
| 24 | WuxiaWorld | No pública | — | — | No | No | F | Comercial (suscripción y capítulos pagos). |
| 25 | Webnovel | No pública | — | — | No | No | F | Comercial (monedas y app). Bloquea automatización. |
| 26 | Royal Road | No pública. RSS oficial por obra (**sin verificar**) | — | Lista de capítulos (RSS) | **Sin verificar** que los términos permitan mostrar el texto en otra app | No | C (pendiente) | Obras gratuitas de autores; el derecho es de cada autor. Sin confirmar términos, solo metadatos y enlace. |
| 27 | Scribble Hub | No pública. RSS por serie (**sin verificar**) | — | Lista de capítulos (RSS) | **Sin verificar** | No | C (pendiente) | Igual que Royal Road. |

### Resumen

- **Integrada con lectura autorizada:** MangaDex (1).
- **Candidatas a solo metadatos, sin integrar** porque no se pudieron verificar en este entorno: MangaUpdates, WEBTOON, Royal Road, Scribble Hub y Novel Updates.
- **No integrables** por licencia, pago, DRM, cierre o bloqueo: las 21 restantes.

Ninguna se deja como fuente predefinida. El motor genérico sigue permitiendo que el usuario agregue sitios y manifiestos JSON por su cuenta, bajo su responsabilidad y con todas las protecciones (hosts autorizados, SSRF, redirecciones validadas, sin proxies públicos para JSON).

### Modo texto (novelas)

Ninguna fuente de novelas pudo integrarse con lectura autorizada. Por eso no se agregó un lector de texto que hoy no tendría contenido real que mostrar. Queda como trabajo futuro si aparece una API autorizada, por ejemplo una que el usuario controle.
