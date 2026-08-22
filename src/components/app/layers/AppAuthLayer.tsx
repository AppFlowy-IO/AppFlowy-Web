import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { AuthService, UserService, WorkspaceService } from '@/application/services/domains';
import { buildLoginUrl } from '@/application/session/sign_in';
import { invalidToken } from '@/application/session/token';
import { UserWorkspaceInfo } from '@/application/types';
import { determineErrorType, ErrorType } from '@/application/utils/error-utils';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

import { AuthInternalContext, AuthInternalContextType } from '../contexts/AuthInternalContext';

interface AppAuthLayerProps {
  children: React.ReactNode;
}

const RETRY_WORKSPACE_INFO_DELAY_MS = 5000;
// Minimum age of the loaded workspace info before a focus/visibility/online
// event triggers a background revalidation.
const REVALIDATE_WORKSPACE_INFO_MIN_AGE_MS = 30_000;

type LoadWorkspaceInfoOptions = { force?: boolean };

function isRetryableWorkspaceInfoError(error: Error): boolean {
  const appError = determineErrorType(error);

  return (
    appError.type === ErrorType.NetworkError ||
    appError.type === ErrorType.ServerError ||
    appError.type === ErrorType.Timeout ||
    appError.type === ErrorType.Unknown
  );
}

/**
 * OAuth Login Flow:
 *
 * 1. User completes Google OAuth → redirects to /auth/callback#access_token=...&refresh_token=...
 * 2. LoginAuth component calls service.loginAuth()
 * 3. signInWithUrl() clears old expired token, then extracts new tokens, calls verifyToken(), then refreshToken()
 * 4. refreshToken() saves token to localStorage via saveGoTrueAuth()
 * 5. SESSION_VALID event is emitted → AppConfig sets isAuthenticated = true
 * 6. afterAuth() does full page navigation: window.location.href = '/app'
 * 7. Page reloads with token in localStorage
 * 8. AppConfig mounts with initial state: isAuthenticated = isTokenValid() (should be TRUE)
 * 9. AppAuthLayer effect runs → sees authenticated user → no logout
 * 10. AppWorkspaceRedirect component loads workspace info and redirects to /app/:workspaceId
 *
 * AppConfig owns the single authentication state. This layer consumes that
 * state and redirects immediately when an app route becomes unauthenticated.
 *
 * AppProvider mounts this layer with `key={authenticatedUserId}`, so every
 * sign-in, sign-out, or account switch remounts it (and every layer below)
 * with fresh state. Nothing here has to reset account-scoped state by hand.
 */

