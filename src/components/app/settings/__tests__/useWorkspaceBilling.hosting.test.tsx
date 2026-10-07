import { act, renderHook, waitFor } from '@testing-library/react';

import { BillingService } from '@/application/services/domains';
import { SubscriptionInterval, SubscriptionPlan, WorkspaceSubscriptionStatus, WorkspaceUsageAndLimit } from '@/application/types';

import { useWorkspaceBilling } from '../billing/useWorkspaceBilling';

import { BillingTestProviders, deferred, freeUsage, setBillingHostingMode } from './billing-test-utils';

jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  BillingService: {
    getWorkspaceSubscriptionStatus: jest.fn(),
    getWorkspaceUsage: jest.fn(),
    getSubscriptionLink: jest.fn(),
    cancelSubscription: jest.fn(),
    setSubscriptionRecurringInterval: jest.fn(),
    getBillingPortalLink: jest.fn(),
  },
}));

const api = jest.mocked(BillingService);

describe('useWorkspaceBilling hosting isolation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setBillingHostingMode();
    window.open = jest.fn();
    api.getWorkspaceSubscriptionStatus.mockResolvedValue([]);
    api.getWorkspaceUsage.mockResolvedValue(freeUsage);
  });

  it.each(['self-hosted', 'unknown'] as const)('blocks loading, retries and billing actions when hosting is %s', async (mode) => {
    setBillingHostingMode(mode);
    const { result } = renderHook(() => useWorkspaceBilling('workspace-1'), { wrapper: BillingTestProviders });

    await act(async () => {
      await result.current.reload();
      await result.current.subscribeWorkspace(SubscriptionPlan.Pro, SubscriptionInterval.Month);
      await result.current.cancelWorkspace(SubscriptionPlan.Pro);
      await result.current.updateInterval(SubscriptionPlan.Pro, SubscriptionInterval.Year);
      await result.current.openBillingPortal();
    });

    expect(result.current).toMatchObject({ status: 'idle', usageStatus: 'idle', info: null, usage: null, busy: false });
    for (const method of Object.values(api)) expect(method).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('loads billing only after cloud hosting has been confirmed', async () => {
    setBillingHostingMode('unknown');
    const { result } = renderHook(() => useWorkspaceBilling('workspace-1'), { wrapper: BillingTestProviders });

    expect(api.getWorkspaceSubscriptionStatus).not.toHaveBeenCalled();
    expect(api.getWorkspaceUsage).not.toHaveBeenCalled();
    act(() => setBillingHostingMode('cloud'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.usage).toEqual(freeUsage);
    expect(api.getWorkspaceSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(api.getWorkspaceUsage).toHaveBeenCalledTimes(1);
  });

  it('discards pending cloud usage, subscriptions and checkout after changing to self-hosted', async () => {
    const status = deferred<WorkspaceSubscriptionStatus[]>();
    const usage = deferred<WorkspaceUsageAndLimit>();
    const checkout = deferred<string>();

    api.getWorkspaceSubscriptionStatus.mockReturnValue(status.promise);
    api.getWorkspaceUsage.mockReturnValue(usage.promise);
    api.getSubscriptionLink.mockReturnValue(checkout.promise);
    const { result } = renderHook(() => useWorkspaceBilling('workspace-1'), { wrapper: BillingTestProviders });

    act(() => { void result.current.subscribeWorkspace(SubscriptionPlan.Pro, SubscriptionInterval.Month); });
    act(() => setBillingHostingMode('self-hosted'));
    await act(async () => {
      status.resolve([]);
      usage.resolve(freeUsage);
      checkout.resolve('https://checkout');
    });

    expect(result.current).toMatchObject({ status: 'idle', usageStatus: 'idle', info: null, usage: null, busy: false });
    expect(window.open).not.toHaveBeenCalled();
  });
});
