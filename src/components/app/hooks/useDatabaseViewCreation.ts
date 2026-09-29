import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { getSubscriptionLink } from '@/application/services/domains/billing';
import {
  DatabaseViewCreationStatus,
  getDatabaseViewCreationStatus,
} from '@/application/services/js-services/http/workspace-api';
import { Subscription, SubscriptionInterval, SubscriptionPlan, ViewLayout } from '@/application/types';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { useServerHostingMode } from '@/components/app/hooks/useServerInfo';
import { useAuthenticatedUserIdOptional, useCurrentUserOptional } from '@/components/main/app.hooks';
import { getErrorMessage } from '@/utils/errors';
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

// Billing changes much less often than the database inventory. Share requests
// across menus without caching quota decisions or turning idle menus into pollers.
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
    // Last confirmed allowance. A refresh keeps it so known denials keep their
    // crowns, but a stale allowance cannot enable creation (Desktop parity).
    quota?: DatabaseViewCreationStatus;
    quotaState?: 'pending' | 'fresh' | 'failed';
    plan?: SubscriptionPlan | null;
  }>({ scope });
  const refreshRef = useRef<(() => void) | null>(null);

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
      setStatus((prev) => ({ ...(prev.scope === scope ? prev : { scope }), quotaState: 'pending' }));
      if (running) return;
      running = true;

      // Coalesce actual changes during a request into one follow-up read. No
      // polling or idle sync events: a closed menu has no quota demand.
      let requestedRevision: number;

      do {
        requestedRevision = revision;
        const isCurrent = () => active && requestedRevision === revision;

        await Promise.all([
          getDatabaseViewCreationStatus(workspaceId).then(
            (quota) => {
              if (isCurrent()) setStatus((prev) => ({ ...prev, scope, quota, quotaState: 'fresh' }));
            },
            () => {
              if (isCurrent()) setStatus((prev) => ({ ...prev, scope, quotaState: 'failed' }));
            }
          ),
          Promise.resolve()
            .then(() => loadPlan(planCacheKey, getSubscriptions))
            .then(
              (plan) => {
                if (isCurrent()) setStatus((prev) => ({ ...prev, scope, plan }));
              },
              () => {
                // A plan that already loaded survives a failed refresh, as on Desktop.
                if (isCurrent()) setStatus((prev) => ({ ...prev, scope, plan: prev.plan ?? null }));
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
      // A reopened menu must not show an allowance confirmed before it closed,
      // even for the render before its refresh starts. Known denials keep crowns.
      setStatus((prev) => (prev.quotaState === 'fresh' ? { ...prev, quotaState: 'pending' } : prev));
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
        if (current?.plan === undefined) return checking;
        if (current.plan === null) return unavailable;
        return current.plan === SubscriptionPlan.Pro ? CREATE : requiresPro;
      }

      const quota = current?.quota;
      const allowed = layout === ViewLayout.Form ? quota?.can_create_form : quota?.can_create_chart;

      // A confirmed denial keeps its crown during slow or failed refreshes.
      if (quota && !allowed) return requiresPro;
      if (allowed && current?.quotaState === 'fresh') return CREATE;
      return current?.quotaState === 'failed' ? unavailable : checking;
    },
    [hostingMode, workspaceId, authenticated, connected, readConnection, status, scope, enabled, isOwner, t]
  );
  const pendingCheckout = useRef<Promise<void> | null>(null);
  /**
   * Opens annual Pro checkout for an upgrade action; returns undefined otherwise.
   * Call it synchronously from the user's gesture: the tab is reserved before the
   * billing request, since browsers block tabs opened after a network await. The
   * promise settles once checkout is shown or its failure is reported. A call
   * while checkout is opening reuses it instead of opening another tab.
   */
  const startCheckout = useCallback(
    (layout?: ViewLayout): Promise<void> | undefined => {
      if (pendingCheckout.current) return pendingCheckout.current;
      if (!workspaceId || getAction(layout).type !== 'upgrade') return;
      const checkoutWindow = window.open('about:blank', '_blank');

      if (checkoutWindow) checkoutWindow.opener = null;
      const checkout = getSubscriptionLink(workspaceId, SubscriptionPlan.Pro, SubscriptionInterval.Year)
        .then((link) => {
          if (checkoutWindow && !checkoutWindow.closed) {
            checkoutWindow.location.replace(link);
          } else {
            toast(t('databaseViewCreation.checkoutReady'), {
              action: {
                label: t('databaseViewCreation.openCheckout'),
                onClick: () => {
                  window.open(link, '_blank', 'noopener,noreferrer');
                },
              },
            });
          }
        })
        .catch((error: unknown) => {
          checkoutWindow?.close();
          toast.error(getErrorMessage(error, t('databaseViewCreation.checkoutFailed')));
        })
        .finally(() => {
          pendingCheckout.current = null;
        });

      pendingCheckout.current = checkout;
      return checkout;
    },
    [getAction, workspaceId, t]
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
