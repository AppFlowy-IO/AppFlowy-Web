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

  const entry = {
    expiresAt: Infinity,
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
  const scope = useMemo(
    () => ({
      workspaceId,
      userId,
      serverUrl,
      authenticated,
      getSubscriptions,
      hostingMode,
      eventEmitter,
    }),
    [workspaceId, userId, serverUrl, authenticated, getSubscriptions, hostingMode, eventEmitter]
  );
  const [status, setStatus] = useState<{
    scope: object;
    quota?: DatabaseViewCreationStatus | null;
    plan?: SubscriptionPlan | null;
  }>({ scope });

  useEffect(() => {
    if (hostingMode !== 'cloud') return;
    const invalidatePlan = () => planCache.delete(planCacheKey);

    // Invalidate even when the menu is closed, including a return from checkout.
    // Refresh reads run in a microtask so all consumers invalidate before sharing
    // the next request. An old in-flight result cannot repopulate a removed entry.
    eventEmitter?.on(APP_EVENTS.SERVER_LIMIT_CHANGED, invalidatePlan);
    window.addEventListener('focus', invalidatePlan);
    return () => {
      eventEmitter?.off(APP_EVENTS.SERVER_LIMIT_CHANGED, invalidatePlan);
      window.removeEventListener('focus', invalidatePlan);
    };
  }, [hostingMode, eventEmitter, planCacheKey]);

  useEffect(() => {
    if (!enabled || hostingMode !== 'cloud' || !connected || !authenticated || !workspaceId) return;
    setStatus((prev) => (prev.scope === scope ? prev : { scope }));
    let active = true;
    let revision = 0;
    let running = false;

    const refresh = async () => {
      revision += 1;
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
              if (isCurrent()) setStatus((prev) => ({ ...prev, scope, quota }));
            },
            () => {
              if (isCurrent()) setStatus((prev) => ({ ...prev, scope, quota: null }));
            }
          ),
          Promise.resolve()
            .then(() => loadPlan(planCacheKey, getSubscriptions))
            .then(
              (plan) => {
                if (isCurrent()) setStatus((prev) => ({ ...prev, scope, plan }));
              },
              () => {
                if (isCurrent()) setStatus((prev) => ({ ...prev, scope, plan: null }));
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
    eventEmitter?.on(APP_EVENTS.FOLDER_OUTLINE_CHANGED, onChange);
    eventEmitter?.on(APP_EVENTS.FOLDER_VIEW_CHANGED, onChange);
    eventEmitter?.on(APP_EVENTS.SERVER_LIMIT_CHANGED, onChange);
    // Checkout returns in another tab. Refresh when the user returns here.
    window.addEventListener('focus', onChange);
    return () => {
      active = false;
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
      const value = layout === ViewLayout.Timeline ? current?.plan : current?.quota;

      if (value === undefined) return { type: 'disabled', reason: t('databaseViewCreation.checking') };
      if (value === null) return { type: 'disabled', reason: t('databaseViewCreation.unavailable') };
      const allowed =
        layout === ViewLayout.Timeline
          ? current?.plan === SubscriptionPlan.Pro
          : layout === ViewLayout.Form
          ? current?.quota?.can_create_form
          : current?.quota?.can_create_chart;

      if (allowed) return CREATE;
      return {
        type: isOwner ? 'upgrade' : 'disabled',
        requiresPro: isOwner,
        reason: t(isOwner ? 'databaseViewCreation.upgrade' : 'databaseViewCreation.askOwner'),
      };
    },
    [hostingMode, workspaceId, authenticated, connected, readConnection, status, scope, enabled, isOwner, t]
  );
  const openingCheckout = useRef(false);
  const checkCreation = useCallback(
    (layout?: ViewLayout, closeMenu?: () => void): boolean => {
      const action = getAction(layout);

      if (action.type === 'create') return true;
      if (action.type !== 'upgrade' || !workspaceId || openingCheckout.current) return false;
      openingCheckout.current = true;
      closeMenu?.();
      // Reserve the tab during the user gesture; opening it after a network await
      // is blocked by browsers with stricter popup policies.
      const checkoutWindow = window.open('about:blank', '_blank');

      if (checkoutWindow) checkoutWindow.opener = null;
      void getSubscriptionLink(workspaceId, SubscriptionPlan.Pro, SubscriptionInterval.Year)
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
          openingCheckout.current = false;
        });
      return false;
    },
    [getAction, workspaceId, t]
  );

  return { getAction, checkCreation };
}
