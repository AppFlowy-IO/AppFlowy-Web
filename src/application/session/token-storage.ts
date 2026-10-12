export const TOKEN_STORAGE_KEY = 'token';

export interface GoTrueAuthUser {
  id: string;
  email?: string;
}

/**
 * The fields required to authenticate requests and scope client-side state.
 * A stable user identity is mandatory because caches and application layers are
 * keyed by account. It may come from GoTrue's user object or JWT claims.
 */
export interface GoTrueAuthToken {
  access_token: string;
  expires_at: number;
  refresh_token: string;
  user: GoTrueAuthUser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeUser(value: unknown): GoTrueAuthUser | null {
  if (!isRecord(value) || !isNonEmptyString(value.id)) return null;

  const { email, ...userFields } = value;

  return {
    ...userFields,
    id: value.id,
    ...(typeof email === 'string' ? { email } : {}),
  };
}

// Decode JWT claims only to recover account identity. Authentication
// still relies on the server; this does not verify the token's signature.
function decodeJWTUser(token: string): GoTrueAuthUser | null {
  try {
    const parts = token.split('.');

    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;

    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(paddedBase64);
    const percentEncoded = Array.from(binary, (character) => {
      return `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`;
    }).join('');
    const payload: unknown = JSON.parse(decodeURIComponent(percentEncoded));

    if (!isRecord(payload) || !isNonEmptyString(payload.sub)) return null;

    return {
      id: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    };
  } catch {
    // Opaque access tokens remain supported when GoTrue also returns a valid
    // user object.
    return null;
  }
}

function normalizeAuthToken(value: unknown): GoTrueAuthToken | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.access_token) ||
    !isNonEmptyString(value.refresh_token) ||
    typeof value.expires_at !== 'number' ||
    !Number.isFinite(value.expires_at)
  ) {
    return null;
  }

  const { user: storedUser, ...tokenFields } = value;
  const user = normalizeUser(storedUser) ?? decodeJWTUser(value.access_token);

  if (!user) return null;

  return {
    ...tokenFields,
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_at: value.expires_at,
    user,
  };
}

export function parseAuthToken(tokenData: unknown): GoTrueAuthToken | null {
  if (typeof tokenData !== 'string') return null;

  try {
    return normalizeAuthToken(JSON.parse(tokenData));
  } catch {
    return null;
  }
}

// The stored token is read by both axios interceptors and by several cache-key
// builders, so the last successful parse is memoized on the raw stored string.
// The string itself is the cache key: every save or removal changes it, and a
// failed parse is never cached so a bad value is removed on each read.
let memoizedRawToken: string | null = null;
let memoizedParsedToken: GoTrueAuthToken | null = null;

export function memoizeParsedToken(rawToken: string | null, parsed: GoTrueAuthToken | null) {
  memoizedRawToken = rawToken;
  memoizedParsedToken = parsed;
}

export function removeStoredToken() {
  memoizeParsedToken(null, null);

  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts. The
    // caller still needs to continue its in-memory session cleanup.
  }
}

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getTokenParsed(): GoTrueAuthToken | null {
  const token = getToken();

  if (!token) return null;
  if (token === memoizedRawToken && memoizedParsedToken) return memoizedParsedToken;

  const parsed = parseAuthToken(token);

  if (!parsed) {
    removeStoredToken();
    return null;
  }

  memoizeParsedToken(token, parsed);
  return parsed;
}
