# Auditoría de fuentes

Fecha: 2026-11-15. Rama `deploy-cf-render`.

## 25 plataformas de manga, manhwa y manhua (tercera revisión)

Clasificación:
- **A:** integración completa autorizada.
- **B:** catálogo y metadatos autorizados.
- **C:** enlaces externos a la lectura oficial.
- **D:** no integrable actualmente.

**Cómo se verificó:**
- Búsquedas web y lectura de las páginas oficiales que se pudieron abrir:
  - términos de WEBTOON;
  - preguntas frecuentes y foro de la API de MangaUpdates;
  - documentación de MangaDex.
- No se pudieron abrir los términos de J-Novel Club, Tapas ni Comikey (error del sitio); para esas se usa lo que se sabe públicamente y se marca como **sin verificar**.
- Desde el entorno de desarrollo **no hay conexión** con ninguna de estas plataformas, así que **ninguna integración se probó contra el servicio real**. Todo lo integrado está probado contra servidores simulados con el formato documentado.

| # | Plataforma | API oficial pública | Términos / acceso | Idiomas | Clase | Qué hace Manhuua |
|---|---|---|---|---|---|---|
| 1 | MangaDex | Sí, documentada | Permite clientes de terceros con atribución, sin publicidad, con límites (~5/s) | Multilingüe | **A** | Integrada: catálogo, búsqueda, fichas, capítulos, lectura, descargas. Muestra los enlaces oficiales de cada obra. Verificación real pendiente. |
| 2 | MANGA Plus | No (API interna en protobuf para su app) | Imágenes cifradas, restricción por región | en, es y otros | **C** | Enlace oficial cuando MangaDex lo informa (sus capítulos externos ya se informan). |
| 3 | VIZ | No | Suscripción, región | en | **C** | Sitio oficial y enlaces de MangaDex. |
| 4 | K MANGA | No | Pago, solo algunas regiones | en | **C** | Sitio oficial. |
| 5 | WEBTOON | No | Sus términos prohíben "crawling", "scraping" y la recopilación automatizada (sección 6(b)(iii), verificado) | en, es y otros | **C** | Enlace oficial (MangaDex informa muchos) y sitio oficial. |
| 6 | Tapas | No (sin verificar) | Monedas o espera; términos sin abrir | en | **C** | Sitio oficial. |
| 7 | Tappytoon | No | Pago con cuenta | en, fr, de | **C** | Sitio oficial. |
| 8 | Lezhin Comics | No | Pago con cuenta | en (ko, ja) | **C** | Sitio oficial. |
| 9 | Manta | No | Suscripción | en y otros | **C** | Sitio oficial. |
| 10 | Toomics | No | Pago con cuenta | en, es y otros | **C** | Sitio oficial. |
| 11 | Comikey | No (sin verificar) | Cuenta y capítulos de pago; términos sin abrir | en, es y otros | **C** | Enlace oficial cuando MangaDex lo informa. |
| 12 | INKR | No | Cuenta y pago | en | **C** | Sitio oficial. |
| 13 | WebComics | No | App de pago | en y otros | **C** | Sitio oficial. |
| 14 | Coolmic | No | Pago con cuenta | en | **C** | Sitio oficial. |
| 15 | Seven Seas | No | Editorial: vende en tiendas, sin lector | en | **C** | Sitio oficial. |
| 16 | Yen Press | No | Editorial: tiendas y app propia | en | **C** | Sitio oficial. |
| 17 | Ize Press | No | Sello de Yen Press | en | **C** | Sitio oficial. |
| 18 | J-Novel Club | API usada por sus apps, con inicio de sesión de suscriptor (sin verificar en sus términos) | Manhuua no guarda contraseñas de terceros | en | **C** | Sitio oficial. Para leer novelas compradas: exportar el EPUB sin DRM e importarlo (lector TXT/EPUB). |
| 19 | MangaUpdates | Sí: API v1 pública (`api.mangaupdates.com`), con esquema publicado | El equipo dice en su foro que el scraping del sitio les molesta pero el uso de la API no; está pensada para backends (sin CORS). No aloja capítulos. Términos formales no encontrados. | Fichas en inglés | **B** | Integrada: búsqueda y fichas, sin capítulos, con enlace a la obra. Verificación real pendiente. |
| 20 | Naver Webtoon | No | Servicio coreano | ko | **C** | Enlace oficial cuando MangaDex lo informa. |
| 21 | Naver Series | No | Pago con cuenta | ko | **C** | Sitio oficial. |
| 22 | KakaoPage | No | Pago con cuenta | ko | **C** | Enlace oficial cuando MangaDex lo informa. |
| 23 | Kakao Webtoon | No | — | ko (y otros) | **C** | Enlace oficial cuando MangaDex lo informa. |
| 24 | Piccoma | No | Pago, restricción por región | ja, fr | **C** | Enlace oficial cuando MangaDex lo informa. |
| 25 | KuaiKan Manhua | No | Servicio chino, restricción por región | zh | **C** | Enlace oficial cuando MangaDex lo informa. |

