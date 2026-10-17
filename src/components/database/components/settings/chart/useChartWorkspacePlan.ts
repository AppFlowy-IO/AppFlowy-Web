import { useDatabaseContext } from '@/application/database-yjs/context';
import { useWorkspaceSubscriptionPlan } from '@/components/app/hooks/useWorkspaceSubscriptionPlan';

/**
 * The current workspace's plan, shared (and cached for a minute) with Share,
 * Export and view creation, read while the chart settings popover is open.
 * Desktop gates the premium chart types on a long-lived workspace plan; until
 * the shared read resolves the premium types stay inert without a crown.
 * Publish / read-only mode never renders the chart settings, so it skips the
 * billing read.
 */
export function useChartWorkspacePlan() {
  const { workspaceId, getSubscriptions, readOnly } = useDatabaseContext();

  return useWorkspaceSubscriptionPlan({ workspaceId, getSubscriptions, enabled: !readOnly });
}
