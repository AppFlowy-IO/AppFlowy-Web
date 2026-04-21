import { emit, EventType } from '@/application/session/event';
import { purgeAllOutbox } from '@/application/sync-outbox';

// Decode JWT to extract user info (simple base64 decode, no verification)
function decodeJWT(token: string): { sub: string; email: string } | null {
  try {

    const parts = token.split('.');

    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));

    return {
      sub: payload.sub,
      email: payload.email,
    };
  } catch (e) {

    console.error('Failed to decode JWT:', e);
    return null;
  }
}

export function saveGoTrueAuth(tokenData: string) {
  const parsed = JSON.parse(tokenData);

  // Decode JWT to extract user info if not present
  if (!parsed.user && parsed.access_token) {
    const userInfo = decodeJWT(parsed.access_token);

    if (userInfo) {
      parsed.user = {
        id: userInfo.sub,
        email: userInfo.email,
      };
    }
  }

  localStorage.setItem('token', JSON.stringify(parsed));
  emit(EventType.SESSION_REFRESH, JSON.stringify(parsed));
}

export function invalidToken() {
  localStorage.removeItem('token');
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

export function isTokenValid() {
  return !!localStorage.getItem('token');
}

export function getToken() {
  return localStorage.getItem('token');
}

export function getTokenParsed(): {
  access_token: string;
  expires_at: number;
  refresh_token: string;
  user: {
    id: string;
    email: string;
  }
} | null {
  const token = getToken();

  if (!token) {
    return null;
  }

  try {
    return JSON.parse(token);
  } catch (e) {
    return null;
  }
}
