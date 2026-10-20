import { act, renderHook, waitFor } from '@testing-library/react';

import { Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';

import { useWorkspaceSubscriptionPlan } from '../useWorkspaceSubscriptionPlan';

let mockSessionGeneration = 1;

jest.mock('@/application/session/token', () => ({
  captureTokenSession: () => ({ generation: mockSessionGeneration, userId: 'account-a' }),
}));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => 'account-a' }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useServerHostingMode: () => 'cloud',
  useServerInfoState: () => ({ status: 'available' }),
}));

const proSubscription: Subscription = {
  currency: 'USD',
  plan: SubscriptionPlan.Pro,
  price_cents: 1000,
  recurring_interval: SubscriptionInterval.Month,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });

  return { promise, resolve };
}

it('shares the unresolved subscription read when switching between unmounted feature panels', async () => {
  const pending = deferred<Subscription[]>();
  const shareReader = jest.fn(() => pending.promise);
  const exportReader = jest.fn(async () => []);
  const share = renderHook(() => useWorkspaceSubscriptionPlan({ workspaceId: 'panel-switch', getSubscriptions: shareReader }));

  expect(shareReader).toHaveBeenCalledTimes(1);
  share.unmount();
  const exported = renderHook(() => useWorkspaceSubscriptionPlan({ workspaceId: 'panel-switch', getSubscriptions: exportReader }));

  expect(exportReader).not.toHaveBeenCalled();
  expect(exported.result.current.isLoading).toBe(true);
  await act(async () => pending.resolve([proSubscription]));
  expect(exported.result.current.isPro).toBe(true);
});

it('does not share a pending or completed plan after signing back into the same account', async () => {
  const oldSession = deferred<Subscription[]>();
  const getSubscriptions = jest.fn().mockReturnValueOnce(oldSession.promise).mockResolvedValue([]);
  const { result, rerender } = renderHook(() => useWorkspaceSubscriptionPlan({
    workspaceId: 'session-change', getSubscriptions,
  }));

  mockSessionGeneration += 1;
  rerender();
  await waitFor(() => expect(result.current.activeSubscriptionPlan).toBe(SubscriptionPlan.Free));
  await act(async () => oldSession.resolve([proSubscription]));
  expect(result.current.activeSubscriptionPlan).toBe(SubscriptionPlan.Free);
  mockSessionGeneration += 1;
  rerender();
  await waitFor(() => expect(getSubscriptions).toHaveBeenCalledTimes(3));
});
