# Despliegue: Cloudflare Pages (frontend) + Render (backend)

```
Navegador ──► Cloudflare Pages (app estática, dist/)
    │
    └──► Render (Docker): /proxy  /render  /health
              └── Chromium (Playwright) para páginas SPA
```

- **Frontend**: la misma PWA de siempre. La URL del backend se fija al compilar con `VITE_BACKEND_URL`. Es una dirección pública, no una credencial.
- **Backend**: `server/proxy.mjs` en Docker (imagen oficial de Playwright con Chromium y sus librerías).
- **Sin backend** (o si no responde): la app sigue funcionando como en GitHub Pages, con el HTML estático, las APIs JSON y los proxies públicos. Solo las SPA necesitan el renderizador.
- **Prioridad**: lo que el usuario configure en Ajustes (proxy o renderizador) tiene prioridad sobre `VITE_BACKEND_URL`.

## 1. Backend en Render (primero, para tener su URL)

1. Entrá a render.com y elegí **New → Blueprint**. Elegí el repositorio: Render lee `render.yaml`.
   - Alternativa: **New → Web Service → Docker**, con el `Dockerfile` de la raíz.
2. Cargá esta variable de entorno, en el panel de Render y no en el repo:
   - `ALLOWED_ORIGINS=https://manhuua.pages.dev,https://*.manhuua.pages.dev`
   - Si usás otro nombre de proyecto o un dominio propio, ponelo acá.
3. Desplegá y comprobá que `https://<servicio>.onrender.com/health` responda `{"ok":true,…,"render":true}`.

Variables opcionales (ver `.env.example`):

| Variable | Defecto | Para qué |
|---|---|---|
| `RATE_LIMIT_PROXY` | 240 | peticiones/min por IP al proxy |
| `RATE_LIMIT_RENDER` | 12 | renders/min por IP |
| `RENDER_CONCURRENCY` | 1 | navegadores simultáneos (memoria) |
| `RENDER_QUEUE` | 6 | renders en espera antes de responder 503 |
| `MAX_BYTES` | 25 MB | tamaño máximo por respuesta |
| `FETCH_TIMEOUT_MS` / `RENDER_TIMEOUT_MS` | 20000 / 25000 | tiempos máximos |
| `ALLOW_PRIVATE` | false en producción | permitir IPs internas (solo pruebas locales) |

## 2. Frontend en Cloudflare Pages

1. En Cloudflare, andá a **Workers & Pages → Create → Pages → Connect to Git** y elegí el repositorio con la rama `main`.
2. Configuración de build:
   - Framework preset: **None** (o Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Variables de entorno (Production y Preview):
   - `NODE_VERSION=22`
   - `VITE_BACKEND_URL=https://<servicio>.onrender.com`
4. Desplegá. La app queda en `https://manhuua.pages.dev`.
   - `public/_headers` agrega las cabeceras de seguridad y de caché.
   - El ruteo usa `#`, así que no hace falta `_redirects`.
5. Si el dominio final es otro, actualizá `ALLOWED_ORIGINS` en Render.

## 3. Comprobar

- Abrí la app y agregá una extensión SPA. El diagnóstico debe decir "renderizado (navegador)".
- En el panel de diagnóstico, los intentos deben figurar como "proxy propio".

## 4. Después (no incluido todavía)

- Desactivar GitHub Pages: borrar `.github/workflows/pages.yml` o quitar el `push` del workflow. Hacelo recién cuando Cloudflare esté funcionando.
- Los datos guardados (biblioteca, extensiones, ajustes) viven en el navegador **por dominio**. Al pasar de `github.io` a `pages.dev` la biblioteca empieza vacía. Hoy la app no tiene una función para exportar la biblioteca: las extensiones se vuelven a agregar y los capítulos se vuelven a descargar (o se reimportan los CBZ/ZIP originales). Si hace falta, se puede sumar una copia de seguridad exportable antes de migrar.

## Seguridad

- **Sin secretos en el frontend.** Todo lo que empieza con `VITE_` queda dentro del JavaScript publicado. Las claves opcionales (IA, LibreTranslate, Google) las carga cada usuario en Ajustes y quedan solo en su navegador.
- **CORS**: el backend responde solo a los orígenes de `ALLOWED_ORIGINS` y rechaza otros orígenes de navegador con 403.
  - Un cliente que no es navegador (curl) puede llamarlo igual, porque CORS no lo impide. Por eso existe el límite por IP.
- **SSRF**:
  - Se bloquean las IPs privadas, locales y de metadatos de nube, y también las URLs con usuario y contraseña o con esquemas que no sean http(s).
  - Se revisa cada redirección.
  - El navegador del renderizador no puede pedir direcciones internas ni descargar imágenes, video o fuentes.
- **Contenido ajeno**: el proxy lo devuelve con `Content-Security-Policy: sandbox` y `nosniff`, así que nunca se ejecuta en el origen del backend.
- **Errores**: respuestas JSON con código claro.

  | Código | Significado |
  |---|---|
  | 400 | parámetro inválido |
  | 403 | origen o destino no permitido |
  | 413 | respuesta demasiado grande |
  | 429 | límite de peticiones (con `Retry-After`) |
  | 503 | renderizador ocupado |
  | 504 | tiempo agotado |

  Cuando el error es del backend (429/502/503/504), la app vuelve a los caminos directos o públicos.
- No se evaden CAPTCHA ni protecciones antibots: se detectan y se informan.

## Limitaciones conocidas

- **Plan gratuito de Render**: se duerme tras 15 min sin uso y la primera petición tarda en despertar (la app lo despierta al abrir). El plan Starter lo mantiene siempre activo.
- **Memoria**: medido en Docker con un límite de 512 MB, el contenedor usó unos 100 MB renderizando páginas de prueba. Sitios pesados pueden usar bastante más; por eso hay un solo navegador a la vez.
- **Sitios que bloquean datacenters**: algunos sitios bloquean IPs de datacenters, y Render lo es. En ese caso el diagnóstico muestra el 403/503 del sitio.
- **Imagen Docker**: pesa unos 3,7 GB porque la imagen oficial trae los tres navegadores. Funciona en Render, pero el primer build es lento.
