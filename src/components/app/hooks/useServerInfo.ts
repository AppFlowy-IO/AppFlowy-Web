import { useEffect, useState } from 'react';

import { AuthService } from '@/application/services/domains';
import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import { Log } from '@/utils/log';

export const SERVER_INFO_REFRESH_INTERVAL_MS = 5 * 60_000;
const REVALIDATE_MIN_AGE_MS = 30_000;

type ServerInfoState =
  | { status: 'loading' | 'unavailable'; info?: undefined }
  | { status: 'available'; info: ServerInfo };

const loading: ServerInfoState = { status: 'loading' };

/** One cancellable refresh loop owns server capabilities and compatibility metadata. */
export function useServerInfo(enabled: boolean, serverUrl: string): ServerInfoState {
  const [snapshot, setSnapshot] = useState<{ serverUrl: string; state: ServerInfoState }>();

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let lastAttemptAt = 0;
    let retryAttempt = 0;

    setSnapshot({ serverUrl, state: loading });

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
        setSnapshot({ serverUrl, state: { status: 'available', info } });
      } catch (error) {
        if (controller.signal.aborted) return;
        Log.error('[AppAuthLayer] Failed to load server info:', error);
        // A failed refresh cannot confirm a previous compatibility warning.
        setSnapshot({ serverUrl, state: { status: 'unavailable' } });
        const unsupported = (error as { code?: number } | null)?.code === 404;

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
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', revalidate);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, serverUrl]);

  return enabled && snapshot?.serverUrl === serverUrl ? snapshot.state : loading;
}