**Resumen:**
- **A (1):** MangaDex.
- **B (1):** MangaUpdates.
- **C (23):** el resto. Ninguna ofrece una API pública para terceros. Leer su contenido dentro de Manhuua exigiría extraerlo de sus sitios o apps (prohibido o protegido con DRM, pago o cuenta), y eso no se hace.
- **D (0):** ninguna. Todas tienen un sitio oficial al que se puede enviar al usuario.

**Qué hay en la app:**
- **Extensiones → Plataformas oficiales:** las 25, con su clase, estado (Integrada / Solo metadatos / Lectura externa), idiomas, motivo y botón al sitio oficial. Esta lista no hace pedidos a esos sitios.
- **Lectura oficial en la ficha:** MangaDex publica en cada obra los enlaces oficiales (`links.engtl`, traducción oficial; `links.raw`, edición original). La ficha los muestra como botones rotulados con la plataforma (WEBTOON, MANGA Plus, Naver Webtoon…).
  - Solo se aceptan enlaces HTTPS.
  - Se abren en la plataforma; Manhuua no lee su contenido.
- **Unificación por ID:**
  - MangaDex informa los IDs de AniList, MAL y MangaUpdates (`links.al`, `links.mal`, `links.mu`), y MangaUpdates su `series_id`.
  - La misma obra en las dos fuentes se une sola. Una coincidencia de título con IDs distintos no se une.
  - El `mu` viejo (solo dígitos) no se usa, porque es de otra numeración.
  - Los capítulos de cada fuente siguen separados.
- **Estados nuevos de una fuente:** Autenticación requerida (401), API no disponible (5xx de la fuente), Solo metadatos, Lectura externa, No autorizada. Se suman a Funcionando, Fuente bloqueada, Limitada, No disponible, Error de conexión y Desactivada.
- **Filtro "Webtoon"** en Explorar: obras con formato de tira vertical (etiqueta "Long Strip" de MangaDex).

**Qué haría falta para subir de clase:**
- **C → A o B:** una API pública para terceros o un permiso escrito de la plataforma. Si llega, se integra como MangaDex o MangaUpdates (backend con lista blanca y ritmo propio).
- **MangaUpdates B, verificada:** probarla desde la app publicada (Extensiones → MangaUpdates → Instalar → Comprobar) y confirmar sus términos formales.

---

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

## Estado por plataforma (actualizado 2026-11-15, segunda revisión)

Estados posibles:
- **Integrada y verificada:** probada contra el servicio real. Hoy no hay ninguna.
- **Integrada, verificación real pendiente:** el código está completo y probado contra un servidor simulado con el formato documentado. Falta probarla contra el servicio real.
- **Solo metadatos:** catálogo y fichas, sin lectura.
- **Pendiente de verificación:** existe una vía oficial (API o RSS), pero no se pudieron confirmar el formato real ni los términos de uso.
- **No integrable actualmente.**

### Intentos de verificación real (2026-11-15)

| Destino | Desde el contenedor (`curl`) | Desde la herramienta de lectura web |
|---|---|---|
| `api.mangadex.org` (`/manga`, `/manga/tag`, `/author`) | sin conexión | rechazado (error del cliente). No se obtuvo ninguna respuesta. |
| `api.mangaupdates.com/v1/` y `/v1/genres` | sin conexión | **200 OK**. `{"status":"success","reason":"MangaUpdates API v1 is ONLINE"}`; `/genres` devuelve una lista JSON de objetos `{id, genre, description, stats, demographic}`. No publica términos de uso en esa respuesta. |
| `royalroad.com/syndication/…`, sus términos | sin conexión | rechazado |
| `scribblehub.com/rssfeed.php…` | sin conexión | rechazado |
| WEBTOON, Novel Updates y el resto | sin conexión | no se intentó (sin API pública) |

