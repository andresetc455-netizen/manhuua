# Formato de extensión JSON de Manhuua (versión 1)

Una extensión JSON describe una **API pública** que devuelve JSON. Indica qué URLs pedir y en qué campos de la respuesta están los datos.

- **No contiene ni ejecuta código.** Se rechaza cualquier cosa que no sea texto, número, lista u objeto, y también las URLs `javascript:`.
- **Solo puede pedir datos e imágenes a su propio dominio** (`baseUrl`) y a los que liste en `hosts`. Esto vale para el catálogo, la búsqueda, la ficha, la paginación, las portadas y las imágenes de los capítulos. Una portada de otro dominio se descarta. Si las imágenes de un capítulo están en un dominio no declarado, el capítulo da error.
- **No accede a otras partes de la app**, como la biblioteca, los ajustes, otras extensiones o las claves.
- **Cada respuesta se valida antes de entrar al catálogo:**
  - Se descartan los ítems sin `id` o sin título, y los que tienen URLs que no son http(s).
  - El texto se recorta.
  - Las fechas se aceptan solo si no son ambiguas.
- **Si la API no responde como el manifiesto espera, la extensión queda en estado "API incompatible".** No se inventan obras, capítulos ni URLs.
- **Hace un solo intento por petición.** Ante 401, 403, 429 o 451 no se reintenta.

> Usá solo APIs públicas y fuentes autorizadas. Manhuua no evade CAPTCHA, Cloudflare ni protecciones antibots.

## Fuentes integradas

MangaDex viene integrada (API oficial, sin pegar JSON): ver [MANGADEX.md](MANGADEX.md). La auditoría de otras plataformas y por qué no se integran está en [FUENTES.md](FUENTES.md).

## Rendimiento del backend

Valores por defecto. No hace falta tocarlos en Render; si se quiere, se pueden ajustar por variables de entorno.

| Variable | Defecto | Qué controla |
|---|---|---|
| `PROXY_CONCURRENCY` / `PROXY_QUEUE` | 16 / 64 | Descargas simultáneas del proxy en todo el servidor y la cola. Con la cola llena responde 503 con `Retry-After: 5`, y la app reintenta o informa. |
| `MAX_BYTES` | 25 MB | Tope por respuesta. Las respuestas correctas se **transmiten** sin guardarse enteras en memoria; si una supera el tope, se corta. |
| `FETCH_TIMEOUT_MS` | 20 s | Tiempo máximo para conectar y también para cada pausa durante la transmisión. Un sitio que deja de enviar se corta. |
| `RENDER_IDLE_MS` / `RENDER_RECYCLE` | 5 min / 40 | Chromium se cierra tras 5 minutos sin uso y se reinicia cada 40 renderizados, para que la memoria se mantenga estable. |

MangaDex tiene sus propios límites y cachés: ver [MANGADEX.md](MANGADEX.md).

En el lector, las páginas de las extensiones JSON y de MangaDex se piden a medida que se acercan. Las que quedan lejos (unas 4 pantallas) se liberan y se vuelven a pedir si se regresa; el navegador las tiene en caché. Así un capítulo largo no hace crecer la memoria.

## Instalar

En **Más → Extensiones** (`#/extensions`) hay tres formas de instalar:

- pegar la URL del archivo `.json`
- pegar el JSON
- subir el archivo

Si se instala de nuevo un manifiesto con el mismo `id`, la extensión se actualiza a la nueva versión. El botón **Actualizar** vuelve a leer la URL de origen.

## Estructura

