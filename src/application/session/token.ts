import { removeSignedOutLocalData } from '@/application/db';
import { emit, EventType } from '@/application/session/event';
import { clearDrainConfig, setCurrentSession } from '@/application/sync-outbox';
import { getConfigValue } from '@/utils/runtime-config';

import {
  getTokenParsed,
  isTokenSessionCurrent,
  memoizeParsedToken,
  parseAuthToken,
  recordStoredToken,
  removeStoredToken,
  TOKEN_STORAGE_KEY,
  type TokenSessionWitness,
} from './token-storage';

export { captureTokenSession, getToken, getTokenParsed, isTokenSessionCurrent } from './token-storage';
export type { GoTrueAuthToken, GoTrueAuthUser, TokenSessionWitness } from './token-storage';

/** Ends only the login that captured the witness; a newer login is never signed out. */
export function invalidTokenForSession(witness: TokenSessionWitness): void {
  if (isTokenSessionCurrent(witness)) invalidToken();
}

export function saveGoTrueAuth(tokenData: string, refreshingSession?: TokenSessionWitness): boolean {
  const parsed = parseAuthToken(tokenData);

  if (!parsed) return false;

  if (refreshingSession && (!isTokenSessionCurrent(refreshingSession) ||
    (refreshingSession.userId !== null && refreshingSession.userId !== parsed.user.id))) return false;

  const serialized = JSON.stringify(parsed);

  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, serialized);
  } catch {
    return false;
  }

  recordStoredToken(serialized, refreshingSession !== undefined);
  memoizeParsedToken(serialized, parsed);
  emit(EventType.SESSION_REFRESH, serialized);
  return true;
}

export interface InvalidTokenOptions {
  /**
   * The user explicitly chose, while signing out, to remove this account's
   * copies of server content from the browser.
   */
  removeLocalData?: boolean;
}

/**
 * Ends the session. Copies of server content stay on this device unless the
 * user explicitly asked to remove them: most invalidations are involuntary
 * (an expired or rejected refresh, failed socket authentication), and the
 * same account usually signs in again. Edits already sent over the realtime
 * connection leave the outbox when sent, not when the server applies them, so
 * a send lost with a dropped connection is recovered only by the next sync of
 * that local copy.
 */
export function invalidToken(options: InvalidTokenOptions = {}) {
  const signedOutUserId = options.removeLocalData === true ? getTokenParsed()?.user.id : undefined;

  removeStoredToken();
  // Stop uploads synchronously; retained rows already carry their exact actor,
  // server and workspace. Signing out must not erase recoverable local edits.
  setCurrentSession(null);
  clearDrainConfig();
  emit(EventType.SESSION_INVALID);

  // Removal runs in the background, keeps unsent edits, and stops if the same
  // account signs in again meanwhile.
  if (signedOutUserId) {
    const account = { serverUrl: getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), userId: signedOutUserId };

    // Never let local cleanup interfere with signing out.
    void Promise.resolve()
      .then(() => removeSignedOutLocalData(account, () => getTokenParsed()?.user.id !== signedOutUserId))
      .catch(() => undefined);
  }
}

export function isTokenValid(): boolean {
  // Expiration is deliberately not checked here. An expired, structurally
  // valid token still carries the refresh token used by the HTTP interceptor.
  return getTokenParsed() !== null;
}
