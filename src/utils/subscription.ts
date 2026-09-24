import {
  Role,
  Subscription,
  SubscriptionPlan,
  Workspace,
  WorkspaceSubscriptionInfo,
  WorkspaceSubscriptionStatus,
} from '@/application/types';
import { isSameUserUid, UserUid } from '@/application/user-uid';

const PRO_ACCESS_PLANS = new Set([SubscriptionPlan.Pro, SubscriptionPlan.Team]);

/** Shared access rule for billing settings and the dialog that handles their Change plan action. */
export function canManageWorkspaceBilling(
  workspace: Workspace | undefined,
  userUid: UserUid,
  isOfficialHosted: boolean
): boolean {
  return isOfficialHosted && (workspace?.role === Role.Owner || isSameUserUid(workspace?.owner?.uid, userUid));
}

export function hasProAccessFromPlans(plans?: SubscriptionPlan[] | null): boolean {
  if (!plans || plans.length === 0) return false;
  return plans.some((plan) => PRO_ACCESS_PLANS.has(plan));
}

export function getProAccessPlanFromSubscriptions(subscriptions?: Subscription[] | null): SubscriptionPlan {
  if (!subscriptions || subscriptions.length === 0) return SubscriptionPlan.Free;
  return subscriptions.some((subscription) => PRO_ACCESS_PLANS.has(subscription.plan))
    ? SubscriptionPlan.Pro
    : SubscriptionPlan.Free;
}

const WORKSPACE_PLANS = new Set<string>([SubscriptionPlan.Pro, SubscriptionPlan.Team]);
const WORKSPACE_ADD_ON_PLANS = new Set<string>([SubscriptionPlan.AIMax, 'ai_local']);
const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Folds the billing service's subscription list into the plan/add-on shape the
 * settings pages render, mirroring the desktop `WorkspaceSubscriptionInfoPB`.
 * Unknown plan ids are ignored so a new server plan cannot break the page.
 */
export function buildWorkspaceSubscriptionInfo(
  statuses?: WorkspaceSubscriptionStatus[] | null
): WorkspaceSubscriptionInfo {
  const info: WorkspaceSubscriptionInfo = { plan: SubscriptionPlan.Free, subscription: null, addOns: [] };

  for (const status of statuses ?? []) {
    if (WORKSPACE_PLANS.has(status.workspace_plan)) {
      info.plan = status.workspace_plan as SubscriptionPlan;
      info.subscription = status;
    } else if (WORKSPACE_ADD_ON_PLANS.has(status.workspace_plan)) {
      info.addOns.push(status);
    }
  }

  return info;
}

export function findWorkspaceAddOn(
  info: WorkspaceSubscriptionInfo,
  plan: SubscriptionPlan | 'ai_local'
): WorkspaceSubscriptionStatus | null {
  return info.addOns.find((addOn) => addOn.workspace_plan === plan) ?? null;
}

/** A subscription that Stripe will end at `cancel_at` instead of renewing. */
export function isSubscriptionCanceled(status?: { cancel_at: number | null } | null): boolean {
  return status?.cancel_at !== null && status?.cancel_at !== undefined;
}

/** The Stripe customer portal only exists once the workspace has paid for something. */
export function isBillingPortalEnabled(info: WorkspaceSubscriptionInfo): boolean {
  return info.plan !== SubscriptionPlan.Free || info.addOns.length > 0;
}

/** Bytes as gigabytes with at most two decimals and no trailing zeros: 5368709120 -> "5", 0 -> "0". */
export function formatStorageGb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0';

  return String(Number((bytes / BYTES_PER_GB).toFixed(2)));
}
