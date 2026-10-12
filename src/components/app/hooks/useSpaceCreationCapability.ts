import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import {
  compareWorkspacePermissionRevisions,
  isWorkspacePermissionRevision,
  WorkspacePermissionRevision,
  WorkspacePermissionsChanged,
  WorkspaceSpaceCreationCapabilities,
} from '@/application/workspace-permissions';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';
import { createCoalescedRefresh } from '@/utils/coalesced-refresh';
import { isUnsupportedRouteError } from '@/utils/errors';
import { getConfigValue } from '@/utils/runtime-config';

type Snapshot = {
  scope: object;
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  capability?: WorkspaceSpaceCreationCapabilities;
  error?: unknown;
};

/** Live admission hints. Publication still rechecks current authority on the server. */
export function useSpaceCreationCapability(workspaceId?: string, enabled = true) {
  const auth = useContext(AuthInternalContext);
  const eventEmitter = useContext(AppEventEmitterContext);
  const userId = useAuthenticatedUserIdOptional();
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const active = Boolean(
    enabled && userId && workspaceId && auth?.isAuthenticated && auth.currentWorkspaceId === workspaceId
  );
  const scope = useMemo(
    () => ({
      serverUrl,
      userId,
      workspaceId,
      active,
      refresh: createCoalescedRefresh<WorkspaceSpaceCreationCapabilities | undefined>(),
    }),
    [serverUrl, userId, workspaceId, active]
  );
  const liveScope = useRef(scope);
  const sequence = useRef(0);
  const minimumRevision = useRef<{ scope: object; revision: WorkspacePermissionRevision }>();
  const [snapshot, setSnapshot] = useState<Snapshot>();

  // Scope equality also fences the render before effect cleanup, including an A→B→A switch.
  liveScope.current = scope;

  const refresh = useCallback((): Promise<WorkspaceSpaceCreationCapabilities | undefined> => {
    const request = ++sequence.current;
    const isCurrent = () => liveScope.current === scope && sequence.current === request;

    if (!scope.active || !scope.workspaceId) return Promise.resolve(undefined);
    setSnapshot({ scope, status: 'loading' });
    const id = scope.workspaceId;

    return scope.refresh(async () => {
      if (!isCurrent()) return;
      try {
        if (!navigator.onLine) throw new Error('Offline');
        const capability = await WorkspaceService.getWorkspaceSpaceCreationCapabilities(id);

        if (!isCurrent()) return;
        const floor = minimumRevision.current;

        if (floor?.scope === scope && compareWorkspacePermissionRevisions(capability.revision, floor.revision) < 0) {
          throw new Error('Permission state changed while loading');
        }

        minimumRevision.current = { scope, revision: capability.revision };
        setSnapshot({ scope, status: 'ready', capability });
        return capability;
      } catch (error) {
        if (isCurrent()) setSnapshot({ scope, status: isUnsupportedRouteError(error) ? 'unsupported' : 'error', error });
      }
    });
  }, [scope]);

  useEffect(() => {
    void refresh();
    return () => {
      sequence.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const invalidate = () => {
      void refresh();
    };

    const handleHint = (hint: WorkspacePermissionsChanged) => {
      if (hint?.workspaceId !== workspaceId || !isWorkspacePermissionRevision(hint.revision)) return;
      const floor = minimumRevision.current;

      if (floor?.scope === scope && compareWorkspacePermissionRevisions(hint.revision, floor.revision) <= 0) return;
      minimumRevision.current = { scope, revision: hint.revision };
      invalidate();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') invalidate();
    };

    eventEmitter?.on(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, handleHint);
    eventEmitter?.on(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, invalidate);
    eventEmitter?.on(APP_EVENTS.SERVER_LIMIT_CHANGED, invalidate);
    eventEmitter?.on(APP_EVENTS.WEBSOCKET_STATUS, invalidate);
    window.addEventListener('online', invalidate);
    window.addEventListener('offline', invalidate);
    window.addEventListener('focus', invalidate);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      eventEmitter?.off(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, handleHint);
      eventEmitter?.off(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, invalidate);
      eventEmitter?.off(APP_EVENTS.SERVER_LIMIT_CHANGED, invalidate);
      eventEmitter?.off(APP_EVENTS.WEBSOCKET_STATUS, invalidate);
      window.removeEventListener('online', invalidate);
      window.removeEventListener('offline', invalidate);
      window.removeEventListener('focus', invalidate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [active, eventEmitter, refresh, scope, workspaceId]);

  const current = active && snapshot?.scope === scope ? snapshot : undefined;

  return {
    status: current?.status ?? 'loading',
    capability: current?.capability,
    canCreateSpace: current?.capability?.can_create_space === true,
    error: current?.error,
    refresh,
    // Dialogs with in-flight mutations can key their local draft state to this identity.
    scopeKey: JSON.stringify([serverUrl, userId, workspaceId]),
  };
}
