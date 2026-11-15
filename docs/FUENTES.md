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
| MangaUpdates | Oficial (`api.mangaupdates.com/v1`). En línea; formato JSON confirmado en `/v1/genres` | Sí | No (solo lanzamientos de grupos) | No (no aloja contenido) | 4 (candidata a 2) | **Pendiente de verificación**: términos de uso sin confirmar; la búsqueda es por POST y requiere una ruta propia en el backend |
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

1. **MangaUpdates:** confirmar sus condiciones de uso y agregar una ruta del backend (`/mangaupdates/search`, con POST y lista blanca) con un ritmo propio. La ficha se mostraría sin capítulos y con un enlace a la obra.
2. **RSS (WEBTOON, Royal Road, Scribble Hub):** verificar los términos y que el RSS exista. Haría falta un lector RSS en el backend con hosts fijos. Solo lista de capítulos y enlaces al sitio, sin mostrar contenido.

### Modo texto (novelas)

Ninguna plataforma de novelas pudo integrarse con lectura autorizada. Por eso el lector de texto funciona con las novelas propias del usuario en TXT o EPUB sin DRM. No muestra capítulos de ninguna plataforma ni simula que existan; el detalle está en [EXTENSIONS.md](EXTENSIONS.md#novelas-propias-txt--epub). Si aparece una fuente autorizada, puede usar el mismo lector.