```json
{
  "manhuua": 1,
  "id": "mi-fuente",
  "name": "Mi fuente",
  "version": "1.0.0",
  "baseUrl": "https://api.ejemplo.org",
  "hosts": ["cdn.ejemplo.org", "*.imagenes.ejemplo.net"],
  "referer": "https://ejemplo.org/",

  "catalog": {
    "url": "{base}/series?page={page}",
    "list": "data",
    "limit": 20,
    "total": "meta.total",
    "next": "links.next",
    "fields": {
      "id": "id",
      "title": "attributes.title.es|attributes.title.en|attributes.title.*",
      "altTitles": "attributes.altTitles[]",
      "cover": "{base}/covers/{.id}/{.relationships[type=cover_art].attributes.fileName}",
      "description": "attributes.description.es|attributes.description.en",
      "author": "relationships[type=author].attributes.name",
      "artist": "relationships[type=artist].attributes.name",
      "status": "attributes.status",
      "genres": "attributes.tags[].attributes.name.en",
      "updatedAt": "attributes.updatedAt",
      "year": "attributes.year",
      "ids": { "anilist": "attributes.links.al", "mal": "attributes.links.mal" }
    }
  },
  "search":   { "url": "{base}/series?title={q}&page={page}" },
  "detail":   { "url": "{base}/series/{id}", "root": "data", "fields": {} },
  "chapters": {
    "url": "{base}/series/{id}/feed?limit=100&offset={offset}",
    "list": "data", "limit": 100, "total": "total",
    "filter": { "attributes.translatedLanguage": ["es", "es-la"] },
    "fields": {
      "id": "id", "number": "attributes.chapter", "title": "attributes.title",
      "date": "attributes.publishAt", "language": "attributes.translatedLanguage",
      "group": "relationships[type=scanlation_group].attributes.name",
      "url": "https://ejemplo.org/chapter/{chapterId}"
    }
  },
  "pages": {
    "url": "{base}/at-home/server/{chapterId}",
    "list": "chapter.data[]",
    "image": "{$.baseUrl}/data/{$.chapter.hash}/{.}"
  }
}
```

### Campos obligatorios

- `manhuua: 1`, `id`, `name`, `version`, `baseUrl`
  - `id`: minúsculas, números, `.`, `_` o `-`.
  - `version`: con la forma `1.0.0`.
- `catalog.url`, `catalog.fields.id`, `catalog.fields.title`
- `chapters.url`, `chapters.fields.id`
- `pages.url`, y además `pages.list` o `pages.image`

### Métodos

| Sección | Para qué | Variables |
|---|---|---|
| `catalog` | listado / catálogo | `{base}` `{page}` `{offset}` `{limit}` |
| `search` | búsqueda (opcional; hereda `fields` de `catalog`) | además `{q}` |
| `detail` | ficha de una obra (opcional; usa `root` y `fields` sobre `catalog.fields`) | `{id}` |
| `chapters` | capítulos de una obra | `{id}` `{page}` `{offset}` `{limit}` |
| `pages` | imágenes de un capítulo | `{chapterId}` |

### Dominios autorizados (`hosts`)

`hosts` es opcional. Si está presente, tiene que ser una **lista** de hasta 20 dominios completos:

- **Válidos:**
  - `"cdn.ejemplo.org"`
  - `"img.ejemplo.org:8443"` (con puerto)
  - `"*.ejemplo.network"`: cualquier subdominio de `ejemplo.network`, pero no `ejemplo.network` en sí
- **Se rechazan:**
  - un texto suelto en lugar de una lista
  - nombres de una sola parte: `"com"`, `"localhost"`
  - sufijos: `"co.uk"`, `"com.ar"`
  - comodines peligrosos: `"*"`, `"*.com"`, `"*.co.uk"`, `"a*b.org"`
  - IPs
  - rutas, usuarios o esquemas: `"x.org/a"`, `"http://x.org"`
- **Se normalizan:** minúsculas, sin el punto final.
- **Cómo se comparan:**
  - Los dominios de `baseUrl` y de `hosts` se comparan exactos, con el puerto incluido. Un subdominio solo se acepta si se declara, o si cae bajo un comodín.
  - `baseUrl`, `referer` e `icon` tienen que ser URLs http(s) absolutas, sin usuario ni contraseña.
