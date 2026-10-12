import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import {
  getWorkspaceCreationCapability,
  WorkspaceCreationCapability,
} from '@/application/services/js-services/http/workspace-creation-api';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { useAuthenticatedUserIdOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { isUnsupportedRouteError } from '@/utils/errors';
import { getConfigValue } from '@/utils/runtime-config';

type Snapshot = {
  scope: object;
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  capability?: WorkspaceCreationCapability;
};

/** Actor-local permission, usable on /import before any workspace is selected. */
export function useWorkspaceCreationCapability(enabled = true) {
  const userId = useAuthenticatedUserIdOptional();
  const authenticated = useIsAuthenticatedOptional();
  const eventEmitter = useContext(AppEventEmitterContext);
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const scope = useMemo(
    () => ({ userId, serverUrl, active: enabled && authenticated }),
    [userId, serverUrl, enabled, authenticated]
  );
  const liveScope = useRef<object | null>(scope);
  const sequence = useRef(0);
  const latestRevision = useRef<{ scope: object; value: bigint }>();
  const [snapshot, setSnapshot] = useState<Snapshot>();

  liveScope.current = scope;
  const isCurrent = useCallback(() => liveScope.current === scope, [scope]);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;

    if (!scope.active || !scope.userId) return;
    setSnapshot({ scope, status: 'loading' });
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const capability = await getWorkspaceCreationCapability();

      if (!isCurrent() || request !== sequence.current) return;
      const previous = latestRevision.current;
      const revision = BigInt(capability.revision);

      if (previous?.scope === scope && revision < previous.value) throw new Error('Stale workspace creation capability');
      latestRevision.current = { scope, value: revision };
      setSnapshot({ scope, status: 'ready', capability });
      return capability;
    } catch (error) {
      if (isCurrent() && request === sequence.current)
        setSnapshot({ scope, status: isUnsupportedRouteError(error) ? 'unsupported' : 'error' });
    }
  }, [scope, isCurrent]);

  useEffect(() => {
    liveScope.current = scope;
    void refresh();
    return () => {
      sequence.current += 1;
      liveScope.current = null;
    };
  }, [refresh, scope]);
  useEffect(() => {
    if (!scope.active) return;
    const revalidate = () => {
      void refresh();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidate();
    };

    window.addEventListener('focus', revalidate);
    window.addEventListener('online', revalidate);
    window.addEventListener('offline', revalidate);
    document.addEventListener('visibilitychange', onVisible);
    eventEmitter?.on(APP_EVENTS.WEBSOCKET_STATUS, revalidate);
    eventEmitter?.on(APP_EVENTS.PERMISSION_CHANGED, revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('online', revalidate);
      window.removeEventListener('offline', revalidate);
      document.removeEventListener('visibilitychange', onVisible);
      eventEmitter?.off(APP_EVENTS.WEBSOCKET_STATUS, revalidate);
      eventEmitter?.off(APP_EVENTS.PERMISSION_CHANGED, revalidate);
    };
  }, [scope, refresh, eventEmitter]);
  const current = snapshot?.scope === scope ? snapshot : undefined;

  return {
    status: current?.status ?? 'loading',
    canCreate: current?.status === 'ready' && current.capability?.can_create_workspace === true,
    refresh,
    isCurrent,
    scopeKey: `${serverUrl}:${userId ?? ''}`,
    capability: current?.capability,
  };
}
