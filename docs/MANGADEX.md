# MangaDex (fuente integrada)

MangaDex está integrada como fuente nativa a través de su API oficial: https://api.mangadex.org/docs/

Se instala desde **Más → Extensiones → Fuentes integradas recomendadas → Instalar**, sin pegar JSON.

## Cómo funciona

```
Navegador ──/mangadex/*──▶ backend Manhuua ──▶ api.mangadex.org
                                     └──▶ uploads.mangadex.org / *.mangadex.network (MangaDex@Home)
```

MangaDex no envía CORS, sirve imágenes equivocadas cuando se enlazan directamente (hotlinking) y exige un proxy con un User-Agent real. Por eso el navegador **nunca** pide nada directamente a MangaDex: todo pasa por el backend propio. Sin backend, la app muestra "MangaDex necesita el backend propio".

### Rutas del backend (`server/mangadex.mjs`)

| Ruta | Qué hace |
|---|---|
| `GET /mangadex/api?path=…&…` | Consulta a la API con rutas en lista blanca: `/manga`, `/manga/{uuid}`, `/manga/{uuid}/feed`, `/manga/tag` y `/author`. También limita los parámetros: nombres, valores, `limit` (≤100, o ≤500 en el feed) y `offset + limit ≤ 10000`. |
| `GET /mangadex/chapter?id=` | Lista de páginas de un capítulo (`hash`, `data`, `dataSaver`). El `baseUrl` no se envía al navegador. |
| `GET /mangadex/page?chapter=&quality=data\|data-saver&file=` | Una página. Ver la validación de MangaDex@Home más abajo. |
| `GET /mangadex/cover?manga=&file=&size=256\|512\|orig` | Portada desde `uploads.mangadex.org/covers/{id}/{archivo}[.256.jpg\|.512.jpg]`. |
| `GET /mangadex/status` | Contadores: peticiones a MangaDex, aciertos de caché, pedidos unidos, 429 recibidos, pausa activa y reportes. |

### Validación de MangaDex@Home (por cada página)

1. El backend obtiene el servidor con `GET /at-home/server/{chapterId}` en la API oficial. La URL de la API es fija en producción.
2. Valida la respuesta:
   - `result: ok`;
   - `baseUrl` con **HTTPS**, sin puerto, sin credenciales ni query, y con host `uploads.mangadex.org` o `*.mangadex.network`;
   - `hash` hexadecimal;
   - nombres de archivo seguros.
3. El archivo pedido tiene que estar en la lista de **ese** capítulo y de esa calidad.
4. La imagen se pide con `safeRequest`, que aplica la protección SSRF de siempre: IP validada al conectar, sin DNS rebinding y sin IPs internas ni de metadatos.
5. **No se siguen redirecciones**, y la respuesta tiene que ser `image/*`.
6. Si falla, se pide **un** servidor nuevo y se reintenta una sola vez, como indica la documentación oficial.
7. Cuando el servidor no es de `mangadex.org`, se envía el reporte obligatorio a `https://api.mangadex.network/report` con `url`, `success`, `cached`, `bytes` y `duration`.

El proxy general (`/proxy`) no se modificó ni se debilitó.

### Límites (reglas oficiales)

- **Ritmo:** hasta 4 peticiones/s a la API (el límite global de MangaDex es ~5/s por IP), con 4 simultáneas y una cola de 60 (si se llena, responde 503). `at-home` está limitado a 38/min (MangaDex permite 40/min).
- **429:** se respeta `X-RateLimit-Retry-After` (o `Retry-After`). Durante la pausa **no se vuelve a consultar** a MangaDex, ni desde el backend ni desde el navegador, que también recuerda la espera.
- **Caché del backend:**
  - catálogo: 2 min;
  - ficha: 10 min;
  - feed: 5 min;
  - géneros: 24 h (y 7 días en el navegador);
  - `at-home`: 10 min (MangaDex garantiza 15);
  - portadas: 6 h en memoria y 7 días en el navegador.
- **Uniones y concurrencia:** los pedidos iguales en curso se unen. El navegador hace como máximo 3 pedidos a la vez a `/mangadex` y cancela los de una búsqueda anterior.
- **User-Agent:** `Manhuua/1.0 (lector personal; +https://manhuua.pages.dev)`. No imita a un navegador y no se envía `Via`.
- **Timeouts:** los de siempre (`FETCH_TIMEOUT_MS`, 20 s). Tope de tamaño: 8 MB por JSON y 15 MB por imagen.

## Datos

- **Catálogo y búsqueda:** `GET /manga` en una sola petición, con `includes[]=cover_art,author,artist`.
  - Admite título, UUID o enlace `mangadex.org/title/…`.
  - Filtros: idioma disponible, tipo (manga, manhwa o manhua, según el idioma original), estado, género o tema y autor (resuelto con `/author`).
  - Orden: última actualización, alfabético, más seguidos o recién agregados.
- **Ficha:** título original, títulos alternativos, descripción en el idioma preferido (sin Markdown), autor, artista, géneros, estado, año, clasificación, idiomas disponibles y portada de 512 px.
- **Capítulos:** `GET /manga/{id}/feed`, paginado de a 500 (si la API no lo acepta, de a 100), con hasta 20 páginas y el filtro `translatedLanguage[]`.
  - Orden por número, con decimales; volumen, idioma y grupo como desempate. Los especiales (sin número o con texto) van al final por fecha.
  - Cada capítulo muestra número, volumen, título, idioma, grupo, fecha e id original.
  - **No se inventan capítulos.** Los que están publicados fuera de MangaDex (`externalUrl`, por ejemplo MANGA Plus) o que no tienen páginas no se ofrecen para leer, y el diagnóstico los informa.
  - **Versiones:** "un grupo por capítulo" (por defecto) deja, por número e idioma, la del grupo con más capítulos. "Todas" conserva cada grupo e idioma, siempre con su origen visible. Los capítulos sin número nunca se tratan como duplicados.
