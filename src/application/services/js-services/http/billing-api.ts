import {
  SubscriptionInterval,
  SubscriptionPlan,
  Subscriptions,
} from '@/application/types';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export async function getSubscriptionLink(workspaceId: string, plan: SubscriptionPlan, interval: SubscriptionInterval) {
  const url = `/billing/api/v1/subscription-link`;

  return executeAPIRequest<string>(() =>
    getAxios()?.get<APIResponse<string>>(url, {
      params: {
        workspace_subscription_plan: plan,
        recurring_interval: interval,
        workspace_id: workspaceId,
        success_url: window.location.href,
      },
    })
  );
}

export async function getSubscriptions() {
  const url = `/billing/api/v1/subscriptions`;

  return executeAPIRequest<Subscriptions>(() =>
    getAxios()?.get<APIResponse<Subscriptions>>(url)
  );
}

export async function getActiveSubscription(workspaceId: string) {
  const url = `/billing/api/v1/active-subscription/${workspaceId}`;

  return executeAPIRequest<SubscriptionPlan[]>(() =>
    getAxios()?.get<APIResponse<SubscriptionPlan[]>>(url)
  );
}

export async function getWorkspaceSubscriptions(workspaceId: string) {
  try {
    const plans = await getActiveSubscription(workspaceId);
    const subscriptions = await getSubscriptions();

    return subscriptions?.filter((subscription) => plans?.includes(subscription.plan));
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function cancelSubscription(workspaceId: string, plan: SubscriptionPlan, reason?: string) {
  const url = `/billing/api/v1/cancel-subscription`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      workspace_id: workspaceId,
      plan,
      sync: true,
      reason,
    })
  );
}
