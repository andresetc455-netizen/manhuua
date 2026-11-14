// URL del backend (proxy + renderizador) definida al compilar: VITE_BACKEND_URL.
// Es una dirección pública, no una credencial. Si no está, la app busca el servidor en su
// mismo origen (npm run serve) o usa los proxies públicos, como siempre.
export const BACKEND = String(import.meta.env?.VITE_BACKEND_URL || '').trim().replace(/\/+$/, '');

let warm = null;
/** Despierta el backend (en planes gratuitos se duerme) sin bloquear la app. */
export function wakeBackend() {
  if (!BACKEND) return Promise.resolve(null);
  warm ??= fetch(`${BACKEND}/health`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  return warm;
}
