import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import {
  DatabaseViewCreationStatus,
  getDatabaseViewCreationStatus,
} from '@/application/services/js-services/http/workspace-api';
import { Subscription, SubscriptionPlan, ViewLayout } from '@/application/types';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { useServerHostingMode } from '@/components/app/hooks/useServerInfo';
import { useAuthenticatedUserIdOptional, useCurrentUserOptional } from '@/components/main/app.hooks';
import { getConfigValue } from '@/utils/runtime-config';
import {
  canManageWorkspaceBilling,
  getProAccessPlanFromSubscriptions,
  isLimitedDatabaseViewLayout,
} from '@/utils/subscription';

export type DatabaseViewCreationAction = {
  type: 'create' | 'upgrade' | 'disabled';
  reason?: string;
  requiresPro?: boolean;
};

const CREATE: DatabaseViewCreationAction = { type: 'create' };
// Same per-layout wording as Desktop's creation-requires-Pro messages.
const upgradeReasonKey = (layout?: ViewLayout) =>
  layout === ViewLayout.Timeline
    ? 'databaseViewCreation.upgradeTimeline'
    : layout === ViewLayout.Form
    ? 'databaseViewCreation.upgradeForm'
    : 'databaseViewCreation.upgradeChart';
const PLAN_CACHE_TTL_MS = 30_000;
const planCache = new Map<string, { expiresAt: number; promise: Promise<SubscriptionPlan | null> }>();
const MAX_CREATION_CACHE_ENTRIES = 50;

interface CreationSnapshot {
  quota?: DatabaseViewCreationStatus;
  quotaRevision?: number;
  plan?: SubscriptionPlan;
  planRevision?: number;
}

const EMPTY_SNAPSHOT: CreationSnapshot = {};
const creationCache = new Map<string, CreationSnapshot>();
const cacheListeners = new Set<() => void>();
let requestRevision = 0;

function subscribeCreationCache(listener: () => void) {
  cacheListeners.add(listener);
  return () => cacheListeners.delete(listener);
}

function updateCreationCache(key: string, update: CreationSnapshot) {
  const previous = creationCache.get(key);

  // A slower menu must not overwrite a newer response from another menu.
  if (
    (update.quotaRevision !== undefined && update.quotaRevision < (previous?.quotaRevision ?? 0)) ||
    (update.planRevision !== undefined && update.planRevision < (previous?.planRevision ?? 0))
  )
    return;
  creationCache.delete(key);
  creationCache.set(key, { ...previous, ...update });
  if (creationCache.size > MAX_CREATION_CACHE_ENTRIES) {
    const oldestKey = creationCache.keys().next().value;

    if (oldestKey !== undefined) creationCache.delete(oldestKey);
  }

  cacheListeners.forEach((listener) => listener());
}

function clearCreationCache(key: string) {
  if (creationCache.delete(key)) cacheListeners.forEach((listener) => listener());
}

// Billing changes much less often than the database inventory. Share requests
// across menus; confirmed values remain visible while quotas refresh in the background.
function loadPlan(key: string, getSubscriptions?: () => Promise<Subscription[] | undefined>) {
  if (!getSubscriptions) return Promise.resolve(null);
  const cached = planCache.get(key);

  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  for (const [cacheKey, entry] of planCache) {
    if (entry.expiresAt <= Date.now()) planCache.delete(cacheKey);
  }

  // A pending read also expires, so a request that never settles cannot pin every menu to "checking".
  const entry = {
    expiresAt: Date.now() + PLAN_CACHE_TTL_MS,
    promise: Promise.resolve()
      .then(getSubscriptions)
      .then((subscriptions) => (subscriptions ? getProAccessPlanFromSubscriptions(subscriptions) : null)),
  };
  const evict = () => {
    if (planCache.get(key) === entry) planCache.delete(key);
  };

  planCache.set(key, entry);
  void entry.promise.then((plan) => {
    if (plan === null) evict();
    else entry.expiresAt = Date.now() + PLAN_CACHE_TTL_MS;
  }, evict);
  return entry.promise;
}

// Checkout returns in another tab. One module-level listener invalidates billing
// for every menu; registered before any hook's refresh listener, it always runs first.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => planCache.clear());
}

