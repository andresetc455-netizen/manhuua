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

| # | Plataforma | API | Metadatos | Capítulos | Lectura | Estado |
|---|---|---|---|---|---|---|
| 1 | MangaDex | Oficial y documentada | Sí | Sí, por idioma y grupo | Sí (MangaDex@Home por el backend) | **Integrada, verificación real pendiente** |
| 22 | MangaUpdates | Oficial (`api.mangaupdates.com/v1`): en línea, formato JSON confirmado | Sí | No (solo lanzamientos de grupos) | No (no aloja contenido) | **Pendiente de verificación**: términos de uso sin confirmar y búsqueda por POST (requiere una ruta propia en el backend) |
| 15 | WEBTOON | No pública. RSS por serie sin confirmar | RSS | Lista de episodios por RSS | No (imágenes con protección de Referer) | **Pendiente de verificación**, solo metadatos |
| 26 | Royal Road | No pública. RSS por obra sin confirmar | RSS | Lista por RSS | Sin confirmar en los términos | **Pendiente de verificación**, solo metadatos |
| 27 | Scribble Hub | No pública. RSS sin confirmar | RSS | Lista por RSS | Sin confirmar | **Pendiente de verificación**, solo metadatos |
| 23 | Novel Updates | No | HTML (Cloudflare) | Enlaces a terceros | No | **No integrable actualmente**: bloquea la automatización |
| 6 | MANGA Plus | Interna (protobuf), no para terceros | — | — | No | **No integrable**: términos, región, imágenes cifradas. Sus capítulos aparecen en MangaDex como externos y se informan. |
| 16–21 | Tapas, Tappytoon, Lezhin, Pocket Comics, Toomics, Manta | No pública | — | — | No | **No integrables**: pago, DRM o cuenta |
| 24–25 | WuxiaWorld, Webnovel | No pública | — | — | No | **No integrables**: comerciales, de pago |
| 2–5, 8–11, 13–14 | NovelCool, ManhwaWeb, LeerCapítulo, OlympusXYZ, MangaPark, MangaKakalot, MangaBuddy, Bato.to, WeebCentral, MangaReader | No | HTML | HTML | — | **No integrables** como fuentes predefinidas: scans sin licencia. OlympusXYZ además responde 403 a servidores. El usuario puede agregarlas por su cuenta. |
| 7, 12 | MangaSee, ComicK | — | — | — | — | **No integrables**: cerradas en 2025 |

### Qué haría falta para pasar de "pendiente" a "solo metadatos"

1. **MangaUpdates:** confirmar sus condiciones de uso y agregar una ruta del backend (`/mangaupdates/search`, con POST y lista blanca) con un ritmo propio. La ficha se mostraría sin capítulos y con un enlace a la obra.
2. **RSS (WEBTOON, Royal Road, Scribble Hub):** verificar los términos y que el RSS exista. Haría falta un lector RSS en el backend con hosts fijos. Solo lista de capítulos y enlaces al sitio, sin mostrar contenido.

### Modo texto (novelas)

Ninguna fuente de novelas pudo integrarse con lectura autorizada. Por eso no se agregó un lector de texto que hoy no tendría contenido real que mostrar. Queda como trabajo futuro si aparece una API autorizada, por ejemplo una que el usuario controle.
