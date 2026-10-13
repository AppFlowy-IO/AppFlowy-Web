import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { EventType, on } from '@/application/session/event';
import { getToken, parseAuthToken, TOKEN_STORAGE_KEY } from '@/application/session/token-storage';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { useAuthenticatedUserIdOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { getConfigValue } from '@/utils/runtime-config';

const WS_READY_STATE_OPEN = 1;

function readJwtSessionId(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split('.')[1];

    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')));
    const sessionId = (claims as { session_id?: unknown } | null)?.session_id;

    return typeof sessionId === 'string' && sessionId ? sessionId : undefined;
  } catch {
    return;
  }
}

/**
 * Identifies one sign-in session. A routine token refresh rotates both tokens but keeps GoTrue's
 * `session_id`, so it is not a session change. Tokens without that claim fall back to the access
 * token itself: any change is then treated as a new session (the conservative choice).
 * The claim is read without verification; it only decides whether to hide UI, never grants access.
 */
function sessionIdentity(rawToken: string | null | undefined): string {
  const token = rawToken ? parseAuthToken(rawToken) : null;

  if (!token) return '';
  return JSON.stringify([token.user.id, readJwtSessionId(token.access_token) ?? token.access_token]);
}

function isBrowserOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Search text, summaries and mention suggestions remain valid only within one permission/session
 * scope. Two kinds of signals are distinguished:
 *
 * - Hard invalidation (`scope` changes, `isCurrent()` turns false synchronously): a permission or
 *   share hint, or a session change (sign-in, sign-out, another account or session, also from
 *   another tab). Server, account, authentication and workspace changes replace the scope too.
 *   `isSessionCurrent()` only follows the session part, so a mutation that already reached the
 *   server can finish its own follow-up (navigation, inserting a link) after a permission hint.
 * - Soft revalidation (`refreshKey` increments): the realtime socket reopened after a disconnect,
 *   so permission hints may have been missed. Consumers re-run their reads in the background and
 *   keep showing the current snapshot until the replacement arrives.
 *
 * Window focus, tab visibility, connectivity changes and routine token refreshes are neither:
 * they used to blank open results and re-issue every request on each alt-tab.
 */
export function useSearchAccessScope(workspaceId?: string) {
  const emitter = useContext(AppEventEmitterContext);
  const userId = useAuthenticatedUserIdOptional();
  const authenticated = useIsAuthenticatedOptional();
  const server = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const [sessionRevision, setSessionRevision] = useState(0);
  const [permissionRevision, setPermissionRevision] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [online, setOnline] = useState(isBrowserOnline);
  const session = useMemo(
    () => ({ server, userId, authenticated, workspaceId, sessionRevision }),
    [server, userId, authenticated, workspaceId, sessionRevision]
  );
  const scope = useMemo(() => ({ ...session, permissionRevision }), [session, permissionRevision]);
  const currentSession = useRef<object>(session);
  const current = useRef<object>(scope);
  const mounted = useRef(true);

  // Only rendering assigns the live scope; invalidation replaces it until the next render.
  currentSession.current = session;
  current.current = scope;
  const isSessionCurrent = useCallback(
    () =>
      mounted.current &&
      currentSession.current === session &&
      session.authenticated &&
      Boolean(session.userId && session.workspaceId),
    [session]
  );
  const isCurrent = useCallback(() => current.current === scope && isSessionCurrent(), [scope, isSessionCurrent]);

  useEffect(() => {
    mounted.current = true;
    let knownSession = sessionIdentity(getToken());
    // Invalidate synchronously so an already queued response cannot repopulate revoked text
    // before React re-renders. Bursts share the consumers' ordinary debounce/coalescing.
    const invalidatePermissions = () => {
      current.current = {};
      setPermissionRevision((value) => value + 1);
    };

    const invalidateSession = () => {
      knownSession = sessionIdentity(getToken());
      currentSession.current = {};
      current.current = {};
      setSessionRevision((value) => value + 1);
    };

    const compareSession = (rawToken: string | null | undefined) => {
      const next = sessionIdentity(rawToken);

      if (next === knownSession) return;
      knownSession = next;
      currentSession.current = {};
      current.current = {};
      setSessionRevision((value) => value + 1);
    };

    const refreshed = (rawToken?: unknown) => {
      // Every in-app writer passes the saved token. Without it, assume a different session.
      if (typeof rawToken === 'string') compareSession(rawToken);
      else invalidateSession();
    };

    const storage = (event: StorageEvent) => {
      if (event.key === TOKEN_STORAGE_KEY || event.key === null) compareSession(event.newValue);
    };

    let lastReadyState = emitter?.webSocketReadyState;
    let disconnectedSinceOpen = lastReadyState !== undefined && lastReadyState !== WS_READY_STATE_OPEN;
    const socket = (readyState: unknown) => {
      if (readyState === lastReadyState) return;
      lastReadyState = typeof readyState === 'number' ? readyState : undefined;
      if (readyState !== WS_READY_STATE_OPEN) {
        disconnectedSinceOpen = true;
        return;
      }

      if (!disconnectedSinceOpen) return;
      disconnectedSinceOpen = false;
      setRefreshKey((value) => value + 1);
    };

    const wentOnline = () => setOnline(true);
    const wentOffline = () => setOnline(false);

    setOnline(isBrowserOnline());
    // The workspace notification adapter emits this same hint for both object changes and
    // group/workspace-wide changes. Subscribing to both events would reload every broad hint twice.
    emitter?.on(APP_EVENTS.PERMISSION_CHANGED, invalidatePermissions);
    emitter?.on(APP_EVENTS.SHARE_VIEWS_CHANGED, invalidatePermissions);
    emitter?.on(APP_EVENTS.WEBSOCKET_STATUS, socket);
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    window.addEventListener('storage', storage);
    const offInvalid = on(EventType.SESSION_INVALID, invalidateSession);
    const offValid = on(EventType.SESSION_VALID, invalidateSession);
    const offRefresh = on(EventType.SESSION_REFRESH, refreshed);

    return () => {
      mounted.current = false;
      emitter?.off(APP_EVENTS.PERMISSION_CHANGED, invalidatePermissions);
      emitter?.off(APP_EVENTS.SHARE_VIEWS_CHANGED, invalidatePermissions);
      emitter?.off(APP_EVENTS.WEBSOCKET_STATUS, socket);
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
      window.removeEventListener('storage', storage);
      offInvalid();
      offValid();
      offRefresh();
    };
  }, [emitter]);

  return { scope, isCurrent, isSessionCurrent, refreshKey, online };
}
