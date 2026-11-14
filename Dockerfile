# Backend de Manhuua para Render (u otro host con Docker): proxy CORS + renderizador con Chromium.
# La imagen oficial de Playwright ya trae Chromium y todas sus librerías del sistema.
# La versión de la imagen DEBE coincidir con "playwright" en server/package.json.
FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/ ./
ENV NODE_ENV=production \
    SERVE_STATIC=false \
    PORT=10000
USER pwuser
EXPOSE 10000
# Arranca el servidor HTTP (proxy + /render + /health); render.mjs se carga desde proxy.mjs.
CMD ["node", "/app/server/proxy.mjs"]
