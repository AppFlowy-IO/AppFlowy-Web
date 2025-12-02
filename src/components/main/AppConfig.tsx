import { useLiveQuery } from 'dexie-react-hooks';
import { useSnackbar } from 'notistack';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { clearData, db } from '@/application/db';
import { getService } from '@/application/services';
import { AFServiceConfig } from '@/application/services/services.type';
import { EventType, on } from '@/application/session';
import { getTokenParsed, isTokenValid } from '@/application/session/token';
import { User } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { createInitialTimezone, UserTimezone } from '@/application/user-timezone.types';
import { InfoSnackbarProps } from '@/components/_shared/notify';
import { LoginModal } from '@/components/login';
import { AFConfigContext, defaultConfig } from '@/components/main/app.hooks';
import { useUserTimezone } from '@/components/main/hooks/useUserTimezone';
import { useAppLanguage } from '@/components/main/useAppLanguage';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { Log } from '@/utils/log';

function AppConfig({ children }: { children: React.ReactNode }) {
  const [appConfig] = useState<AFServiceConfig>(defaultConfig);
  const service = useMemo(() => getService(appConfig), [appConfig]);
  const [isAuthenticated, setIsAuthenticated] = React.useState<boolean>(isTokenValid());

  const userId = useMemo(() => {
    if (!isAuthenticated) return;
    return getTokenParsed()?.user?.id;
  }, [isAuthenticated]);

  const currentUser = useLiveQuery(async () => {
    if (!userId) return;
    return db.users.get(userId);
  }, [userId]);
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [loginCompletedRedirectTo, setLoginCompletedRedirectTo] = React.useState<string>('');

  const updateCurrentUser = useCallback(
    async (user: User) => {
      if (!service || !userId) return;

      try {
        await db.users.put(user, user.uuid);
      } catch (e) {
        Log.error(e);
      }
    },
    [service, userId]
  );

  const openLoginModal = useCallback((redirectTo?: string) => {
    setLoginOpen(true);
    setLoginCompletedRedirectTo(redirectTo || window.location.href);
  }, []);

  useEffect(() => {
    return on(EventType.SESSION_VALID, () => {
      setIsAuthenticated(true);
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void (async () => {
      if (!service) return;
      try {
        await service.getCurrentUser();
      } catch (e) {
        Log.error(e);
      }
    })();
  }, [isAuthenticated, service]);

  // Authentication state synchronization effects
  // Note: These are intentionally separate effects with different lifecycles:
  // 1. Storage listener - handles cross-tab token changes
  // 2. State sync on change - bidirectional sync between localStorage and React state
  // 3. Mount sync with delay - safety net for OAuth callback race conditions
  // 4. SESSION_INVALID listener - event-based invalidation from failed API calls
  // Consolidating these would reduce clarity and make debugging harder

  // 1. Cross-tab synchronization via storage events
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'token') setIsAuthenticated(isTokenValid());
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // 2. Bidirectional sync between localStorage token and React state
  // Handles cases where token was saved but state wasn't updated (e.g., after page reload or OAuth callback)
  useEffect(() => {
    const hasToken = isTokenValid();

    Log.debug('[AppConfig] sync check', {
      hasToken,
      isAuthenticated,
      willSync: hasToken && !isAuthenticated,
    });

    // If token exists but state says not authenticated, sync the state
    if (hasToken && !isAuthenticated) {
      Log.debug('[AppConfig] syncing authentication state - token exists but state is false');
      setIsAuthenticated(true);
    }
    // If no token but state says authenticated, invalidate the session
    else if (!hasToken && isAuthenticated) {
      Log.debug('[AppConfig] token removed but state still authenticated - invalidating');
      setIsAuthenticated(false);
    }
  }, [isAuthenticated]);

  // 3. Proactive sync on mount with delay - safety net for OAuth callback race conditions
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const hasToken = isTokenValid();

      Log.debug('[AppConfig] mount sync check', {
        hasToken,
        isAuthenticated,
      });

      if (hasToken && !isAuthenticated) {
        Log.debug('[AppConfig] mount sync - forcing authentication state to true');
        setIsAuthenticated(true);
      }
    }, 100); // Small delay to allow all initialization to complete

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount - isAuthenticated is intentionally captured from closure

  // 4. Event-based session invalidation from failed API calls
  useEffect(() => {
    return on(EventType.SESSION_INVALID, () => {
      setIsAuthenticated(false);
    });
  }, []);
  useAppLanguage();

  const [hasCheckedTimezone, setHasCheckedTimezone] = useState(false);

  // Handle initial timezone setup - only when timezone is not set
  const handleTimezoneSetup = useCallback(
    async (detectedTimezone: string) => {
      if (!isAuthenticated || !service || hasCheckedTimezone) return;

      try {
        // Get current user profile to check if timezone is already set
        const user = await service.getCurrentUser();
        const currentMetadata = user.metadata || {};

        // Check if user has timezone metadata
        const existingTimezone = currentMetadata[MetadataKey.Timezone] as UserTimezone | undefined;

        // Only set timezone if it's not already set (None in Rust = no timezone field or null)
        if (!existingTimezone || existingTimezone.timezone === null || existingTimezone.timezone === undefined) {
          // Create the UserTimezone struct format matching Rust
          const timezoneData = createInitialTimezone(detectedTimezone);

          const metadata = {
            [MetadataKey.Timezone]: timezoneData,
          };

          await service.updateUserProfile(metadata);
          Log.debug('Initial timezone set in user profile:', timezoneData);
        } else {
          Log.debug('User timezone already set, skipping update:', existingTimezone);
        }

        setHasCheckedTimezone(true);
      } catch (e) {
        Log.error('Failed to check/update timezone:', e);
        // Still mark as checked to avoid repeated attempts
        setHasCheckedTimezone(true);
      }
    }, [isAuthenticated, service, hasCheckedTimezone]);

  // Detect timezone once on mount
  useUserTimezone({
    onTimezoneChange: handleTimezoneSetup,
    updateInterval: 0, // Disable periodic checks - only check once
  });

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
  });

  return (
    <AFConfigContext.Provider
      value={{
        service,
        isAuthenticated,
        currentUser,
        updateCurrentUser,
        openLoginModal,
      }}
    >
      {children}
      {loginOpen && (
        <Suspense>
          <LoginModal
            redirectTo={loginCompletedRedirectTo}
            open={loginOpen}
            onClose={() => {
              setLoginOpen(false);
            }}
          />
        </Suspense>
      )}
    </AFConfigContext.Provider>
  );
}

export default AppConfig;
