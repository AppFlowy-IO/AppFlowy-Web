import { defaultConfig } from './cloud-config';

const TOKEN_STORAGE_KEY = 'token';
const GET_RETRY_COUNT = 3;
const GET_RETRY_BASE_DELAY_MS = 1_000;

interface StoredRequestToken {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
}

export interface PublicFormStoredUser {
  email?: string;
  id: string;
}

interface PublicFormClientResponse<T> {
  data: T;
}

interface PublicFormRequestOptions {
  headers?: Record<string, string>;
}

export interface PublicFormHTTPError extends Error {
  name: 'PublicFormHTTPError';
  response: {
    data: unknown;
    headers: Headers;
    status: number;
  };
}

export interface PublicFormClient {
  get<T>(path: string): Promise<PublicFormClientResponse<T>>;
  post<T>(path: string, body: unknown, options?: PublicFormRequestOptions): Promise<PublicFormClientResponse<T>>;
}

const publicFormClient: PublicFormClient = {
  get: <T>(path: string) => request<T>(path, 'GET'),
  post: <T>(path: string, body: unknown, options?: PublicFormRequestOptions) => request<T>(path, 'POST', body, options),
};

/**
 * Lightweight transport for the anonymous `/public-form` route. The main
 * Axios client imports session events, IndexedDB outbox code, and the full
 * authenticated bootstrap. Public forms only need fetch plus an optional
 * bearer token; the refresh graph is loaded only for an expired/rejected
 * existing session.
 */
export function getPublicFormClient(): PublicFormClient {
  return publicFormClient;
}

/**
 * Lightweight signed-in identity for the standalone public Form route. Keep
 * this beside the public transport's token parser so Form rendering does not
 * import the authenticated session/outbox graph merely to display a name.
 */
export function getPublicFormStoredUser(): PublicFormStoredUser | null {
  const value = readStoredTokenRecord();

  if (!value || !isRecord(value.user) || !isNonEmptyString(value.user.id)) return null;

  return {
    id: value.user.id,
    ...(typeof value.user.email === 'string' && value.user.email.trim().length > 0 ? { email: value.user.email } : {}),
  };
}

export function isPublicFormHTTPError(error: unknown): error is PublicFormHTTPError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'PublicFormHTTPError' &&
    'response' in error &&
    typeof (error as { response?: { status?: unknown } }).response?.status === 'number'
  );
}

async function request<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  options?: PublicFormRequestOptions
): Promise<PublicFormClientResponse<T>> {
  let token = readStoredRequestToken();

  if (token && isExpired(token)) {
    // A concurrent request or another tab can rotate the refresh token while
    // this request is waiting. If our refresh loses that race, use the token
    // currently in storage instead of falling back to anonymous traffic.
    token = await refreshStoredToken(token).catch(() => readStoredRequestToken());
  }

  let response = await sendRequestWithRetry(path, method, body, options, token?.accessToken);

  if (response.status === 401) {
    const currentToken = readStoredRequestToken();

    if (currentToken) {
      const storedTokenChanged = !sameStoredToken(currentToken, token);
      const retryToken =
        storedTokenChanged && !isExpired(currentToken)
          ? currentToken
          : await refreshStoredToken(currentToken).catch(() => readStoredRequestToken());

      if (retryToken) {
        response = await sendRequestWithRetry(path, method, body, options, retryToken.accessToken);
      }
    }
  }

  const data = await readResponseJSON(response);

  if (!response.ok) {
    throw createHTTPError(response, data);
  }

  return { data: data as T };
}

