import { useCallback } from 'react';

import { BillingService } from '@/application/services/domains';
import { Subscription, SubscriptionPlan } from '@/application/types';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { isDevelopmentOrTestEnvironment } from '@/utils/runtime-config';

export interface FormAuthoringAccess {
  /** `null` means the hosted-workspace entitlement is not known yet. */
  canAuthor: boolean | null;
  isLoading: boolean;
  /** The latest hosted-workspace entitlement request failed. */
  hasError: boolean;
  /** Loads (or joins) the workspace entitlement request on demand. */
  ensureCanAuthor: () => Promise<boolean | null>;
}

/**
 * Single source of truth for "is this workspace allowed to author /
 * share form views?" on the web. Mirror of the desktop's
 * `WorkspaceState.canCreateFormView`.
 *
 * Allow rules — pre-empt the cloud's `plan_check::is_workspace_on_paid_plan`
 * gate so Free users never see the empty-popover regression:
 *
 *   • Development and test builds — lets devs and test harnesses use
 *     the form-authoring UI without a Pro account, mirroring the
 *     desktop debug / integration-test bypasses.
 *   • `useSubscriptionPlan().isPro` — covers the production cloud-Pro
 *     path AND the self-hosted bypass (the hook returns
 *     `isPro = true` whenever `!isAppFlowyHosted()`).
 *
 * Consumers should also expose an `openUpgradePlan()` callback that
 * fires the `?action=change_plan` modal when this hook returns
 * `false` — the `Workspaces` widget observes that search param and
 * mounts the compare-plan dialog. Same upgrade entry point the
 * chart-layout settings already use.
 */
export function useCanAuthorFormView({ enabled = true }: { enabled?: boolean } = {}): FormAuthoringAccess {
  const currentWorkspaceId = useCurrentWorkspaceIdOptional();
  const hasEnvironmentBypass = isDevelopmentOrTestEnvironment();
  const getSubscriptions = useCallback(async (): Promise<Subscription[] | undefined> => {
    if (!currentWorkspaceId) return undefined;
    return BillingService.getWorkspaceSubscriptions(currentWorkspaceId);
  }, [currentWorkspaceId]);
  const {
    activeSubscriptionPlan,
    isPro,
    isLoading,
    hasError,
    loadSubscription,
  } = useSubscriptionPlan(currentWorkspaceId ? getSubscriptions : undefined, {
    cacheKey: currentWorkspaceId ? `workspace:${currentWorkspaceId}` : undefined,
    enabled: enabled && !hasEnvironmentBypass,
  });

  const ensureCanAuthor = useCallback(async (): Promise<boolean | null> => {
    if (hasEnvironmentBypass || isPro) return true;
    if (!currentWorkspaceId) return null;

    const plan = await loadSubscription();

    if (plan === null) return null;
    return plan !== SubscriptionPlan.Free;
  }, [currentWorkspaceId, hasEnvironmentBypass, isPro, loadSubscription]);

  if (hasEnvironmentBypass || isPro) {
    return { canAuthor: true, isLoading: false, hasError: false, ensureCanAuthor };
  }

  if (!currentWorkspaceId || activeSubscriptionPlan === null) {
    return { canAuthor: null, isLoading, hasError, ensureCanAuthor };
  }

  return { canAuthor: false, isLoading: false, hasError: false, ensureCanAuthor };
}
