import { isLocalDevelopment } from '@/utils/runtime-config';

/**
 * Local development only. In production nginx serves the API, `/billing` and
 * `/ws` on one domain, so every request uses the configured base URL as is.
 * With `pnpm dev` against the split-service setup on localhost:8000 or :8100,
 * the services are separate processes on fixed ports, and the gateway sends
 * no CORS headers on real responses, so the app talks to the dev server
 * instead: its proxies (see localDevProxyConfig in vite.config.ts) forward
 * `/api` to the gateway or the cloud, `/ws` to the cloud and `/billing` to the
 * billing service. Other local backends, including nginx, keep their URL.
 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseURL(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** True only for the Vite dev server talking to the known local split-service setup. */
export function isLocalDevBaseURL(baseURL: string, isDev: boolean = isLocalDevelopment()): boolean {
  if (!isDev) return false;

  const url = parseURL(baseURL);

  return (
    url !== null &&
    LOCAL_HOSTNAMES.has(url.hostname) &&
    url.protocol === 'http:' &&
    (url.port === '8000' || url.port === '8100') &&
    url.pathname === '/'
  );
}

/**
 * API base URL to use: the dev server origin for the known local split-service
 * setup (its proxies do the routing), otherwise the configured base URL,
 * unchanged, for production, remote servers and other local backends.
 */
export function resolveLocalApiBaseURL(
  baseURL: string,
  isDev: boolean = isLocalDevelopment(),
  devServerOrigin: string | undefined = typeof window === 'undefined' ? undefined : window.location.origin
): string {
  if (!devServerOrigin || !isLocalDevBaseURL(baseURL, isDev)) return baseURL;

  return devServerOrigin;
}
