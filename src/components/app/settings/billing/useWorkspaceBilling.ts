import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

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
  usageStatus: WorkspaceBillingStatus;
  usageError: unknown;
  error: unknown;
}

interface WorkspaceBillingSnapshot extends WorkspaceBillingState {
  workspaceId?: string;
}

export interface UseWorkspaceBillingResult extends WorkspaceBillingState {
  /** A mutation or checkout request is in flight. */
  busy: boolean;
  reload: () => Promise<void>;
  /** Opens Stripe checkout for the selected workspace plan and billing interval. */
  subscribeWorkspace: (plan: SubscriptionPlan, interval: SubscriptionInterval) => Promise<void>;
  cancelWorkspace: (plan: SubscriptionPlan, reason?: string) => Promise<void>;
  updateInterval: (plan: SubscriptionPlan, interval: SubscriptionInterval) => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

const INITIAL_STATE: WorkspaceBillingSnapshot = {
  status: 'idle', info: null, usage: null, usageStatus: 'idle', usageError: null, error: null,
};

/** Checkout and portal pages replace the app, and the success URL brings the user back. */
function openBillingLink(link: string) {
  window.open(link, '_current');
}

/**
 * Loads everything the Plan and Billing settings pages show for one workspace
 * and exposes the billing mutations. Responses for a workspace that was
 * replaced while a request was in flight are dropped.
 */
export function useWorkspaceBilling(
  workspaceId: string | undefined,
  { loadUsage = true }: { loadUsage?: boolean } = {}
): UseWorkspaceBillingResult {
  const [state, setState] = useState<WorkspaceBillingSnapshot>(INITIAL_STATE);
  const [busy, setBusy] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const checkoutRequest = useRef<object>();
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const currentWorkspace = useRef(workspaceId);
  const [search] = useSearchParams();
  const comparisonOpen = search.get('action') === 'change_plan';
  const wasComparisonOpen = useRef(comparisonOpen);

  useEffect(() => {
    currentWorkspace.current = workspaceId;
    checkoutRequest.current = undefined;
    setCheckoutPending(false);
    return () => {
      currentWorkspace.current = undefined;
      checkoutRequest.current = undefined;
    };
  }, [workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!mountedRef.current || currentWorkspace.current !== workspaceId) return;
    const generation = ++generationRef.current;

    if (!workspaceId) {
      setState(INITIAL_STATE);
      return;
    }

    const isCurrent = () =>
      mountedRef.current && currentWorkspace.current === workspaceId && generationRef.current === generation;

    setState((prev) => ({
      ...(prev.workspaceId === workspaceId ? prev : INITIAL_STATE),
      workspaceId,
      status: 'loading',
      error: null,
      usage: null,
      usageStatus: loadUsage ? 'loading' : 'idle',
      usageError: null,
    }));

    // Usage comes from Cloud and can be recovering while Billing is available.
    // Settle independently so it cannot hide a plan or block a billing mutation.
    const requestUsage = async () => {
      try {
        const usage = await BillingService.getWorkspaceUsage(workspaceId);

        if (!usage) throw new Error('Workspace usage unavailable');
        if (!isCurrent()) return;
        setState((prev) => ({ ...prev, usage, usageStatus: 'ready', usageError: null }));
      } catch (usageError) {
        if (!isCurrent()) return;
        setState((prev) => ({ ...prev, usage: null, usageStatus: 'error', usageError }));
      }
    };

    if (loadUsage) void requestUsage();

    try {
      const statuses = await BillingService.getWorkspaceSubscriptionStatus(workspaceId);

      if (!statuses) throw new Error('Workspace subscription status unavailable');
      if (!isCurrent()) return;
      const info = buildWorkspaceSubscriptionInfo(statuses);

      setState((prev) => ({
        ...prev,
        status: 'ready',
        info,
        error: null,
      }));
    } catch (error) {
      if (!isCurrent()) return;
      setState((prev) => ({ ...prev, status: 'error', error }));
    }
  }, [workspaceId, loadUsage]);

  useEffect(() => {
    void reload();
    return () => {
      generationRef.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    // Settings stays mounted behind the comparison dialog, which can cancel a subscription.
    if (wasComparisonOpen.current && !comparisonOpen) void reload();
    wasComparisonOpen.current = comparisonOpen;
  }, [comparisonOpen, reload]);

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
    async (plan: SubscriptionPlan, interval: SubscriptionInterval) => {
      if (!workspaceId || checkoutRequest.current) return;
      const request = {};

      checkoutRequest.current = request;
      setCheckoutPending(true);
      try {
        const link = await BillingService.getSubscriptionLink(workspaceId, plan, interval);

        if (checkoutRequest.current === request && link) openBillingLink(link);
      } catch (error) {
        if (checkoutRequest.current === request) notify.error(getErrorMessage(error));
      } finally {
        if (checkoutRequest.current === request) {
          checkoutRequest.current = undefined;
          setCheckoutPending(false);
        }
      }
    },
    [workspaceId]
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
    // Do not render another workspace's plan/usage before the loading effect runs.
    ...(state.workspaceId === workspaceId ? state : INITIAL_STATE),
    busy: busy || checkoutPending,
    reload,
    subscribeWorkspace,
    cancelWorkspace,
    updateInterval,
    openBillingPortal,
  };
}
