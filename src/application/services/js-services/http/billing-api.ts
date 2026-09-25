import {
  PricingCatalog,
  SubscriptionInterval,
  SubscriptionPlan,
  Subscriptions,
  WorkspaceSubscriptionStatus,
  WorkspaceUsageAndLimit,
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
    const [plans, subscriptions] = await Promise.all([
      getActiveSubscription(workspaceId),
      getSubscriptions(),
    ]);

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

/** Public plan catalog: prices, descriptions, bullets and comparison rows. No auth required. */
export async function getPricingCatalog() {
  const url = `/billing/api/v1/pricing`;

  return executeAPIRequest<PricingCatalog>(() =>
    getAxios()?.get<APIResponse<PricingCatalog>>(url)
  );
}

/** Every subscription of a workspace with interval, status and period end. Requires workspace membership. */
export async function getWorkspaceSubscriptionStatus(workspaceId: string) {
  const url = `/billing/api/v1/subscription-status/${workspaceId}`;

  return executeAPIRequest<WorkspaceSubscriptionStatus[]>(() =>
    getAxios()?.get<APIResponse<WorkspaceSubscriptionStatus[]>>(url)
  );
}

/** Storage, member and AI usage against the workspace's limits. Served by the cloud API, not the billing service. */
export async function getWorkspaceUsage(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/usage-and-limit`;

  return executeAPIRequest<WorkspaceUsageAndLimit>(() =>
    getAxios()?.get<APIResponse<WorkspaceUsageAndLimit>>(url)
  );
}

/** Stripe customer portal link for managing payment methods and invoices. */
export async function getBillingPortalLink() {
  const url = `/billing/api/v1/portal-session-link`;

  return executeAPIRequest<string>(() => getAxios()?.get<APIResponse<string>>(url));
}

/** Switches a workspace subscription between monthly and yearly billing. */
export async function setSubscriptionRecurringInterval(
  workspaceId: string,
  plan: SubscriptionPlan,
  interval: SubscriptionInterval
) {
  const url = `/billing/api/v1/subscription-recurring-interval`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      workspace_id: workspaceId,
      plan,
      recurring_interval: interval,
    })
  );
}
