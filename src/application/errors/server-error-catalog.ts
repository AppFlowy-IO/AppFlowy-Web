import { WEB_CLIENT_VERSION } from '@/application/compatibility/client-version';
import { resolveLocalApiBaseURL } from '@/application/services/js-services/http/local-dev-origins';
import { getConfigValue } from '@/utils/runtime-config';

export const ERROR_CATALOG_MAX_BYTES = 256 * 1024;
export const ERROR_CATALOG_REFRESH_MS = 5 * 60_000;
export const ERROR_CATALOG_TIMEOUT_MS = 10_000;
const REVALIDATE_MIN_AGE_MS = 30_000;
const MAX_ENTRIES = 512;

export interface ServerErrorCatalog {
  readonly schema_version: 1;
  readonly locale: string;
  readonly reasons: Readonly<Record<string, string>>;
  readonly codes: Readonly<Record<string, string>>;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function normalizeLocale(value: string): string | undefined {
  const locale = value.replace(/_/g, '-').toLowerCase();

  return locale.length <= 64 && /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/.test(locale) ? locale : undefined;
}

/** Accept only public copy and Cloud code mappings, never diagnostic matching rules. */
export function parseServerErrorCatalog(value: unknown): ServerErrorCatalog | undefined {
  const envelope = record(value);
  const data = record(envelope?.data);
  const reasons = record(data?.reasons);
  const codes = record(data?.codes);
  const locale = typeof data?.locale === 'string' ? normalizeLocale(data.locale) : undefined;

  if (envelope?.code !== 0 || data?.schema_version !== 1 || !locale || !reasons || !codes) return undefined;
  const reasonEntries = Object.entries(reasons);
  const codeEntries = Object.entries(codes);

  if (!reasonEntries.length || reasonEntries.length > MAX_ENTRIES || codeEntries.length > MAX_ENTRIES) return undefined;
  for (const [reason, message] of reasonEntries) {
    if (!/^[A-Z0-9_]{1,64}$/.test(reason) || typeof message !== 'string' || !message.trim() || message.length > 1024 ||
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1f\x7f-\x9f]/.test(message)) return undefined;
  }

  for (const [code, reason] of codeEntries) {
    const number = Number(code);

    if (!Number.isInteger(number) || number === 0 || number < -2147483648 || number > 2147483647 || String(number) !== code ||
      typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(reasons, reason)) return undefined;
  }

  return Object.freeze({
    schema_version: 1,
    locale,
    reasons: Object.freeze(Object.fromEntries(reasonEntries) as Record<string, string>),
    codes: Object.freeze(Object.fromEntries(codeEntries) as Record<string, string>),
  });
}

interface CatalogSession {
  serverUrl: string;
  locale: string;
  owners: number;
  catalog?: ServerErrorCatalog;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  lastAttemptAt: number;
  disposeEvents: () => void;
}

// One active configuration bounds memory and prevents another server/locale's copy
// from being reused. Multiple owners of that configuration share requests and timers.
let session: CatalogSession | undefined;
let revision = 0;
const listeners = new Set<() => void>();

function publish(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function subscribeToErrorCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getErrorCatalogRevision(): number {
  return revision;
}

export function getServerErrorCatalog(
  locale: string,
  serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud')
): ServerErrorCatalog | undefined {
  const requestedLocale = normalizeLocale(locale);
  const catalog = session?.catalog;

  if (!catalog || session?.serverUrl !== serverUrl || session.locale !== requestedLocale) return undefined;
  // Code identity is language-independent; the display boundary decides whether
  // the server's copy matches the user's selected language.
  return catalog;
}

async function readCatalog(response: Response, signal: AbortSignal): Promise<ServerErrorCatalog | undefined> {
  if (response.status !== 200 || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }

  const contentLength = response.headers.get('content-length');

  if (contentLength !== null && Number(contentLength) > ERROR_CATALOG_MAX_BYTES) {
    void response.body.cancel().catch(() => undefined);
    return undefined;
  }

  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };

  let bytes = 0;
  let body = '';

  try {
    if (signal.aborted) return undefined;
    signal.addEventListener('abort', cancel);
    const decoder = new TextDecoder('utf-8', { fatal: true });

    for (;;) {
      const { value, done } = await reader.read();

      if (done) break;
      bytes += value.byteLength;
      if (bytes > ERROR_CATALOG_MAX_BYTES) return undefined;
      body += decoder.decode(value, { stream: true });
    }

    body += decoder.decode();
    return parseServerErrorCatalog(JSON.parse(body));
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function catalogUrl(current: CatalogSession): string {
  const url = new URL(resolveLocalApiBaseURL(current.serverUrl), window.location.origin);

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid catalog origin');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/error-messages`;
  url.search = new URLSearchParams({
    schema_version: '1', platform: 'web', client_version: WEB_CLIENT_VERSION, locale: current.locale,
  }).toString();
  url.hash = '';
  return url.toString();
}

async function refresh(current: CatalogSession): Promise<void> {
  if (session !== current || current.controller) return;
  if (current.timer) clearTimeout(current.timer);
  current.lastAttemptAt = Date.now();
  const controller = new AbortController();

  current.controller = controller;
  const timeout = setTimeout(() => controller.abort(), ERROR_CATALOG_TIMEOUT_MS);
  let next: ServerErrorCatalog | undefined;

  try {
    // Public, fixed endpoint: no authentication, storage access, interceptors, or
    // redirects. Catalog failures must never enter normal error normalization.
    const response = await fetch(catalogUrl(current), {
      signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (controller.signal.aborted || session !== current) {
      void response.body?.cancel().catch(() => undefined);
      return;
    }

    const catalog = await readCatalog(response, controller.signal);

    if (!controller.signal.aborted) next = catalog;
  } catch {
    // Old servers, unavailable transport and malformed optional catalogs all use
    // the bundled fallback. A 204 also clears previously loaded server wording.
  } finally {
    clearTimeout(timeout);
    current.controller = undefined;
    if (session === current) {
      current.catalog = next;
      publish();
      current.timer = setTimeout(() => void refresh(current), ERROR_CATALOG_REFRESH_MS);
    }
  }
}

function dispose(current: CatalogSession): void {
  current.controller?.abort();
  if (current.timer) clearTimeout(current.timer);
  current.disposeEvents();
}

/** Mount once above sign-in; matching owners share one cancellable refresh loop. */
export function retainServerErrorCatalog(serverUrl: string, locale: string): () => void {
  const requestedLocale = normalizeLocale(locale) ?? 'en';

  if (!session || session.serverUrl !== serverUrl || session.locale !== requestedLocale) {
    if (session) dispose(session);
    const current: CatalogSession = {
      serverUrl, locale: requestedLocale, owners: 0, lastAttemptAt: 0, disposeEvents: () => undefined,
    };

    session = current;
    const revalidate = () => {
      if (Date.now() - current.lastAttemptAt >= REVALIDATE_MIN_AGE_MS) void refresh(current);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') revalidate();
    };

    window.addEventListener('online', revalidate);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', onVisibility);
    current.disposeEvents = () => {
      window.removeEventListener('online', revalidate);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    publish();
    void refresh(current);
  }

  const current = session;

  current.owners += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    current.owners -= 1;
    if (current.owners === 0) {
      dispose(current);
      if (session === current) {
        session = undefined;
        publish();
      }
    }
  };
}
