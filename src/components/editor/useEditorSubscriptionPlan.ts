import { useWorkspaceSubscriptionPlan } from '@/components/app/hooks/useWorkspaceSubscriptionPlan';

import { useEditorContext } from './EditorContext';

/** Color menus share a plan read only while the user needs the paid palette. */
export function useEditorSubscriptionPlan(enabled: boolean) {
  const { getSubscriptions, workspaceId } = useEditorContext();

  return useWorkspaceSubscriptionPlan({ getSubscriptions, workspaceId, enabled });
}
