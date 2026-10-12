import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { EventType, on } from '@/application/session/event';
import { TOKEN_STORAGE_KEY } from '@/application/session/token-storage';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { useAuthenticatedUserIdOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { getConfigValue } from '@/utils/runtime-config';

/** Search text and summaries remain valid only within one current permission/session scope.
 * Invalidate synchronously so an already queued response cannot repopulate revoked text before
 * React runs effect cleanup. Bursts share the search component's ordinary debounce.
 */
export function useSearchAccessScope(workspaceId?: string) {
  const emitter = useContext(AppEventEmitterContext);
  const userId = useAuthenticatedUserIdOptional();
  const authenticated = useIsAuthenticatedOptional();
  const server = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const [revision, setRevision] = useState(0);
  const scope = useMemo(
    () => ({ server, userId, authenticated, workspaceId, revision }),
    [server, userId, authenticated, workspaceId, revision]
  );
  const current = useRef<object>(scope);

  current.current = scope;
  const isCurrent = useCallback(
    () => current.current === scope && scope.authenticated && Boolean(scope.userId && scope.workspaceId),
    [scope]
  );

  useEffect(() => {
    current.current = scope;
    const invalidate = () => {
      current.current = {};
      setRevision((value) => value + 1);
    };

    const visible = () => {
      if (document.visibilityState === 'visible') invalidate();
    };

    const storage = (event: StorageEvent) => {
      if (event.key === TOKEN_STORAGE_KEY || event.key === null) invalidate();
    };

    // The workspace notification adapter emits this same hint for both object changes and
    // group/workspace-wide changes. Subscribing to both events would reload every broad hint twice.
    emitter?.on(APP_EVENTS.PERMISSION_CHANGED, invalidate);
    emitter?.on(APP_EVENTS.SHARE_VIEWS_CHANGED, invalidate);
    emitter?.on(APP_EVENTS.WEBSOCKET_STATUS, invalidate);
    window.addEventListener('focus', invalidate);
    window.addEventListener('online', invalidate);
    window.addEventListener('offline', invalidate);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    const offInvalid = on(EventType.SESSION_INVALID, invalidate);
    const offValid = on(EventType.SESSION_VALID, invalidate);
    const offRefresh = on(EventType.SESSION_REFRESH, invalidate);

    return () => {
      current.current = {};
      emitter?.off(APP_EVENTS.PERMISSION_CHANGED, invalidate);
      emitter?.off(APP_EVENTS.SHARE_VIEWS_CHANGED, invalidate);
      emitter?.off(APP_EVENTS.WEBSOCKET_STATUS, invalidate);
      window.removeEventListener('focus', invalidate);
      window.removeEventListener('online', invalidate);
      window.removeEventListener('offline', invalidate);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
      offInvalid();
      offValid();
      offRefresh();
    };
  }, [emitter, scope]);

  return { scope, isCurrent };
}
