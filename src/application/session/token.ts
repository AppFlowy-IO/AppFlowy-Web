import { removeSignedOutLocalData } from '@/application/db';
import { emit, EventType } from '@/application/session/event';
import { clearDrainConfig, setCurrentSession } from '@/application/sync-outbox';
import { getConfigValue } from '@/utils/runtime-config';

import { getTokenParsed, memoizeParsedToken, parseAuthToken, removeStoredToken, TOKEN_STORAGE_KEY } from './token-storage';

export { getToken, getTokenParsed } from './token-storage';
export type { GoTrueAuthToken, GoTrueAuthUser } from './token-storage';

export function saveGoTrueAuth(tokenData: string): boolean {
  const parsed = parseAuthToken(tokenData);

  if (!parsed) return false;

  const serialized = JSON.stringify(parsed);

  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, serialized);
  } catch {
    return false;
  }

  memoizeParsedToken(serialized, parsed);
  emit(EventType.SESSION_REFRESH, serialized);
  return true;
}

export function invalidToken() {
  const signedOutUserId = getTokenParsed()?.user.id;

  removeStoredToken();
  // Stop uploads synchronously; retained rows already carry their exact actor,
  // server and workspace. Signing out must not erase recoverable local edits.
  setCurrentSession(null);
  clearDrainConfig();
  emit(EventType.SESSION_INVALID);

  // Copies of server content are not left readable after sign-out. Removal runs
  // in the background, keeps unsent edits, and stops if the same account signs
  // in again meanwhile.
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
