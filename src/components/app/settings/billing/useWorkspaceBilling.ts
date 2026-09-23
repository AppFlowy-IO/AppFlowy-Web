import { useCallback, useEffect, useRef, useState } from 'react';

import { BillingService } from '@/application/services/domains';
import {
  SubscriptionInterval,
  SubscriptionPlan,
  WorkspaceSubscriptionInfo,
  WorkspaceUsageAndLimit,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { getErrorMessage } from '@/utils/errors';
import { buildWorkspaceSubscriptionInfo } from '@/utils/subscription';

export type WorkspaceBillingStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkspaceBillingState {
  status: WorkspaceBillingStatus;
  info: WorkspaceSubscriptionInfo | null;
  usage: WorkspaceUsageAndLimit | null;
  error: unknown;
}

export interface UseWorkspaceBillingResult extends WorkspaceBillingState {
  /** A mutation (cancel, interval change) is in flight. */
  busy: boolean;
  reload: () => Promise<void>;
  /** Opens Stripe checkout for a workspace plan or add-on, billed yearly like the desktop client. */
  subscribeWorkspace: (plan: SubscriptionPlan) => Promise<void>;
  cancelWorkspace: (plan: SubscriptionPlan, reason?: string) => Promise<void>;
  updateInterval: (plan: SubscriptionPlan, interval: SubscriptionInterval) => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

const INITIAL_STATE: WorkspaceBillingState = { status: 'idle', info: null, usage: null, error: null };

/** Checkout and portal pages replace the app, and the success URL brings the user back. */
function openBillingLink(link: string) {
  window.open(link, '_current');
}

/**
 * Loads everything the Plan and Billing settings pages show for one workspace
 * and exposes the billing mutations. Responses for a workspace that was
 * replaced while a request was in flight are dropped.
 */
export function useWorkspaceBilling(workspaceId: string | undefined): UseWorkspaceBillingResult {
  const [state, setState] = useState<WorkspaceBillingState>(INITIAL_STATE);
  const [busy, setBusy] = useState(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setState(INITIAL_STATE);
      return;
    }

    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    try {
      const [statuses, usage] = await Promise.all([
        BillingService.getWorkspaceSubscriptionStatus(workspaceId),
        BillingService.getWorkspaceUsage(workspaceId),
      ]);

      if (!isCurrent()) return;
      setState({
        status: 'ready',
        info: buildWorkspaceSubscriptionInfo(statuses),
        usage: usage ?? null,
        error: null,
      });
    } catch (error) {
      if (!isCurrent()) return;
      setState((prev) => ({ ...prev, status: 'error', error }));
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runMutation = useCallback(
    async (mutation: () => Promise<void>) => {
      setBusy(true);
      try {
        await mutation();
        await reload();
      } catch (error) {
        notify.error(getErrorMessage(error));
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [reload]
  );

  const openLink = useCallback(async (request: () => Promise<string | undefined>) => {
    try {
      const link = await request();

      if (link) openBillingLink(link);
    } catch (error) {
      notify.error(getErrorMessage(error));
    }
  }, []);

  const subscribeWorkspace = useCallback(
    async (plan: SubscriptionPlan) => {
      if (!workspaceId) return;
      await openLink(() => BillingService.getSubscriptionLink(workspaceId, plan, SubscriptionInterval.Year));
    },
    [openLink, workspaceId]
  );

  const cancelWorkspace = useCallback(
    async (plan: SubscriptionPlan, reason?: string) => {
      if (!workspaceId) return;
      await runMutation(() => BillingService.cancelSubscription(workspaceId, plan, reason));
    },
    [runMutation, workspaceId]
  );

  const updateInterval = useCallback(
    async (plan: SubscriptionPlan, interval: SubscriptionInterval) => {
      if (!workspaceId) return;
      await runMutation(() => BillingService.setSubscriptionRecurringInterval(workspaceId, plan, interval));
    },
    [runMutation, workspaceId]
  );

  const openBillingPortal = useCallback(async () => {
    await openLink(() => BillingService.getBillingPortalLink());
  }, [openLink]);

  return {
    ...state,
    busy,
    reload,
    subscribeWorkspace,
    cancelWorkspace,
    updateInterval,
    openBillingPortal,
  };
}