/** Menu-scoped admission hints; the creation endpoint still makes the atomic quota decision. */
export function useDatabaseViewCreation({
  workspaceId,
  getSubscriptions,
  enabled = true,
}: {
  workspaceId?: string;
  getSubscriptions?: () => Promise<Subscription[] | undefined>;
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const hostingMode = useServerHostingMode();
  const auth = useContext(AuthInternalContext);
  const eventEmitter = useContext(AppEventEmitterContext);
  const userId = useAuthenticatedUserIdOptional() ?? auth?.userWorkspaceInfo?.userId;
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const currentUser = useCurrentUserOptional();
  const workspace = auth?.userWorkspaceInfo?.selectedWorkspace;
  const isOwner =
    workspace?.id === workspaceId && canManageWorkspaceBilling(workspace, currentUser?.uid, hostingMode === 'cloud');
  const subscribeConnection = useCallback(
    (onChange: () => void) => {
      eventEmitter?.on(APP_EVENTS.WEBSOCKET_STATUS, onChange);
      window.addEventListener('online', onChange);
      window.addEventListener('offline', onChange);
      return () => {
        eventEmitter?.off(APP_EVENTS.WEBSOCKET_STATUS, onChange);
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
      };
    },
    [eventEmitter]
  );
  const readConnection = useCallback(() => navigator.onLine && eventEmitter?.webSocketReadyState === 1, [eventEmitter]);
  const connected = useSyncExternalStore(subscribeConnection, readConnection, readConnection);
  const authenticated = auth?.isAuthenticated === true && auth.currentWorkspaceId === workspaceId;
  const planCacheKey = JSON.stringify([serverUrl, userId, workspaceId]);
  const readSnapshot = useCallback(() => creationCache.get(planCacheKey) ?? EMPTY_SNAPSHOT, [planCacheKey]);
  const snapshot = useSyncExternalStore(subscribeCreationCache, readSnapshot, readSnapshot);
  // A new identity is unavailable immediately, even before effect cleanup. Never
  // display a previous workspace/account's successful response for one render.
  // Like Desktop, a lost connection also clears the snapshot.
  const scope = useMemo(
    () => ({
      workspaceId,
      userId,
      serverUrl,
      authenticated,
      getSubscriptions,
      hostingMode,
      connected,
      eventEmitter,
    }),
    [workspaceId, userId, serverUrl, authenticated, getSubscriptions, hostingMode, connected, eventEmitter]
  );
  const [status, setStatus] = useState<{
    scope: object;
    quotaState?: 'pending' | 'failed';
    planState?: 'pending' | 'failed';
  }>({ scope });
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!authenticated || !connected || hostingMode !== 'cloud') {
      clearCreationCache(planCacheKey);
      planCache.delete(planCacheKey);
    }
  }, [authenticated, connected, hostingMode, planCacheKey]);

  useEffect(() => {
    if (hostingMode !== 'cloud') return;
    const invalidatePlan = () => planCache.delete(planCacheKey);

    // Invalidate even when the menu is closed. Refresh reads run in a microtask so
    // all consumers invalidate before sharing the next request. An old in-flight
    // result cannot repopulate a removed entry.
    eventEmitter?.on(APP_EVENTS.SERVER_LIMIT_CHANGED, invalidatePlan);
    return () => {
      eventEmitter?.off(APP_EVENTS.SERVER_LIMIT_CHANGED, invalidatePlan);
    };
  }, [hostingMode, eventEmitter, planCacheKey]);

  useEffect(() => {
    if (!enabled || hostingMode !== 'cloud' || !connected || !authenticated || !workspaceId) return;
    let active = true;
    let revision = 0;
    let running = false;

    const refresh = async () => {
      revision += 1;
      setStatus({ scope, quotaState: 'pending', planState: 'pending' });
      if (running) return;
      running = true;

      // Coalesce actual changes during a request into one follow-up read. No
      // polling or idle sync events: a closed menu has no quota demand.
      let requestedRevision: number;

      do {
        requestedRevision = revision;
        const cacheRevision = ++requestRevision;
        const isCurrent = () => active && requestedRevision === revision;

        await Promise.all([
          getDatabaseViewCreationStatus(workspaceId).then(
            (quota) => {
              if (isCurrent()) updateCreationCache(planCacheKey, { quota, quotaRevision: cacheRevision });
            },
            () => {
              if (isCurrent()) setStatus((prev) => ({ ...prev, scope, quotaState: 'failed' }));
            }
          ),
          Promise.resolve()
            .then(() => loadPlan(planCacheKey, getSubscriptions))
            .then(
              (plan) => {
                if (!isCurrent()) return;
                if (plan !== null) updateCreationCache(planCacheKey, { plan, planRevision: cacheRevision });
                else setStatus((prev) => ({ ...prev, scope, planState: 'failed' }));
              },
              () => {
                // Keep the last confirmed plan when a background refresh fails.
                if (isCurrent()) setStatus((prev) => ({ ...prev, scope, planState: 'failed' }));
              }
            ),
        ]);
      } while (active && requestedRevision !== revision);

      running = false;
    };

    const onChange = () => {
      void refresh();
    };

    onChange();
    refreshRef.current = onChange;
    eventEmitter?.on(APP_EVENTS.FOLDER_OUTLINE_CHANGED, onChange);
    eventEmitter?.on(APP_EVENTS.FOLDER_VIEW_CHANGED, onChange);
    eventEmitter?.on(APP_EVENTS.SERVER_LIMIT_CHANGED, onChange);
    // Checkout returns in another tab. Refresh when the user returns here.
    window.addEventListener('focus', onChange);
    return () => {
      active = false;
      if (refreshRef.current === onChange) refreshRef.current = null;
      eventEmitter?.off(APP_EVENTS.FOLDER_OUTLINE_CHANGED, onChange);
      eventEmitter?.off(APP_EVENTS.FOLDER_VIEW_CHANGED, onChange);
      eventEmitter?.off(APP_EVENTS.SERVER_LIMIT_CHANGED, onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [scope, enabled, hostingMode, connected, authenticated, workspaceId, getSubscriptions, eventEmitter, planCacheKey]);

  const getAction = useCallback(
    (layout?: ViewLayout): DatabaseViewCreationAction => {
      if (!isLimitedDatabaseViewLayout(layout)) return CREATE;
      if (hostingMode === 'self-hosted') return CREATE;
      if (hostingMode !== 'cloud' || !workspaceId || !authenticated) {
        return { type: 'disabled', reason: t('databaseViewCreation.unavailable') };
      }

      // A click can arrive after disconnection but before React commits its render.
      if (!connected || !readConnection())
        return { type: 'disabled', reason: t('databaseViewCreation.connectionRequired') };

      const current = status.scope === scope && enabled ? status : undefined;
      const cached = enabled ? snapshot : EMPTY_SNAPSHOT;
      const checking: DatabaseViewCreationAction = { type: 'disabled', reason: t('databaseViewCreation.checking') };
      const unavailable: DatabaseViewCreationAction = {
        type: 'disabled',
        reason: t('databaseViewCreation.unavailable'),
      };
      const requiresPro: DatabaseViewCreationAction = isOwner
        ? {
            type: 'upgrade',
            requiresPro: true,
            reason: t(upgradeReasonKey(layout)),
          }
        : { type: 'disabled', requiresPro: false, reason: t('databaseViewCreation.askOwner') };

      if (layout === ViewLayout.Timeline) {
        if (cached.plan === undefined) return current?.planState === 'failed' ? unavailable : checking;
        return cached.plan === SubscriptionPlan.Pro ? CREATE : requiresPro;
      }

      const quota = cached.quota;
      const allowed = layout === ViewLayout.Form ? quota?.can_create_form : quota?.can_create_chart;

      // Reuse confirmed values during refreshes, including across menu remounts.
      // The creation endpoint remains authoritative if an allowance changed meanwhile.
      if (quota) return allowed ? CREATE : requiresPro;
      return current?.quotaState === 'failed' ? unavailable : checking;
    },
    [hostingMode, workspaceId, authenticated, connected, readConnection, status, scope, enabled, snapshot, isOwner, t]
  );
  const pendingCheckout = useRef<Promise<void> | null>(null);
  const [, setSearch] = useSearchParams();
  /** Opens the plan comparison, where the owner chooses a billing period before checkout. */
  const startCheckout = useCallback(
    (layout?: ViewLayout): Promise<void> | undefined => {
      if (pendingCheckout.current) return pendingCheckout.current;
      if (!workspaceId || getAction(layout).type !== 'upgrade') return;
      setSearch((previous) => {
        previous.set('action', 'change_plan');
        return previous;
      });
      const opening = Promise.resolve();

      pendingCheckout.current = opening;
      void opening.then(() => {
        pendingCheckout.current = null;
      });
      return opening;
    },
    [getAction, workspaceId, setSearch]
  );
  const checkCreation = useCallback(
    (layout?: ViewLayout, closeMenu?: () => void): boolean => {
      const action = getAction(layout);

      if (action.type === 'create') return true;
      if (action.type === 'disabled') {
        // Like Desktop, a blocked attempt explains itself and retries the status,
        // so "try again" is actionable without reopening the menu.
        if (action.reason) toast.error(action.reason);
        refreshRef.current?.();
        return false;
      }

      if (pendingCheckout.current) return false;
      // Menus without inline checkout progress close first, like Desktop's
      // sidebar and slash menus. The tab-bar menu uses startCheckout directly.
      closeMenu?.();
      void startCheckout(layout);
      return false;
    },
    [getAction, startCheckout]
  );

  return { getAction, checkCreation, startCheckout };
}
