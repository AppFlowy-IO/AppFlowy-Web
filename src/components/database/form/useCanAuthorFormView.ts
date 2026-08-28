import { useCallback } from 'react';

import { BillingService } from '@/application/services/domains';
import { Subscription } from '@/application/types';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { isDevelopmentOrTestEnvironment } from '@/utils/runtime-config';

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
export function useCanAuthorFormView(): boolean {
  const currentWorkspaceId = useCurrentWorkspaceIdOptional();
  const getSubscriptions = useCallback(async (): Promise<Subscription[] | undefined> => {
    if (!currentWorkspaceId) return undefined;
    return BillingService.getWorkspaceSubscriptions(currentWorkspaceId);
  }, [currentWorkspaceId]);
  const { isPro } = useSubscriptionPlan(getSubscriptions);

  if (isDevelopmentOrTestEnvironment()) return true;
  return isPro;
}