- **Redirecciones:** cada salto se vuelve a comprobar, en el navegador y en el backend. Si una respuesta (datos, imagen de capítulo o portada) redirige a un dominio que no está en `baseUrl` ni en `hosts`, se rechaza. El diagnóstico muestra la URL original, el dominio de destino, el motivo y el dominio que habría que agregar a `hosts` si es legítimo (por ejemplo, un CDN).
- **Imágenes y portadas:** nunca se cargan con la URL remota directa. Pasan por el proxy propio con los dominios autorizados, o, sin backend, por un acceso directo que no sigue redirecciones. Se muestran como Blob. Sin backend, una imagen que redirige (aunque sea a un CDN declarado) no se puede verificar y se rechaza: declarar el CDN y servir la URL final evita la redirección. Nunca se usan proxies públicos. Una portada rechazada no se guarda en la biblioteca.
- **HTTPS:** si `baseUrl` es `https://`, no se aceptan URLs ni redirecciones a `http://` (portadas, imágenes, paginación o capítulos).

### Rutas a los datos

| Sintaxis | Qué hace |
|---|---|
| `a.b.c` | campo anidado |
| `a[]` | recorre una lista (`tags[].name` devuelve todos los nombres) |
| `a[type=author]` | toma el primer elemento de la lista cuyo `type` es `author` |
| `x.es\|x.en` | prueba alternativas, en orden |
| `x.*` | toma el primer valor de un objeto (por ejemplo, títulos por idioma) |
| `.` | el elemento entero (en `list` es la raíz de la respuesta) |

Un campo con `{…}` es una **plantilla**:

- `{.ruta}` toma el dato del elemento actual.
- `{$.ruta}` toma el dato de la raíz de la respuesta.
- Las variables (`{base}`, `{id}`, etc.) se reemplazan como en las URLs.

Si una plantilla usa un dato que no existe, el resultado es `null`: nunca se arma una URL incompleta.

### Paginación

Hay tres formas, por orden de prioridad:

1. **`next`**: ruta a la URL de la página siguiente. Si está vacía, termina.
2. **`{page}` u `{offset}`** en la URL: avanza mientras la página traiga al menos `limit` elementos. Si se indica `total`, avanza hasta alcanzarlo.
3. **Ninguna de las dos**: una sola página.

Las listas de capítulos se cortan en 50 páginas. Si una página siguiente falla, se conservan las anteriores y el error figura en el diagnóstico.

### Capítulos

- `filter` deja pasar solo los capítulos cuyos campos coinciden. Acepta un valor o una lista de valores.
- La lista final se ordena por número y no tiene duplicados.
- Internamente, cada capítulo se identifica como `mf:<id-de-extensión>/c/<id>`. Si se reinstala la extensión con el mismo `id`, los capítulos guardados siguen funcionando.
- La identidad de la extensión es su `id` **más el dominio de `baseUrl`** (en minúsculas, con puerto si no es el estándar). Si se elimina y se vuelve a instalar la misma identidad, Manhuua reutiliza la misma fuente: las obras, capítulos, descargas, progreso e historial quedan asociados y no se crea una fuente duplicada. El mismo `id` desde otro dominio es **otra fuente**: no reemplaza a la instalada ni hereda sus datos (se muestra con el dominio en el nombre).
- Al actualizar (botón "Actualizar" o reinstalando), un cambio de dominio o de `baseUrl`, de `referer` o dominios nuevos en `hosts` piden confirmación explícita. Si se cancela, la extensión queda como estaba.
- Datos de versiones anteriores de una extensión ya eliminada (sin registro de identidad) no se reasocian solos: la ficha de la obra ofrece "Reasociar con …" y pide confirmación.

## Estados de una extensión

| Estado | Cuándo |
|---|---|
| Disponible | instalada y todavía sin comprobar |
| Funcionando | el catálogo respondió con obras válidas |
| Fuente bloqueada (401/403/451) | la fuente rechazó el acceso: no es un error de Manhuua |
| No disponible (404/410) | la URL no existe en la fuente |
| Limitada (429) | la fuente limita la cantidad de peticiones |
| Error de conexión | sin respuesta, error 5xx de la fuente, error del backend o bloqueo CORS |
| API incompatible | la respuesta no es JSON o no tiene datos en los campos del manifiesto |
| Desactivada | apagada por el usuario: no aparece en la barra lateral ni en las búsquedas |

El diagnóstico de cada extensión muestra:

- tiempo de respuesta, código HTTP
- obras y capítulos encontrados
- elementos descartados
- última comprobación
- el tipo de error: de la fuente, del backend, CORS, de extracción, API incompatible o antibots

