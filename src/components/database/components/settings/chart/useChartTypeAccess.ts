import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useDatabaseContext } from '@/application/database-yjs/context';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';
import { useChartWorkspacePlan } from '@/components/database/components/settings/chart/useChartWorkspacePlan';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { canManageWorkspaceBilling } from '@/utils/subscription';

/**
 * Whether the workspace may use the premium chart types. Desktop reads an
 * already-loaded `canUseProFeatures` from its long-lived workspace bloc; on
 * web the plan may still be loading, or its read may have failed, which is
 * neither Pro nor Free. Self-hosted servers are always `pro`.
 */
export type ChartPlanState = 'pro' | 'free' | 'unknown';

/**
 * Pro-plan gating for the premium chart types. Only official hosting ever
 * locks a type, and only there does the upgrade prompt exist.
 */
export function useChartTypeAccess() {
  const { t } = useTranslation();
  const isHosted = useIsOfficialHosted();
  const { workspaceId } = useDatabaseContext();
  const { isPro, isLoading, hasError } = useChartWorkspacePlan();
  const planState: ChartPlanState = isPro ? 'pro' : isLoading || hasError ? 'unknown' : 'free';

  // The rule `Workspaces` mounts `UpgradePlan` by, the only listener of
  // `?action=change_plan`: the prompt must not be sent where nothing opens.
  const workspace = useUserWorkspaceInfo()?.selectedWorkspace;
  const currentUser = useCurrentUserOptional();
  const canManageBilling =
    workspace?.id === workspaceId && canManageWorkspaceBilling(workspace, currentUser?.uid, isHosted);

  const [, setSearch] = useSearchParams();
  /**
   * Desktop `showWorkspaceUpgradePrompt`: only a confirmed Free plan prompts;
   * owners get the upgrade flow, other members an error toast. Returns whether
   * the plan modal takes over, i.e. whether the settings menu may close.
   */
  const showUpgradePrompt = useCallback((): boolean => {
    if (!isHosted || planState !== 'free') return false;
    if (!canManageBilling) {
      toast.error(t('billingLimits.workspaceProRequired'));
      return false;
    }

    // Reuse the canonical in-app upgrade entry point: `UpgradePlan` (mounted in
    // `Workspaces`) opens the plan comparison when `?action=change_plan` is set.
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
    return true;
  }, [canManageBilling, isHosted, planState, setSearch, t]);

  return { isHosted, planState, showUpgradePrompt };
}
