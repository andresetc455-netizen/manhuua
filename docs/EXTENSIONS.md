# Formato de extensión JSON de Manhuua (versión 1)

Una extensión JSON describe una **API pública** que devuelve JSON. Indica qué URLs pedir y en qué campos de la respuesta están los datos.

- **No contiene ni ejecuta código.** Se rechaza cualquier cosa que no sea texto, número, lista u objeto, y también las URLs `javascript:`.
- **Solo puede pedir datos a su propio dominio** (`baseUrl`) y a los que liste en `hosts`. Las imágenes pueden venir de cualquier CDN.
- **No accede a otras partes de la app**, como la biblioteca, los ajustes, otras extensiones o las claves.
- **Cada respuesta se valida antes de entrar al catálogo:**
  - Se descartan los ítems sin `id` o sin título, y los que tienen URLs que no son http(s).
  - El texto se recorta.
  - Las fechas se aceptan solo si no son ambiguas.
- **Si la API no responde como el manifiesto espera, la extensión queda en estado "API incompatible".** No se inventan obras, capítulos ni URLs.
- **Hace un solo intento por petición.** Ante 401, 403, 429 o 451 no se reintenta.

> Usá solo APIs públicas y fuentes autorizadas. Manhuua no evade CAPTCHA, Cloudflare ni protecciones antibots.

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
  "hosts": ["cdn.ejemplo.org"],
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

Los resultados se agrupan por obra:

- **Se agrupan solos** si coincide un ID externo (`ids`), o si coincide un título o título alternativo normalizado y no hay conflicto de autor ni de año.
- **Se marcan como posibles duplicados** y no se unen si:
  - los títulos son parecidos,
  - el título es corto y no hay autor que lo confirme,
  - o los autores son distintos.

  El usuario decide con **Es la misma obra** o **Son distintas**, y en la ficha puede **Separar** una fuente.
- **Las correcciones se guardan** en el navegador (`manhuua.merges`).

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