// First layer: Authentication and service initialization
// Handles user authentication, workspace info, and service setup
// Does not depend on workspace ID - establishes basic authentication context
export const AppAuthLayer: React.FC<AppAuthLayerProps> = ({ children }) => {
  const context = useContext(AFConfigContext);
  const hasConfigContext = context !== undefined;
  const isAuthenticated = context?.isAuthenticated;
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const [userWorkspaceInfo, setUserWorkspaceInfo] = useState<UserWorkspaceInfo | undefined>(undefined);
  const [workspaceInfoError, setWorkspaceInfoError] = useState<Error | undefined>(undefined);
  const [enablePageHistory, setEnablePageHistory] = useState<boolean | undefined>(undefined);
  const [aiEnabled, setAIEnabled] = useState<boolean | undefined>(false);
  const [maxUpdateBytes, setMaxUpdateBytes] = useState<number | undefined>(undefined);
  const [maxSlowSyncUpdateBytes, setMaxSlowSyncUpdateBytes] = useState<number | undefined>(undefined);
  const [syncLimitsLoaded, setSyncLimitsLoaded] = useState(false);
  const workspaceInfoPromiseRef = useRef<Promise<UserWorkspaceInfo | undefined> | null>(null);
  const workspaceInfoRequestIdRef = useRef(0);
  const workspaceInfoLoadedAtRef = useRef(0);
  const pendingWorkspaceChangeRef = useRef<string | null>(null);

  // Calculate current workspace ID from URL params or user info
  const currentWorkspaceId = useMemo(
    () => params.workspaceId || userWorkspaceInfo?.selectedWorkspace.id,
    [params.workspaceId, userWorkspaceInfo?.selectedWorkspace.id]
  );

  // Handle user logout
  const logout = useCallback(() => {
    invalidToken();
    navigate(buildLoginUrl({ redirectTo: window.location.href }));
  }, [navigate]);

  // Load user workspace information
  const loadUserWorkspaceInfo = useCallback(async (options?: LoadWorkspaceInfoOptions) => {
    if (!options?.force && workspaceInfoPromiseRef.current) {
      return workspaceInfoPromiseRef.current;
    }

    const requestId = workspaceInfoRequestIdRef.current + 1;

    workspaceInfoRequestIdRef.current = requestId;
    setWorkspaceInfoError(undefined);

    const promise = Promise.resolve()
      .then(() => UserService.getWorkspaceInfo())
      .then((res) => {
        if (workspaceInfoRequestIdRef.current === requestId) {
          workspaceInfoLoadedAtRef.current = Date.now();
          setUserWorkspaceInfo(res);
        }

        return res;
      })
      .catch((e) => {
        Log.error('[AppAuthLayer] Failed to load workspace info:', e);

        if (workspaceInfoRequestIdRef.current === requestId) {
          setWorkspaceInfoError(e instanceof Error ? e : new Error(String(e)));
        }

        return undefined;
      })
      .finally(() => {
        if (workspaceInfoPromiseRef.current === promise && workspaceInfoRequestIdRef.current === requestId) {
          workspaceInfoPromiseRef.current = null;
        }
      });

    workspaceInfoPromiseRef.current = promise;
    return promise;
  }, []);

  // Handle workspace change
  const onChangeWorkspace = useCallback(
    async (workspaceId: string) => {
      if (userWorkspaceInfo && !userWorkspaceInfo.workspaces.some((w) => w.id === workspaceId)) {
        window.location.href = `/app/${workspaceId}`;
        return;
      }

      pendingWorkspaceChangeRef.current = workspaceId;

      try {
        await WorkspaceService.open(workspaceId);

        const workspaceInfo = await loadUserWorkspaceInfo({ force: true });

        // Clean up old global key for backward compatibility
        // New per-workspace-per-user keys don't need to be removed on workspace change
        localStorage.removeItem('last_view_id');

        // Keep the URL transition behind the workspace-info refresh so
        // workspace-scoped consumers never see the new URL with old metadata.
        // pendingWorkspaceChangeRef suppresses the inverse intermediate state:
        // the new server selection with the previous URL.
        navigate(`/app/${workspaceId}`);

        // A failed or inconsistent refresh should fall back to the URL-driven
        // auto-switch path instead of leaving it suppressed indefinitely.
        if (workspaceInfo?.selectedWorkspace.id !== workspaceId && pendingWorkspaceChangeRef.current === workspaceId) {
          pendingWorkspaceChangeRef.current = null;
        }
      } catch (error) {
        if (pendingWorkspaceChangeRef.current === workspaceId) {
          pendingWorkspaceChangeRef.current = null;
        }

        throw error;
      }
    },
    [loadUserWorkspaceInfo, navigate, userWorkspaceInfo]
  );

  // AppConfig initializes synchronously from storage and owns all session events,
  // so this layer does not need timer-based token polling or a second auth source.
  useEffect(() => {
    if (!hasConfigContext || isAuthenticated) return;
    if (location.pathname === '/login' || location.pathname.startsWith('/auth/callback')) return;

    logout();
  }, [hasConfigContext, isAuthenticated, location.pathname, logout]);

  // Load user workspace info and server info on mount. An unauthenticated
  // instance only exists for the commit in which AppProvider remounts this
  // layer, so there is no account-scoped state to clear here.
  useEffect(() => {
    if (!isAuthenticated) return;

    void loadUserWorkspaceInfo();

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    const serverInfoAbortController = new AbortController();

    const loadServerInfo = () => {
      void AuthService.getServerInfo(serverInfoAbortController.signal)
        .then((info) => {
          if (cancelled) return;

          setEnablePageHistory(info.enable_page_history);
          setAIEnabled(info.ai_enabled ?? true);
          setMaxUpdateBytes(info.max_update_bytes);
          setMaxSlowSyncUpdateBytes(info.max_slow_sync_update_bytes);
          // A successful response that omits the optional fields is an older
          // server, not a loading state. The outbox can now safely use its
          // legacy realtime default while keeping the HTTP slow lane disabled.
          setSyncLimitsLoaded(true);
        })
        .catch((e) => {
          if (cancelled) return;

          console.error('[AppAuthLayer] Failed to load server info:', e);
          setEnablePageHistory(true);
          setAIEnabled(true);
          setMaxUpdateBytes(undefined);
          setMaxSlowSyncUpdateBytes(undefined);
          setSyncLimitsLoaded(false);

          const delayMs = Math.min(30_000, 1_000 * 2 ** retryAttempt);

          retryAttempt += 1;
          retryTimer = setTimeout(loadServerInfo, delayMs);
        });
    };

    setSyncLimitsLoaded(false);
    loadServerInfo();

    return () => {
      cancelled = true;
      serverInfoAbortController.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [loadUserWorkspaceInfo, isAuthenticated]);

  // If the app boots while the server is down, the first workspace-info request
  // can fail before the workspace layers mount. Keep retrying transient failures
  // so returning services can recover without a manual page refresh.
  useEffect(() => {
    if (!isAuthenticated || userWorkspaceInfo || !workspaceInfoError) return;
    if (!isRetryableWorkspaceInfoError(workspaceInfoError)) return;

    let cancelled = false;

    const retry = () => {
      if (cancelled) return;
      void loadUserWorkspaceInfo();
    };

    const retryTimeoutId = window.setTimeout(retry, RETRY_WORKSPACE_INFO_DELAY_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        retry();
      }
    };

    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimeoutId);
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, userWorkspaceInfo, workspaceInfoError, loadUserWorkspaceInfo]);

  // Once loaded, the workspace list (names, icons, roles, member counts) is a
  // mount-time snapshot: nothing else re-reads it and there is no membership
  // WebSocket notification. Revalidate on focus/visibility/online (throttled)
  // so changes made on other devices eventually reach a long-lived tab.
  useEffect(() => {
    if (!isAuthenticated || !userWorkspaceInfo) return;

    const revalidate = () => {
      if (Date.now() - workspaceInfoLoadedAtRef.current < REVALIDATE_WORKSPACE_INFO_MIN_AGE_MS) return;
      void loadUserWorkspaceInfo();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        revalidate();
      }
    };

    window.addEventListener('online', revalidate);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', revalidate);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, userWorkspaceInfo, loadUserWorkspaceInfo]);

  const retryLoadWorkspaceInfo = useCallback(() => loadUserWorkspaceInfo({ force: true }), [loadUserWorkspaceInfo]);
  const refreshUserWorkspaceInfo = useCallback(() => loadUserWorkspaceInfo({ force: true }), [loadUserWorkspaceInfo]);

  // Auto-switch workspace when the URL points to a different workspace than
  // the currently selected one (e.g. guest opening a shared direct link).
  // Directly call WorkspaceService.open — the server is the authority on
  // access. If the user has permission the switch succeeds; if not it fails
  // and we stay on the current workspace.
  const attemptedWorkspaceOpenRef = useRef<string | null>(null);

  useEffect(() => {
    const urlWorkspaceId = params.workspaceId;

    if (!isAuthenticated || !urlWorkspaceId || !userWorkspaceInfo) return;

    const selectedId = userWorkspaceInfo.selectedWorkspace.id;
    const pendingWorkspaceId = pendingWorkspaceChangeRef.current;

    if (pendingWorkspaceId) {
      if (urlWorkspaceId === pendingWorkspaceId && selectedId === pendingWorkspaceId) {
        pendingWorkspaceChangeRef.current = null;
      } else {
        return;
      }
    }

    // Already on the correct workspace
    if (urlWorkspaceId === selectedId) return;

    // Don't retry a workspace we've already attempted to open for this URL —
    // guards against loops if the server returns success but doesn't update
    // the selected workspace (e.g. stale permission cache).
    if (attemptedWorkspaceOpenRef.current === urlWorkspaceId) return;
    attemptedWorkspaceOpenRef.current = urlWorkspaceId;

    Log.debug('[AppAuthLayer] auto-switching to URL workspace', { urlWorkspaceId, selectedId });
    void WorkspaceService.open(urlWorkspaceId)
      .then(() => loadUserWorkspaceInfo({ force: true }))
      .catch((e) => Log.warn('[AppAuthLayer] failed to open URL workspace', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, params.workspaceId, userWorkspaceInfo?.selectedWorkspace.id, loadUserWorkspaceInfo]);

  // Context value for authentication layer
  const authContextValue: AuthInternalContextType = useMemo(
    () => ({
      userWorkspaceInfo,
      currentWorkspaceId,
      isAuthenticated: !!isAuthenticated,
      enablePageHistory,
      aiEnabled,
      maxUpdateBytes,
      maxSlowSyncUpdateBytes,
      syncLimitsLoaded,
      onChangeWorkspace,
      workspaceInfoError,
      retryLoadWorkspaceInfo,
      refreshUserWorkspaceInfo,
    }),
    [
      userWorkspaceInfo,
      currentWorkspaceId,
      isAuthenticated,
      enablePageHistory,
      aiEnabled,
      maxUpdateBytes,
      maxSlowSyncUpdateBytes,
      syncLimitsLoaded,
      onChangeWorkspace,
      workspaceInfoError,
      retryLoadWorkspaceInfo,
      refreshUserWorkspaceInfo,
    ]
  );

  return <AuthInternalContext.Provider value={authContextValue}>{children}</AuthInternalContext.Provider>;
};