## Catálogo unificado

En **Explorar**, la búsqueda consulta todas las extensiones activas en paralelo. Cada fuente tiene su propio tiempo máximo y una que falle no corta las demás.

- **Simultaneidad:** hasta 8 fuentes a la vez. Con más, las demás esperan turno. El tope protege al backend, que atiende 16 pedidos a la vez.
- **Resultados progresivos:** cada fuente aparece apenas responde, con su estado (obras, error, sin respuesta).
- **Paginación independiente:** cada fuente con más resultados muestra **más** en su etiqueta, y **Más de todas** avanza las que tengan página siguiente.
  - Las obras repetidas de una misma fuente no se agregan dos veces.
  - Si la página siguiente falla, se conservan las obras ya cargadas y se informa el error.
  - Si una página no trae nada nuevo, la fuente deja de ofrecer **más**.
- **Cancelación:** una búsqueda nueva cancela la anterior y las páginas pendientes.
- **Caché:** cada página correcta se guarda 5 minutos en memoria (como máximo 120). Los errores no se guardan. El botón de recarga vacía esta caché. MangaDex mantiene además su propia caché (2 minutos en el backend).
- **Filtros:** tipo (manga, manhwa, manhua o novela, según lo que informe la fuente), idioma, género, estado, autor y fuente.
- **Orden:** el de cada fuente, alfabético o por última actualización. El orden por popularidad solo existe donde la API lo ofrece: en MangaDex se elige en sus opciones ("más seguidos"), y la fuente devuelve el catálogo ya ordenado.

Los resultados se agrupan por obra:

- **Se agrupan solos** si coincide un ID externo (`ids`), o si coincide un título o título alternativo normalizado y no hay conflicto de autor ni de año.
- **Se marcan como posibles duplicados** y no se unen si:
  - los títulos son parecidos,
  - el título es corto y no hay autor que lo confirme,
  - o los autores son distintos.

  El usuario decide con **Es la misma obra** o **Son distintas**, y en la ficha puede **Separar** una fuente.
- **Las correcciones se guardan** en el navegador (`manhuua.merges`).

## Novelas propias (TXT / EPUB)

Ninguna plataforma de novelas ofrece lectura autorizada para terceros (ver [FUENTES.md](FUENTES.md)). Por eso el lector de texto funciona con **archivos del usuario**: en **Biblioteca → Importar** se aceptan `.txt` y `.epub` sin DRM.

- **TXT:** se separa en capítulos por las líneas del tipo "Capítulo N", "Chapter N", "Prólogo" o "Epílogo". Si no hay ninguna, queda un solo capítulo.
- **EPUB:**
  - Se leen el título, el autor y el orden de lectura (*spine*). Se saltan las páginas sin texto, como la portada.
  - Un EPUB con recursos cifrados (DRM) se rechaza; solo se acepta la ofuscación de tipografías.
- **Seguridad:** se guarda solo el texto, por párrafos. Nunca se guarda ni se muestra HTML del archivo, así que sus scripts o enlaces no se ejecutan.
- **Lector:**
  - Opciones: tamaño de letra, tipografía (con serifa, sin serifa o monoespaciada), tema (oscuro, claro o sepia), ancho de lectura e interlineado.
  - Guarda la posición por párrafo, tiene índice de capítulos y botones anterior/siguiente.
  - Funciona en Historial y "Seguí donde lo dejaste". Todo queda en el dispositivo, sin conexión.

## Ejemplo mínimo

```json
{
  "manhuua": 1, "id": "ejemplo", "name": "Ejemplo", "version": "1.0.0",
  "baseUrl": "https://api.ejemplo.org",
  "catalog":  { "url": "{base}/obras?page={page}", "list": "items", "fields": { "id": "id", "title": "titulo", "cover": "portada" } },
  "chapters": { "url": "{base}/obras/{id}/capitulos", "list": "items", "fields": { "id": "id", "number": "numero", "title": "titulo" } },
  "pages":    { "url": "{base}/capitulos/{chapterId}", "list": "imagenes[]" }
}
```