- **Lectura:** el lector de siempre (vertical o paginado, carga diferida, precarga, anterior/siguiente, progreso, historial, reintento por página).
  - Las páginas se guardan como `md:page/{capítulo}/{calidad}/{archivo}`. La URL de MangaDex@Home caduca y la resuelve el backend en cada pedido.
- **Descargas y lectura sin conexión:** iguales a las del resto de las fuentes.

## Opciones (Más → Extensiones → MangaDex)

- **Idioma de lectura:** por defecto `es-la` y `es`. También se puede elegir por obra en la ficha.
- **Calidad:** comprimida (`data-saver`, por defecto) u original (`data`).
- **Versiones:** un grupo por capítulo, o todas.
- **Orden:** por número o por fecha.
- **Contenido erótico (+18):** apagado por defecto. El contenido `pornographic` **nunca** se pide: el backend lo quita de las consultas, lo filtra de las listas y responde 451 si se abre una obra con esa clasificación.

## Política de uso de MangaDex

- Se da crédito a MangaDex y a los grupos de traducción en el catálogo, la ficha, cada capítulo y el lector.
- Manhuua no tiene publicidad ni servicios pagos.
- No usa cuenta ni guarda credenciales de MangaDex.
- No evade límites ni bloqueos: ante un 403 o un 429 informa el motivo y espera.
- Si un grupo pide retirar su trabajo, MangaDex lo quita y Manhuua deja de mostrarlo, porque no guarda copias en el servidor.

## Pruebas

- **Simuladas** (no hay salida de red a MangaDex desde el entorno de desarrollo):
  - Unitarias: `server/mangadex.test.js` y `src/mangadex.test.js`.
  - De punta a punta, con un MangaDex simulado y el backend real en modo de prueba.
- **Modo de prueba del backend:** solo con `ALLOW_PRIVATE=true`, que **nunca** está activo en Render (`NODE_ENV=production`). Variables:
  - `MD_API_BASE`, `MD_UPLOADS_BASE` y `MD_REPORT_URL`: dirigen las consultas a un servidor simulado;
  - `MD_TEST_HOSTS`: agrega servidores de imágenes de prueba.
  - En producción se ignoran.
- **Reales:** no se pudieron ejecutar desde el entorno de desarrollo. Hay que comprobarlo en la app publicada:
  1. Instalar MangaDex en Extensiones y tocar "Comprobar".
  2. Buscar una obra.
  3. Abrir un capítulo.

## Estado de la verificación real (2026-11-15)

**Pendiente.** Ni el contenedor de desarrollo ni la herramienta de lectura web pudieron llegar a `api.mangadex.org`. El detalle está en [FUENTES.md](FUENTES.md).

El código depende de estos campos de la API v5, tomados de la documentación oficial:

| Endpoint | Campos usados |
|---|---|
| `/manga` y `/manga/{id}` | `data[].id`; `attributes.title`, `altTitles[]`, `description`, `status`, `year`, `contentRating`, `originalLanguage`, `availableTranslatedLanguages`, `tags[].attributes.{name,group}`, `updatedAt`; `relationships[]`: `author` y `artist` (`attributes.name`), `cover_art` (`attributes.fileName`); `total` |
| `/manga/{id}/feed` | `data[].id`; `attributes.chapter`, `volume`, `title`, `translatedLanguage`, `pages`, `externalUrl`, `publishAt`; `relationships[]` `scanlation_group` (`attributes.name`); `total` |
| `/at-home/server/{id}` | `result`, `baseUrl`, `chapter.hash`, `chapter.data[]`, `chapter.dataSaver[]` |
| `/manga/tag` y `/author` | `data[].id`; `attributes.name`, `attributes.group` |

Si un campo faltara, la obra o el capítulo se muestran sin ese dato: nunca se inventa. Si el feed rechaza `limit=500`, se usa 100.

### Cómo verificarlo en producción (después del push)

1. Abrir Más → Extensiones → MangaDex → **Instalar**. Debería decir "Funcionando · 24 obras" y mostrar los idiomas.
2. Ir a Explorar, buscar un título conocido y abrir la ficha. Comprobar portada, autor, géneros y capítulos en `es-la` / `es` con su grupo.
3. Tocar **Comenzar a leer**. Las páginas tienen que cargar progresivamente; probar "Siguiente" y volver a abrir la app para confirmar que el progreso quedó guardado.
4. Descargar un capítulo y abrirlo sin conexión.
5. Revisar `https://manhuua.onrender.com/mangadex/status`: muestra peticiones, caché y si hay una pausa por 429.

## Limitaciones

- Desde la documentación no se pudieron verificar los parámetros exactos de `/manga` y del feed: las páginas de referencia no cargaron. Se usaron los nombres de la API v5, con respaldo si el feed rechaza `limit=500`.
- Todo el tráfico de imágenes pasa por el backend en Render. Una página comprimida pesa ~100–300 KB y una original ~0,5–2 MB.
- En el plan gratuito de Render, el backend se duerme: la primera consulta puede tardar.
