import { clearRedirectTo } from '@/application/session/sign_in';
import { invalidToken } from '@/application/session/token';
import { Log } from '@/utils/log';

/** Runs for the user signing out (their id when known) before the session ends. */
export type SignOutCleanup = (userId: string | number | null | undefined) => void;

const cleanups = new Set<SignOutCleanup>();

/**
 * Registers device-local state an explicit sign-out clears (a shared device
 * keeps nothing of the user signing out). The app root registers the
 * cleanups, so this module knows no feature code. Returns the unregister.
 */
export function registerSignOutCleanup(cleanup: SignOutCleanup): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/**
 * The one explicit sign-out (the Log out dialogs, a deleted account): the
 * registered cleanups for this user, then the stored redirect and the session
 * token (`SESSION_INVALID`). The caller navigates afterwards. A forced session
 * expiry does not come through here and clears nothing.
 */
export function signOutCurrentUser(userId: string | number | null | undefined) {
  cleanups.forEach((cleanup) => {
    try {
      cleanup(userId);
    } catch (error) {
      Log.warn('[Session] a sign-out cleanup failed', error);
    }
  });
  clearRedirectTo();
  invalidToken();
}
