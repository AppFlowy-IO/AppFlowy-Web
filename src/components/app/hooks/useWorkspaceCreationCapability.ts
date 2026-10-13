import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import {
  getWorkspaceCreationCapability,
  WorkspaceCreationCapability,
} from '@/application/services/js-services/http/workspace-creation-api';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { useAuthenticatedUserIdOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { getConfigValue } from '@/utils/runtime-config';

type Snapshot = {
  scope: object;
  status: 'loading' | 'ready' | 'error';
  capability?: WorkspaceCreationCapability;
};

/** Focus and visibility only re-ask once the confirmed answer is this old. */
const REVALIDATE_MIN_AGE_MS = 30_000;
const WEBSOCKET_OPEN = 1;

/**
 * Actor-local permission, usable on /import before any workspace is selected. The last confirmed
 * answer stays visible while it is rechecked; the final mutation helper re-admits regardless.
 */
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
  const latestRevision = useRef<{ scope: object; value: bigint; at: number }>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [checking, setChecking] = useState<object>();

  liveScope.current = scope;
  const isCurrent = useCallback(() => liveScope.current === scope, [scope]);
  const load = useCallback(
    async (explicit: boolean) => {
      const request = ++sequence.current;

      if (!scope.active || !scope.userId) return;
      // Only a first answer shows loading; a recheck keeps the confirmed state visible.
      setSnapshot((previous) => (previous?.scope === scope ? previous : { scope, status: 'loading' }));
      if (explicit) setChecking(scope);
      try {
        if (!navigator.onLine) throw new Error('Offline');
        const capability = await getWorkspaceCreationCapability();

        if (!isCurrent() || request !== sequence.current) return;
        const previous = latestRevision.current;
        const revision = BigInt(capability.revision);

        // A lagging replica may answer with an older policy revision; keep the newer answer. An
        // explicit check accepts it, so a server restored to an older revision cannot wedge this.
        if (!explicit && previous?.scope === scope && revision < previous.value) return capability;
        latestRevision.current = { scope, value: revision, at: Date.now() };
        setSnapshot({ scope, status: 'ready', capability });
        return capability;
      } catch {
        if (!isCurrent() || request !== sequence.current) return;
        // Offline creation cannot succeed, and an explicit check must report its failure. Otherwise a
        // failed background read keeps the last confirmed answer; the server re-checks every request.
        setSnapshot((previous) =>
          !explicit && navigator.onLine && previous?.scope === scope && previous.status === 'ready'
            ? previous
            : { scope, status: 'error' }
        );
      } finally {
        if (isCurrent() && request === sequence.current) setChecking(undefined);
      }
    },
    [scope, isCurrent]
  );
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    liveScope.current = scope;
    void load(false);
    return () => {
      sequence.current += 1;
      liveScope.current = null;
    };
  }, [load, scope]);
  useEffect(() => {
    if (!scope.active) return;
    const revalidate = () => {
      void load(false);
    };

    const revalidateIfStale = () => {
      const confirmed = latestRevision.current;

      if (confirmed?.scope === scope && Date.now() - confirmed.at < REVALIDATE_MIN_AGE_MS) return;
      revalidate();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidateIfStale();
    };

    const onSocket = (state: unknown) => {
      if (state === WEBSOCKET_OPEN) revalidate();
    };

    window.addEventListener('focus', revalidateIfStale);
    window.addEventListener('online', revalidate);
    window.addEventListener('offline', revalidate);
    document.addEventListener('visibilitychange', onVisible);
    eventEmitter?.on(APP_EVENTS.WEBSOCKET_STATUS, onSocket);
    eventEmitter?.on(APP_EVENTS.PERMISSION_CHANGED, revalidate);
    return () => {
      window.removeEventListener('focus', revalidateIfStale);
      window.removeEventListener('online', revalidate);
      window.removeEventListener('offline', revalidate);
      document.removeEventListener('visibilitychange', onVisible);
      eventEmitter?.off(APP_EVENTS.WEBSOCKET_STATUS, onSocket);
      eventEmitter?.off(APP_EVENTS.PERMISSION_CHANGED, revalidate);
    };
  }, [scope, load, eventEmitter]);
  const current = snapshot?.scope === scope ? snapshot : undefined;

  return {
    status: current?.status ?? 'loading',
    canCreate: current?.status === 'ready' && current.capability?.can_create_workspace === true,
    /** An explicit Check again is in flight. */
    checking: checking === scope,
    refresh,
    isCurrent,
    scopeKey: `${serverUrl}:${userId ?? ''}`,
    capability: current?.capability,
  };
}

export type WorkspaceCreationCapabilityState = ReturnType<typeof useWorkspaceCreationCapability>;
