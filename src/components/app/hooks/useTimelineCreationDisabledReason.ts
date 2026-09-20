import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Subscription, SubscriptionPlan } from '@/application/types';
import { isDevelopmentOrTestEnvironment } from '@/utils/runtime-config';

import { useSubscriptionPlan } from './useSubscriptionPlan';

/** Keeps Timeline creation aligned with the server's workspace-specific Pro policy. */
export function useTimelineCreationDisabledReason(
  getSubscriptions: (() => Promise<Subscription[] | undefined>) | undefined,
  { workspaceId, enabled = true }: { workspaceId?: string; enabled?: boolean }
): string | undefined {
  const { t } = useTranslation();
  const isDevelopment = isDevelopmentOrTestEnvironment();
  const getProSubscriptions = useCallback(async () => {
    const subscriptions = await getSubscriptions?.();

    // Other paid features also accept Team. Timeline requires exactly Pro,
    // so keep its filtered result in a separate workspace cache entry.
    return subscriptions?.filter((subscription) => subscription.plan === SubscriptionPlan.Pro);
  }, [getSubscriptions]);
  const { isPro, activeSubscriptionPlan, hasError } = useSubscriptionPlan(
    getSubscriptions && workspaceId ? getProSubscriptions : undefined,
    { cacheKey: workspaceId ? `timeline:${workspaceId}` : undefined, enabled: enabled && !isDevelopment }
  );

  // useSubscriptionPlan already grants self-hosted instances access without billing.
  if (isDevelopment || isPro) return undefined;
  if (hasError || !getSubscriptions || !workspaceId) {
    return t('timeline.creationPlanUnavailable', {
      defaultValue: 'Unable to check the workspace plan. Try again.',
    });
  }

  if (activeSubscriptionPlan === null) {
    return t('timeline.creationCheckingPlan', { defaultValue: 'Checking workspace plan…' });
  }

  return t('timeline.creationRequiresPro', {
    defaultValue: 'Creating a Timeline view requires a Pro workspace.',
  });
}
