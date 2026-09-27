import { SubscriptionPlan, ViewLayout } from '@/application/types';
import { assertViewCreationOnline } from '@/application/view-online-policy';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
import { updateServerInfo } from '@/utils/server-info';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

describe('workspace plan deployment policies', () => {
  afterEach(() => jest.restoreAllMocks());

  it('bypasses every commercial entitlement for verified self-hosted workspaces, even with Free data', () => {
    const policy = getWorkspacePlanPolicy('self-hosted');

    expect(policy.usesHostedBilling).toBe(false);
    expect(policy.bypassesPlanLimits).toBe(true);
    expect(policy.hasProAccess(SubscriptionPlan.Free)).toBe(true);
    expect(policy.hasProAccess(null)).toBe(true);
    expect(policy.getUpgradeMessage('Storage is full')).toBeUndefined();
    expect(policy.requiresOnlineViewCreation(ViewLayout.Form)).toBe(false);
    expect(policy.requiresOnlineViewCreation(ViewLayout.Chart)).toBe(false);
  });

  it('retains hosted Free and Pro entitlements and requires online form/chart checks for both', () => {
    const policy = getWorkspacePlanPolicy('cloud');

    expect(policy.usesHostedBilling).toBe(true);
    expect(policy.hasProAccess(SubscriptionPlan.Free)).toBe(false);
    expect(policy.hasProAccess(SubscriptionPlan.Pro)).toBe(true);
    expect(policy.hasProAccess(SubscriptionPlan.Team)).toBe(true);
    expect(policy.hasProAccess(null)).toBe(false);
    expect(policy.requiresOnlineViewCreation(ViewLayout.Form)).toBe(true);
    expect(policy.requiresOnlineViewCreation(ViewLayout.Chart)).toBe(true);
    expect(policy.requiresOnlineViewCreation(ViewLayout.Grid)).toBe(false);
    expect(policy.getUpgradeMessage('Upgrade to Pro to create more forms.')).toBe('Upgrade to Pro to create more forms.');
  });

  it('does not interpret missing or unavailable server info as a self-hosted bypass', () => {
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    for (const status of ['loading', 'unavailable'] as const) {
      updateServerInfo('https://test.appflowy.cloud', { status });
      const policy = getWorkspacePlanPolicy();

      expect(policy.usesHostedBilling).toBe(false);
      expect(policy.bypassesPlanLimits).toBe(false);
      expect(policy.hasProAccess(SubscriptionPlan.Pro)).toBe(false);
      expect(policy.getUpgradeMessage('Limit reached')).toBeUndefined();
      expect(() => assertViewCreationOnline(ViewLayout.Chart)).toThrow('Connect to the internet');
    }
  });

  it('uses the latest server capabilities when the active deployment changes', () => {
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    updateServerInfo('https://test.appflowy.cloud', {
      status: 'available', info: { enable_page_history: true, self_hosted: true },
    });
    expect(() => assertViewCreationOnline(ViewLayout.Form)).not.toThrow();
    updateServerInfo('https://test.appflowy.cloud', {
      status: 'available', info: { enable_page_history: true, self_hosted: false },
    });
    expect(() => assertViewCreationOnline(ViewLayout.Form)).toThrow('Connect to the internet');
  });
});
