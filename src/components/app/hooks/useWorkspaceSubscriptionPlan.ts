import { useContext } from 'react';

import { captureTokenSession } from '@/application/session/token';
import { Subscription } from '@/application/types';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';
import { getConfigValue } from '@/utils/runtime-config';

import { useServerHostingMode } from './useServerInfo';
import { useSubscriptionPlan } from './useSubscriptionPlan';

/** Share the current workspace's billing read across feature surfaces. */
export function useWorkspaceSubscriptionPlan({
  workspaceId,
  getSubscriptions,
  enabled = true,
}: {
  workspaceId?: string;
  getSubscriptions?: () => Promise<Subscription[] | undefined>;
  enabled?: boolean;
}) {
  const auth = useContext(AuthInternalContext);
  const userId = useAuthenticatedUserIdOptional() ?? auth?.userWorkspaceInfo?.userId;
  const hostingMode = useServerHostingMode();
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const session = captureTokenSession();
  // Standalone/public hosts may supply their own reader without an account.
  // Never pool these readers, or reuse a result across a new login lifetime.
  const cacheKey = userId && workspaceId
    ? JSON.stringify(['workspace-subscriptions', serverUrl, hostingMode, userId, session.generation, workspaceId])
    : undefined;

  return useSubscriptionPlan(getSubscriptions, { cacheKey, enabled });
}
