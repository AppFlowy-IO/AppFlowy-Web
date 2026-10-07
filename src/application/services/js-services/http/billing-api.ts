import {
  PersonalPlan,
  PersonalSubscriptionStatus,
  PricingCatalog,
  SubscriptionInterval,
  SubscriptionPlan,
  Subscriptions,
  WorkspaceSubscriptionStatus,
  WorkspaceUsageAndLimit,
} from '@/application/types';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

/** UI visibility must not be the only barrier to sending hosted billing traffic. */
function getBillingAxios() {
  if (!getWorkspacePlanPolicy().usesHostedBilling) {
    throw new Error('Hosted billing is not available on this server');
  }

  return getAxios();
}

export async function getSubscriptionLink(workspaceId: string, plan: SubscriptionPlan, interval: SubscriptionInterval) {
  const url = `/billing/api/v1/subscription-link`;

  return executeAPIRequest<string>(() =>
    getBillingAxios()?.get<APIResponse<string>>(url, {
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
    getBillingAxios()?.get<APIResponse<Subscriptions>>(url)
  );
}

export async function getActiveSubscription(workspaceId: string) {
  const url = `/billing/api/v1/active-subscription/${workspaceId}`;

  return executeAPIRequest<SubscriptionPlan[]>(() =>
    getBillingAxios()?.get<APIResponse<SubscriptionPlan[]>>(url)
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
    getBillingAxios()?.post<APIResponse>(url, {
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
    getBillingAxios()?.get<APIResponse<PricingCatalog>>(url)
  );
}

/** Every subscription of a workspace with interval, status and period end. Requires workspace membership. */
export async function getWorkspaceSubscriptionStatus(workspaceId: string) {
  const url = `/billing/api/v1/subscription-status/${workspaceId}`;

  return executeAPIRequest<WorkspaceSubscriptionStatus[]>(() =>
    getBillingAxios()?.get<APIResponse<WorkspaceSubscriptionStatus[]>>(url)
  );
}

/** Account subscriptions are shared by every workspace belonging to the current user. */
export async function getPersonalSubscriptionStatus() {
  const url = `/billing/api/v1/personal-subscription-status`;

  return executeAPIRequest<PersonalSubscriptionStatus[]>(() =>
    getBillingAxios()?.get<APIResponse<PersonalSubscriptionStatus[]>>(url)
  );
}

export async function getPersonalSubscriptionLink(plan: PersonalPlan, interval: SubscriptionInterval) {
  const url = `/billing/api/v1/personal-subscription-link`;

  return executeAPIRequest<string>(() =>
    getBillingAxios()?.get<APIResponse<string>>(url, {
      params: {
        subscription_plan: plan,
        recurring_interval: interval,
        success_url: window.location.href,
      },
    })
  );
}

/** Storage, member and AI usage against the workspace's limits. Served by the cloud API, not the billing service. */
export async function getWorkspaceUsage(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/usage-and-limit`;

  return executeAPIRequest<WorkspaceUsageAndLimit>(() =>
    getBillingAxios()?.get<APIResponse<WorkspaceUsageAndLimit>>(url)
  );
}

/** Stripe customer portal link for managing payment methods and invoices. */
export async function getBillingPortalLink() {
  const url = `/billing/api/v1/portal-session-link`;

  return executeAPIRequest<string>(() => getBillingAxios()?.get<APIResponse<string>>(url));
}

/** Switches a workspace subscription between monthly and yearly billing. */
export async function setSubscriptionRecurringInterval(
  workspaceId: string,
  plan: SubscriptionPlan,
  interval: SubscriptionInterval
) {
  const url = `/billing/api/v1/subscription-recurring-interval`;

  return executeAPIVoidRequest(() =>
    getBillingAxios()?.post<APIResponse>(url, {
      workspace_id: workspaceId,
      plan,
      recurring_interval: interval,
    })
  );
}
