import {
  SubscriptionInterval,
  SubscriptionPlan,
  SubscriptionStatus,
  WorkspaceSubscriptionStatus,
} from '@/application/types';
import {
  buildWorkspaceSubscriptionInfo,
  findWorkspaceAddOn,
  formatStorageGb,
  isBillingPortalEnabled,
  isSubscriptionCanceled,
} from '@/utils/subscription';

function status(
  plan: WorkspaceSubscriptionStatus['workspace_plan'],
  overrides: Partial<WorkspaceSubscriptionStatus> = {}
): WorkspaceSubscriptionStatus {
  return {
    workspace_id: 'workspace-1',
    workspace_plan: plan,
    recurring_interval: SubscriptionInterval.Year,
    subscription_status: SubscriptionStatus.Active,
    subscription_quantity: 1,
    cancel_at: null,
    current_period_end: 1_800_014_400,
    ...overrides,
  };
}


describe('buildWorkspaceSubscriptionInfo', () => {
  it('is Free with nothing else when the workspace has no subscriptions', () => {
    expect(buildWorkspaceSubscriptionInfo([])).toEqual({ plan: SubscriptionPlan.Free, subscription: null, addOns: [] });
    expect(buildWorkspaceSubscriptionInfo(undefined).plan).toBe(SubscriptionPlan.Free);
  });

  it('separates the workspace plan from add-ons and ignores unknown plans', () => {
    const pro = status(SubscriptionPlan.Pro);
    const aiMax = status(SubscriptionPlan.AIMax, { recurring_interval: SubscriptionInterval.Month });
    const aiLocal = status('ai_local');
    const unknown = status('mystery_plan' as WorkspaceSubscriptionStatus['workspace_plan']);

    const info = buildWorkspaceSubscriptionInfo([aiMax, pro, aiLocal, unknown]);

    expect(info.plan).toBe(SubscriptionPlan.Pro);
    expect(info.subscription).toBe(pro);
    expect(info.addOns).toEqual([aiMax, aiLocal]);
    expect(findWorkspaceAddOn(info, SubscriptionPlan.AIMax)).toBe(aiMax);
    expect(findWorkspaceAddOn(info, 'ai_local')).toBe(aiLocal);
  });

  it('keeps Team as the workspace plan', () => {
    const team = status(SubscriptionPlan.Team);

    expect(buildWorkspaceSubscriptionInfo([team])).toEqual({ plan: SubscriptionPlan.Team, subscription: team, addOns: [] });
  });
});

describe('subscription state helpers', () => {
  it('treats a scheduled cancellation as canceled', () => {
    expect(isSubscriptionCanceled(status(SubscriptionPlan.Pro))).toBe(false);
    expect(isSubscriptionCanceled(status(SubscriptionPlan.Pro, { cancel_at: 1_800_000_000 }))).toBe(true);
    expect(isSubscriptionCanceled(null)).toBe(false);
  });

  it('enables the billing portal once anything has been paid for', () => {
    expect(isBillingPortalEnabled(buildWorkspaceSubscriptionInfo([]))).toBe(false);
    expect(isBillingPortalEnabled(buildWorkspaceSubscriptionInfo([status(SubscriptionPlan.AIMax)]))).toBe(true);
    expect(isBillingPortalEnabled(buildWorkspaceSubscriptionInfo([status(SubscriptionPlan.Pro)]))).toBe(true);
  });

});

describe('formatStorageGb', () => {
  it('formats bytes as gigabytes without trailing zeros', () => {
    expect(formatStorageGb(5 * 1024 ** 3)).toBe('5');
    expect(formatStorageGb(1.5 * 1024 ** 3)).toBe('1.5');
    expect(formatStorageGb(1_234_567)).toBe('0');
    expect(formatStorageGb(0)).toBe('0');
    expect(formatStorageGb(-1)).toBe('0');
  });
});