/** Preserve the authenticated client's transient retry policy for safe GETs. */
async function sendRequestWithRetry(
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
  options: PublicFormRequestOptions | undefined,
  accessToken: string | undefined
): Promise<Response> {
  for (let retryCount = 0; retryCount <= GET_RETRY_COUNT; retryCount += 1) {
    try {
      const response = await sendRequest(path, method, body, options, accessToken);

      if (method !== 'GET' || !isRetryableStatus(response.status) || retryCount >= GET_RETRY_COUNT) {
        return response;
      }

      // The owner quota is a durable terminal state, not transient admission
      // pressure. Preserve generic 429 retries, but surface this response
      // immediately so loading a shared form does not wait through Retry-After.
      if (await isUserRateLimitedResponse(response)) return response;

      await waitForRetry(retryDelay(response.headers, retryCount));
    } catch (error) {
      if (method !== 'GET' || retryCount >= GET_RETRY_COUNT || isAbortError(error)) throw error;

      await waitForRetry(GET_RETRY_BASE_DELAY_MS * 2 ** retryCount);
    }
  }

  throw new Error('Public form GET retry loop exited unexpectedly');
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function isUserRateLimitedResponse(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;

  const data = await readResponseJSON(response.clone());

  return isRecord(data) && data.error === 'user_rate_limited';
}

function retryDelay(headers: Headers, retryCount: number): number {
  const rawRetryAfter = headers.get('Retry-After');
  const retryAfter = rawRetryAfter === null ? NaN : Number.parseInt(rawRetryAfter.trim(), 10);

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    const baseMs = retryAfter * 1_000;

    return baseMs + Math.round(Math.random() * baseMs);
  }

  return GET_RETRY_BASE_DELAY_MS * 2 ** retryCount;
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && (error as { name: unknown }).name === 'AbortError'
  );
}

function sendRequest(
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
  options: PublicFormRequestOptions | undefined,
  accessToken: string | undefined
): Promise<Response> {
  const headers = new Headers(options?.headers);

  headers.set('Accept', 'application/json');
  if (method === 'POST') headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  return fetch(publicFormURL(path), {
    method,
    headers,
    credentials: 'same-origin',
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

function publicFormURL(path: string): string {
  const baseURL = defaultConfig.baseURL.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${baseURL}${normalizedPath}`;
}

async function readResponseJSON(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function createHTTPError(response: Response, data: unknown): PublicFormHTTPError {
  const error = new Error(response.statusText || `Request failed with status code ${response.status}`);

  error.name = 'PublicFormHTTPError';
  return Object.assign(error, {
    response: {
      data,
      headers: response.headers,
      status: response.status,
    },
  }) as PublicFormHTTPError;
}

function readStoredRequestToken(): StoredRequestToken | null {
  const value = readStoredTokenRecord();

  if (
    !value ||
    typeof value.access_token !== 'string' ||
    value.access_token.length === 0 ||
    typeof value.refresh_token !== 'string' ||
    value.refresh_token.length === 0 ||
    typeof value.expires_at !== 'number' ||
    !Number.isFinite(value.expires_at)
  ) {
    return null;
  }

  return {
    accessToken: value.access_token,
    expiresAt: value.expires_at,
    refreshToken: value.refresh_token,
  };
}

function readStoredTokenRecord(): Record<string, unknown> | null {
  try {
    if (typeof window === 'undefined') return null;

    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);

    if (!raw) return null;
    const value: unknown = JSON.parse(raw);

    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isExpired(token: StoredRequestToken): boolean {
  return Date.now() >= token.expiresAt * 1000;
}

function sameStoredToken(left: StoredRequestToken | null, right: StoredRequestToken | null): boolean {
  return Boolean(left && right && left.accessToken === right.accessToken && left.refreshToken === right.refreshToken);
}

async function refreshStoredToken(token: StoredRequestToken): Promise<StoredRequestToken> {
  const [{ initGrantService, refreshToken }, { invalidToken }] = await Promise.all([
    import('./gotrue'),
    import('@/application/session/token'),
  ]);

  initGrantService(defaultConfig.gotrueURL);

  try {
    const refreshed = await refreshToken(token.refreshToken);

    return {
      accessToken: refreshed.access_token,
      expiresAt: refreshed.expires_at,
      refreshToken: refreshed.refresh_token,
    };
  } catch (error) {
    // Rotating refresh tokens are single-use. A failure for token A is
    // expected if another request/tab already saved token B; never let that
    // stale failure delete B or purge its account-scoped outbox.
    if (sameStoredToken(readStoredRequestToken(), token)) invalidToken();
    throw error;
  }
}