**Conclusión:** ninguna prueba de lectura real fue posible. La de MangaDex queda para hacerla en la app publicada; los pasos están en [MANGADEX.md](MANGADEX.md).

### Tabla

Clasificación:
1. Integrable con lectura autorizada.
2. Integrable solo para metadatos.
3. No integrable: restricciones legales, técnicas o DRM, o falta de acceso autorizado.
4. Pendiente de verificar.

| Plataforma | API | Metadatos | Capítulos | Lectura | Clasificación | Estado |
|---|---|---|---|---|---|---|
| MangaDex | Oficial y documentada | Sí | Sí, por idioma y grupo | Sí (MangaDex@Home por el backend) | 1 | **Integrada, verificación real pendiente** (probada solo contra un servidor simulado) |
| Novelas propias (TXT/EPUB sin DRM) | No aplica (archivos del usuario) | Título y autor del EPUB | Sí | Sí, lector de texto | 1 | **Integrada y verificada localmente** (sin red) |
| MangaUpdates | Oficial (`api.mangaupdates.com/v1`). En línea; formato JSON confirmado en `/v1/genres` | Sí | No (solo lanzamientos de grupos) | No (no aloja contenido) | 2 | **Solo metadatos, integrada** (ruta propia en el backend); verificación real pendiente; términos formales no encontrados |
| WEBTOON | No pública. RSS por serie sin confirmar | RSS | Lista por RSS | No (imágenes con protección de Referer) | 4 (candidata a 2) | **Pendiente de verificación** |
| Royal Road | No pública. RSS por obra sin confirmar | RSS | Lista por RSS | Sin confirmar en los términos | 4 (candidata a 2) | **Pendiente de verificación** |
| Scribble Hub | No pública. RSS sin confirmar | RSS | Lista por RSS | Sin confirmar | 4 (candidata a 2) | **Pendiente de verificación** |
| Novel Updates | No | HTML detrás de Cloudflare | Enlaces a terceros | No | 3 | **No integrable actualmente**: bloquea la automatización |
| MANGA Plus | Interna (protobuf), no para terceros | — | — | No | 3 | **No integrable**: términos, región, imágenes cifradas. Sus capítulos aparecen en MangaDex como externos y se informan. |
| Tapas, Tappytoon, Lezhin, Pocket Comics, Toomics, Manta | No pública | — | — | No | 3 | **No integrables**: pago, DRM o cuenta |
| WuxiaWorld, Webnovel | No pública | — | — | No | 3 | **No integrables**: comerciales y de pago |
| NovelCool, ManhwaWeb, LeerCapítulo, OlympusXYZ, MangaPark, MangaKakalot, MangaBuddy, Bato.to, WeebCentral, MangaReader | No | HTML | HTML | — | 3 | **No integrables** como fuentes predefinidas: scans sin licencia. OlympusXYZ además responde 403 a servidores. El usuario puede agregarlas por su cuenta. |
| MangaSee, ComicK | — | — | — | — | 3 | **No integrables**: cerradas en 2025 |

No se agregó ninguna API ni endpoint que no esté documentado. Las plataformas de clasificación 4 no se integraron, ni siquiera como "solo metadatos", porque no se pudieron confirmar su formato real ni sus términos.

### Qué haría falta para pasar de "pendiente" a "solo metadatos"

1. **MangaUpdates:** ya integrada (rutas `/mangaupdates/*`). Falta la verificación real y confirmar sus términos formales.
2. **RSS (WEBTOON, Royal Road, Scribble Hub):** verificar los términos y que el RSS exista. Haría falta un lector RSS en el backend con hosts fijos. Solo lista de capítulos y enlaces al sitio, sin mostrar contenido.

### Modo texto (novelas)

Ninguna plataforma de novelas pudo integrarse con lectura autorizada. Por eso el lector de texto funciona con las novelas propias del usuario en TXT o EPUB sin DRM. No muestra capítulos de ninguna plataforma ni simula que existan; el detalle está en [EXTENSIONS.md](EXTENSIONS.md#novelas-propias-txt--epub). Si aparece una fuente autorizada, puede usar el mismo lector.
