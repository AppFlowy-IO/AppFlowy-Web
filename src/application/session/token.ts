import { emit, EventType } from '@/application/session/event';
import { purgeAllOutbox } from '@/application/sync-outbox';

const TOKEN_STORAGE_KEY = 'token';

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

function parseAuthToken(tokenData: unknown): GoTrueAuthToken | null {
  if (typeof tokenData !== 'string') return null;

  try {
    return normalizeAuthToken(JSON.parse(tokenData));
  } catch {
    return null;
  }
}

function removeStoredToken() {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts. The
    // caller still needs to continue its in-memory session cleanup.
  }
}

export function saveGoTrueAuth(tokenData: string): boolean {
  const parsed = parseAuthToken(tokenData);

  if (!parsed) return false;

  const serialized = JSON.stringify(parsed);

  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, serialized);
  } catch {
    return false;
  }

  emit(EventType.SESSION_REFRESH, serialized);
  return true;
}

export function invalidToken() {
  removeStoredToken();
  // Kick off the outbox purge FIRST. `purgeAllOutbox()` sets its internal
  // `isPurging` gate synchronously, so any enqueue landing in the same tick
  // (e.g. a re-render triggered by the SESSION_INVALID emit below) is dropped
  // before it can add rows behind the purge.
  const purge = purgeAllOutbox();

  // Emit SESSION_INVALID immediately so auth-sensitive screens unmount on the
  // next render instead of continuing to issue requests while IDB drains.
  // Interceptor paths (`http/core.ts`, `user-api.ts`) do not redirect and
  // same-tab `localStorage.removeItem('token')` does not fire `AppConfig`'s
  // storage listener, so this event is the only signal that flips
  // `isAuthenticated` to false in-tab.
  //
  // The "next session must not observe pre-purge state" invariant is preserved
  // by `startDrainAll()` awaiting the module-level pending-purge promise.
  emit(EventType.SESSION_INVALID);
  void purge;
}

export function isTokenValid(): boolean {
  // Expiration is deliberately not checked here. An expired, structurally
  // valid token still carries the refresh token used by the HTTP interceptor.
  return getTokenParsed() !== null;
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

  const parsed = parseAuthToken(token);

  if (!parsed) removeStoredToken();

  return parsed;
}
