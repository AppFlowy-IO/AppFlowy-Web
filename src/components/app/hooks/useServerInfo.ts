import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { AuthService } from '@/application/services/domains';
import { Log } from '@/utils/log';
import {
  getServerInfoSnapshot,
  getServerHostingMode,
  isOfficialHostedServer,
  SERVER_INFO_LOADING,
  ServerInfoState,
  ServerHostingMode,
  subscribeToServerInfo,
  updateServerInfo,
} from '@/utils/server-info';

export const SERVER_INFO_REFRESH_INTERVAL_MS = 5 * 60_000;
const REVALIDATE_MIN_AGE_MS = 30_000;

/** Reactive view of the same hosting decision used by non-React error handlers. */
export function useIsOfficialHosted(): boolean {
  return useSyncExternalStore(subscribeToServerInfo, isOfficialHostedServer, () => false);
}

export function useServerHostingMode(): ServerHostingMode {
  return useSyncExternalStore(subscribeToServerInfo, getServerHostingMode, () => 'unknown');
}

export function useIsSelfHosted(): boolean {
  return useServerHostingMode() === 'self-hosted';
}

/** Read capabilities without starting another refresh loop. */
export function useServerInfoState(): ServerInfoState {
  return useSyncExternalStore(subscribeToServerInfo, getServerInfoSnapshot, () => SERVER_INFO_LOADING);
}

/** One cancellable refresh loop owns server capabilities and compatibility metadata. */
export function useServerInfo(enabled: boolean, serverUrl: string): ServerInfoState {
  const getSnapshot = useCallback(
    () => (enabled ? getServerInfoSnapshot(serverUrl) : SERVER_INFO_LOADING),
    [enabled, serverUrl]
  );
  const snapshot = useSyncExternalStore(subscribeToServerInfo, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let lastAttemptAt = 0;
    let retryAttempt = 0;

    updateServerInfo(serverUrl, SERVER_INFO_LOADING);

    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      if (timer) clearTimeout(timer);
      inFlight = true;
      lastAttemptAt = Date.now();
      let nextDelay = SERVER_INFO_REFRESH_INTERVAL_MS;

      try {
        const info = await AuthService.getServerInfo(controller.signal);

        if (controller.signal.aborted) return;
        retryAttempt = 0;
        updateServerInfo(serverUrl, { status: 'available', info });
      } catch (error) {
        if (controller.signal.aborted) return;
        Log.error('[AppAuthLayer] Failed to load server info:', error);

        const unsupported = (error as { code?: number } | null)?.code === 404;

        // A missing endpoint confirms legacy capabilities; transient failures
        // cannot safely decide whether database restore fencing is required.
        // Neither failure can confirm a previous compatibility warning.
        updateServerInfo(serverUrl, { status: unsupported ? 'unsupported' : 'unavailable' });
        if (!unsupported) {
          nextDelay = Math.min(30_000, 1_000 * 2 ** retryAttempt);
          retryAttempt = Math.min(retryAttempt + 1, 5);
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), nextDelay);
      }
    };

    const revalidate = () => {
      if (Date.now() - lastAttemptAt >= REVALIDATE_MIN_AGE_MS) void refresh();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') revalidate();
    };

    void refresh();
    window.addEventListener('online', revalidate);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      controller.abort();
      updateServerInfo(serverUrl, SERVER_INFO_LOADING);
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', revalidate);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, serverUrl]);

  return snapshot;
}
