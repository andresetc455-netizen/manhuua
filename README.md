# Manhuua — lector de manhuas (PWA)

App web instalable (Android/iOS/PC) para leer manhuas/manhwas offline.

## Funciones
- **Biblioteca** con portadas, favoritos, filtros (Leyendo, Sin leer), búsqueda, "Continuar leyendo".
- **Lector** vertical (scroll continuo, típico de manhua) o paginado (LTR/RTL), barra de progreso, salto de página, capítulo anterior/siguiente, pantalla siempre encendida, retoma donde quedaste.
- **Importar** CBZ/ZIP, imágenes sueltas o carpetas (cada subcarpeta = capítulo).
- **Descargas por URL**: pegá la URL de un capítulo (extrae imágenes) o de una serie (lista capítulos para elegir). Cola con reintentos; todo queda guardado offline en IndexedDB.
- **Extensiones**: agregá sitios propios desde el menú lateral izquierdo; al entrar ves su catálogo (portadas), la ficha de la serie, y descargás capítulos o la serie completa. Botón ↻ busca capítulos nuevos de las series que vinieron de una URL.
- También acepta un **catálogo JSON** propio como extensión (ver `src/sources/catalog.js`).
- **Traductor automático** (inglés → español) en el lector: botón de traducir en la barra superior. Hace OCR de los globos en el propio dispositivo (Tesseract.js) y superpone el texto traducido. Se recuerda por serie y se guarda en caché (mantener presionado el botón para rehacer).
  - Servicio por defecto: MyMemory (gratis, sin clave, ~5.000 caracteres/día; con email ~50.000). Alternativa: LibreTranslate (servidor propio gratis o servicio con clave). Configurable en **Ajustes → Traducción automática**.
  - Funciona bien con texto de globos limpio; tipografías muy estilizadas o efectos de sonido pueden no detectarse. La primera vez descarga el modelo OCR (~10 MB).
- Tema oscuro/claro/sistema.

> Usalo solo con contenido que tengas derecho a descargar.

## Publicarla como página web (GitHub Pages)
Igual que Seoulmate: cada `push` a `main` publica la app en `https://<usuario>.github.io/manhuua/` (workflow en `.github/workflows/pages.yml`).
1. Crear el repo en GitHub y subir este código.
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Abrir la URL en el celular → menú del navegador → **Agregar a pantalla de inicio / Instalar app**.

GitHub Pages es solo estático: para descargar de otros sitios hace falta un proxy. Opción gratis: publicar `server/cloudflare-worker.js` en Cloudflare Workers y pegar `https://TU-WORKER.workers.dev/?url=` en **Ajustes → Red**. La traducción no necesita proxy.

## Uso local
```bash
npm install
npm run serve      # build + servidor en http://localhost:8787 (app + proxy CORS)
```
Desde el celular (misma red Wi-Fi): abrí `http://IP-de-tu-PC:8787` → menú del navegador → "Agregar a pantalla de inicio".

El proxy (`server/proxy.mjs`) es necesario porque los navegadores bloquean leer otros sitios (CORS). Si la app se sirve desde ese servidor, se detecta solo. Si hospedás la app en otro lado (Netlify, GitHub Pages…), poné la URL del proxy en **Ajustes → Red**.

Otros comandos: `npm run dev` (desarrollo), `npm run build` (PWA estática en `dist/`), `npm run build:single` (un único HTML).

## Notas técnicas
- React 19 + Vite, sin backend obligatorio. Datos en IndexedDB (`src/db.js`), ajustes y extensiones en localStorage.
- El extractor es genérico (`src/sources/web.js`, `src/sources/extensions.js`): detecta imágenes lazy (`data-src`, `srcset`…), descarta logos/íconos e imágenes chicas, y enlaces "Capítulo N". Sitios que arman la página 100 % con JavaScript (SPA) pueden no exponer las imágenes en el HTML; en ese caso conviene un catálogo JSON o una fuente nueva implementando `browse/seriesDetail`.
