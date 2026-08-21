import { useLiveQuery } from 'dexie-react-hooks';
import { useSnackbar } from 'notistack';
import React, { Suspense, useCallback, useEffect, useMemo } from 'react';

import { clearData, db } from '@/application/db';
import { UserService } from '@/application/services/domains';
import { clearHttpResponseCaches, initAPIService } from '@/application/services/js-services/http/core';
import { EventType, on } from '@/application/session';
import { getTokenParsed, isTokenValid } from '@/application/session/token';
import { User } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { createInitialTimezone, UserTimezone } from '@/application/user-timezone.types';
import { InfoSnackbarProps } from '@/components/_shared/notify';
import { AFConfigContext, defaultConfig } from '@/components/main/app.hooks';
import { useUserTimezone } from '@/components/main/hooks/useUserTimezone';
import { useAppLanguage } from '@/components/main/useAppLanguage';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { Log } from '@/utils/log';

initAPIService(defaultConfig);

const LoginModal = React.lazy(() => import('@/components/login/LoginModal'));

interface AuthenticationState {
  isAuthenticated: boolean;
  userId?: string;
}

function readAuthenticationState(): AuthenticationState {
  const isAuthenticated = isTokenValid();

  return {
    isAuthenticated,
    userId: isAuthenticated ? getTokenParsed()?.user?.id : undefined,
  };
}

function AppConfig({ children }: { children: React.ReactNode }) {
  const [authenticationState, setAuthenticationState] = React.useState<AuthenticationState>(readAuthenticationState);
  const authenticatedUserIdRef = React.useRef(authenticationState.userId);
  const { isAuthenticated, userId } = authenticationState;

  const currentUser = useLiveQuery(async () => {
    if (!userId) return;
    return db.users.get(userId);
  }, [userId]);
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [loginCompletedRedirectTo, setLoginCompletedRedirectTo] = React.useState<string>('');

  const updateCurrentUser = useCallback(
    async (user: User) => {
      if (!userId) return;

      try {
        await db.users.put(user, user.uuid);
      } catch (e) {
        Log.error(e);
      }
    },
    [userId]
  );

  const openLoginModal = useCallback((redirectTo?: string) => {
    setLoginOpen(true);
    setLoginCompletedRedirectTo(redirectTo || window.location.href);
  }, []);

  useEffect(() => {
    const syncAuthenticationState = (clearUserCaches = false) => {
      const nextState = readAuthenticationState();
      const switchedAccount =
        authenticatedUserIdRef.current !== undefined &&
        nextState.userId !== undefined &&
        authenticatedUserIdRef.current !== nextState.userId;

      if (clearUserCaches || !nextState.isAuthenticated || switchedAccount) clearHttpResponseCaches();
      authenticatedUserIdRef.current = nextState.userId;
      setAuthenticationState(nextState);
    };

    const invalidateAuthenticationState = () => {
      // The HTTP ETag/response cache is keyed by URL without user identity.
      // Drop it before another account can sign in within this tab.
      clearHttpResponseCaches();
      authenticatedUserIdRef.current = undefined;
      setAuthenticationState({ isAuthenticated: false });
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== 'token') return;
      // A token replacement may belong to another account even when an opaque
      // access token has no decodable user claim. Clear URL-keyed caches for
      // every cross-tab replacement; same-account refreshes simply pay a small
      // cache miss.
      syncAuthenticationState(true);
    };

    const unsubscribeValid = on(EventType.SESSION_VALID, () => syncAuthenticationState());
    const unsubscribeInvalid = on(EventType.SESSION_INVALID, invalidateAuthenticationState);

    window.addEventListener('storage', handleStorageChange);
    return () => {
      unsubscribeValid();
      unsubscribeInvalid();
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);
  useAppLanguage();

  const timezoneInfo = useUserTimezone({ updateInterval: 0 });

  // Fetch the profile once per authenticated user. The cache layer persists the
  // response for currentUser, and the same response owns the one-time timezone
  // initialization so startup does not issue duplicate profile requests.
  useEffect(() => {
    const detectedTimezone = timezoneInfo?.timezone;

    if (!userId || !detectedTimezone) return;

    let cancelled = false;

    void UserService.getCurrent()
      .then(async (user) => {
        if (cancelled || user.uuid !== userId) return;

        const existingTimezone = user.metadata?.[MetadataKey.Timezone] as UserTimezone | undefined;

        if (existingTimezone?.timezone !== null && existingTimezone?.timezone !== undefined) {
          return;
        }

        const timezoneData = createInitialTimezone(detectedTimezone);

        await UserService.updateProfile({
          [MetadataKey.Timezone]: timezoneData,
        });

        if (!cancelled) {
          Log.debug('Initial timezone set in user profile:', timezoneData);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          Log.error('Failed to load the current user or initialize timezone:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [timezoneInfo?.timezone, userId]);

  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  useEffect(() => {
    window.toast = {
      success: (message: string | React.ReactNode) => {
        enqueueSnackbar(message, { variant: 'success' });
      },
      error: (message: string | React.ReactNode) => {
        enqueueSnackbar(message, { variant: 'error' });
      },
      warning: (message: string | React.ReactNode) => {
        enqueueSnackbar(message, { variant: 'warning' });
      },
      default: (message: string | React.ReactNode) => {
        enqueueSnackbar(message, { variant: 'default' });
      },

      info: (props: InfoSnackbarProps) => {
        enqueueSnackbar(props.message, props);
      },

      clear: () => {
        closeSnackbar();
      },
    };
  }, [closeSnackbar, enqueueSnackbar]);

  useEffect(() => {
    const handleClearData = (e: KeyboardEvent) => {
      switch (true) {
        case createHotkey(HOT_KEY_NAME.CLEAR_CACHE)(e):
          e.stopPropagation();
          e.preventDefault();
          void clearData().then(() => {
            window.location.reload();
          });
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleClearData);
    return () => {
      window.removeEventListener('keydown', handleClearData);
    };
  }, []);
  const closeLoginModal = useCallback(() => setLoginOpen(false), []);

  const configContextValue = useMemo(
    () => ({
      isAuthenticated,
      authenticatedUserId: userId,
      currentUser,
      updateCurrentUser,
      openLoginModal,
    }),
    [isAuthenticated, userId, currentUser, updateCurrentUser, openLoginModal]
  );

  return (
    <AFConfigContext.Provider value={configContextValue}>
      {children}
      {loginOpen && (
        <Suspense fallback={null}>
          <LoginModal redirectTo={loginCompletedRedirectTo} open={loginOpen} onClose={closeLoginModal} />
        </Suspense>
      )}
    </AFConfigContext.Provider>
  );
}

export default AppConfig;
