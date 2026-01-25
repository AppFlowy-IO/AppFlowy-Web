import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { invalidToken, isTokenValid } from '@/application/session/token';
import { UserWorkspaceInfo } from '@/application/types';
import { AFConfigContext, useService } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

import { AuthInternalContext, AuthInternalContextType } from '../contexts/AuthInternalContext';

interface AppAuthLayerProps {
  children: React.ReactNode;
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
 * Race Condition Fixes:
 * - Old token cleared BEFORE OAuth processing to prevent axios interceptor auto-refresh race
 * - Multi-stage auth checks (50ms + 100ms delays) to wait for React state sync
 * - Proactive state sync in AppConfig to force isAuthenticated sync on mount
 */

// First layer: Authentication and service initialization
// Handles user authentication, workspace info, and service setup
// Does not depend on workspace ID - establishes basic authentication context
export const AppAuthLayer: React.FC<AppAuthLayerProps> = ({ children }) => {
  const context = useContext(AFConfigContext);
  const isAuthenticated = context?.isAuthenticated;
  const location = useLocation();
  const service = useService();
  const navigate = useNavigate();
  const params = useParams();

  const [userWorkspaceInfo, setUserWorkspaceInfo] = useState<UserWorkspaceInfo | undefined>(undefined);

  // Calculate current workspace ID from URL params or user info
  const currentWorkspaceId = useMemo(
    () => params.workspaceId || userWorkspaceInfo?.selectedWorkspace.id,
    [params.workspaceId, userWorkspaceInfo?.selectedWorkspace.id]
  );

  // Handle user logout
  const logout = useCallback(() => {
    invalidToken();
    navigate(`/login?redirectTo=${encodeURIComponent(window.location.href)}`);
  }, [navigate]);

  // Load user workspace information
  const loadUserWorkspaceInfo = useCallback(async () => {
    if (!service) return;
    try {
      const res = await service?.getUserWorkspaceInfo();

      setUserWorkspaceInfo(res);
      return res;
    } catch (e) {
      console.error(e);
    }
  }, [service]);

  // Handle workspace change
  const onChangeWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!service) return;
      if (userWorkspaceInfo && !userWorkspaceInfo.workspaces.some((w) => w.id === workspaceId)) {
        window.location.href = `/app/${workspaceId}`;
        return;
      }

      await service?.openWorkspace(workspaceId);

      await loadUserWorkspaceInfo();

      // Clean up old global key for backward compatibility
      // New per-workspace-per-user keys don't need to be removed on workspace change
      localStorage.removeItem('last_view_id');

      navigate(`/app/${workspaceId}`);
    },
    [loadUserWorkspaceInfo, navigate, service, userWorkspaceInfo]
  );

  // If the user is not authenticated, log out the user
  // But check localStorage token first to avoid redirect loops after login
  // This handles the race condition where token exists but React state hasn't synced yet
  useEffect(() => {
    // Don't check if we're already on login/auth pages
    if (location.pathname === '/login' || location.pathname.startsWith('/auth/callback')) {
      return;
    }

    // Multi-stage timeout to handle various race conditions:
    // 1. Wait for React context to initialize (50ms)
    // 2. Check token and auth state multiple times to handle async state updates
    // 3. Only logout if consistently unauthenticated across multiple checks
    let secondCheckTimeoutId: number | null = null;

    const timeoutId = window.setTimeout(() => {
      // First check - token and auth state
      const hasToken = isTokenValid();

      Log.debug('[AppAuthLayer] auth check (initial)', {
        path: location.pathname,
        isAuthenticated,
        hasToken,
        contextReady: !!context,
      });

      // If token exists, trust it and wait for state to sync
      // This prevents logout during OAuth callback → /app navigation
      if (hasToken) {
        Log.debug('[AppAuthLayer] token exists, skipping logout check (waiting for state sync)');
        return;
      }

      // If no token but we're not sure context is ready, don't logout yet
      if (!context) {
        Log.debug('[AppAuthLayer] context not ready, skipping logout check');
        return;
      }

      // Double-check after additional delay to handle async state updates
      // This catches cases where token was just saved but state hasn't propagated
      secondCheckTimeoutId = window.setTimeout(() => {
        const hasTokenSecondCheck = isTokenValid();
        const isAuthenticatedSecondCheck = context?.isAuthenticated;

        Log.debug('[AppAuthLayer] auth check (second)', {
          path: location.pathname,
          isAuthenticated: isAuthenticatedSecondCheck,
          hasToken: hasTokenSecondCheck,
          contextReady: !!context,
        });

        // Only redirect if BOTH checks confirm no authentication:
        // 1. Context exists and says not authenticated
        // 2. No token exists in localStorage (checked twice)
        // 3. Still on the same page (user didn't navigate away)
        if (context && !isAuthenticatedSecondCheck && !hasTokenSecondCheck) {
          console.warn('[AppAuthLayer] redirecting to /login because auth check failed (double-checked)', {
            path: location.pathname,
            isAuthenticated: isAuthenticatedSecondCheck,
            hasToken: hasTokenSecondCheck,
            hasContext: !!context,
          });
          logout();
        } else if (hasTokenSecondCheck && !isAuthenticatedSecondCheck) {
          Log.debug('[AppAuthLayer] token exists but state not synced - will sync via AppConfig effect');
        }
      }, 100); // Additional 100ms delay for second check
    }, 50); // Initial delay to allow context to initialize

    return () => {
      window.clearTimeout(timeoutId);
      if (secondCheckTimeoutId !== null) {
        window.clearTimeout(secondCheckTimeoutId);
      }
    };
  }, [isAuthenticated, location.pathname, logout, context]);

  // Load user workspace info on mount
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void loadUserWorkspaceInfo().catch((e) => {
      console.error('[AppAuthLayer] Failed to load workspace info:', e);
    });
  }, [loadUserWorkspaceInfo, isAuthenticated]);

  // Context value for authentication layer
  const authContextValue: AuthInternalContextType = useMemo(
    () => ({
      service,
      userWorkspaceInfo,
      currentWorkspaceId,
      isAuthenticated: !!isAuthenticated,
      onChangeWorkspace,
    }),
    [service, userWorkspaceInfo, currentWorkspaceId, isAuthenticated, onChangeWorkspace]
  );

  return <AuthInternalContext.Provider value={authContextValue}>{children}</AuthInternalContext.Provider>;
};
