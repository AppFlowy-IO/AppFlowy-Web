import { Suspense, startTransition, useState } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';

import {
  Subscription,
  SubscriptionInterval,
  SubscriptionPlan,
} from '@/application/types';

import { useSubscriptionPlan } from '../useSubscriptionPlan';

jest.mock('@/utils/subscription', () => ({
  isAppFlowyHosted: () => true,
  getProAccessPlanFromSubscriptions: (subscriptions?: Subscription[]) =>
    subscriptions?.some(
      ({ plan }) => plan === SubscriptionPlan.Pro || plan === SubscriptionPlan.Team,
    )
      ? SubscriptionPlan.Pro
      : SubscriptionPlan.Free,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

const proSubscription: Subscription = {
  currency: 'USD',
  plan: SubscriptionPlan.Pro,
  price_cents: 1000,
  recurring_interval: SubscriptionInterval.Month,
};

describe('useSubscriptionPlan', () => {
  it('deduplicates an in-flight workspace request and preserves loading until it resolves', async () => {
    const request = deferred<Subscription[]>();
    const getSubscriptions = jest.fn(() => request.promise);
    const { result } = renderHook(() => [
      useSubscriptionPlan(getSubscriptions, { cacheKey: 'workspace:dedup' }),
      useSubscriptionPlan(getSubscriptions, { cacheKey: 'workspace:dedup' }),
    ]);

    await waitFor(() => {
      expect(result.current[0].isLoading).toBe(true);
      expect(result.current[1].isLoading).toBe(true);
    });
    expect(getSubscriptions).toHaveBeenCalledTimes(1);
    expect(result.current[0].activeSubscriptionPlan).toBeNull();
    expect(result.current[0].isPro).toBe(false);

    await act(async () => {
      request.resolve([proSubscription]);
      await request.promise;
    });

    await waitFor(() => {
      expect(result.current[0].isPro).toBe(true);
      expect(result.current[1].isPro).toBe(true);
    });
    expect(result.current[0].isLoading).toBe(false);
    expect(getSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed entitlement unknown instead of caching it as Free', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const getSubscriptions = jest.fn().mockRejectedValue(new Error('billing unavailable'));
    const { result } = renderHook(() =>
      useSubscriptionPlan(getSubscriptions, { cacheKey: 'workspace:error' }),
    );

    await waitFor(() => expect(result.current.hasError).toBe(true));

    expect(result.current.activeSubscriptionPlan).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPro).toBe(false);
    consoleError.mockRestore();
  });

  it('publishes a retry and its result to every consumer in the workspace', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const retryRequest = deferred<Subscription[]>();
    const getSubscriptions = jest
      .fn<Promise<Subscription[]>, []>()
      .mockRejectedValueOnce(new Error('billing unavailable'))
      .mockImplementationOnce(() => retryRequest.promise);
    const { result } = renderHook(() => [
      useSubscriptionPlan(getSubscriptions, { cacheKey: 'workspace:shared-retry' }),
      useSubscriptionPlan(getSubscriptions, { cacheKey: 'workspace:shared-retry' }),
    ]);

    await waitFor(() => {
      expect(result.current[0].hasError).toBe(true);
      expect(result.current[1].hasError).toBe(true);
    });

    let retry!: Promise<SubscriptionPlan | null>;

    act(() => {
      retry = result.current[0].loadSubscription();
    });

    expect(result.current[0].isLoading).toBe(true);
    expect(result.current[1].isLoading).toBe(true);
    expect(getSubscriptions).toHaveBeenCalledTimes(2);

    await act(async () => {
      retryRequest.resolve([proSubscription]);
      await retry;
    });

    expect(result.current[0].isPro).toBe(true);
    expect(result.current[1].isPro).toBe(true);
    expect(result.current[0].hasError).toBe(false);
    expect(result.current[1].hasError).toBe(false);
    consoleError.mockRestore();
  });

  it('does not let a superseded workspace response replace the committed workspace', async () => {
    const workspaceARequest = deferred<Subscription[]>();
    const workspaceBRequest = deferred<Subscription[]>();
    const getWorkspaceA = jest.fn(() => workspaceARequest.promise);
    const getWorkspaceB = jest.fn(() => workspaceBRequest.promise);
    const { result, rerender } = renderHook(
      ({ workspace }: { workspace: 'a' | 'b' }) =>
        useSubscriptionPlan(workspace === 'a' ? getWorkspaceA : getWorkspaceB, {
          cacheKey: `workspace:identity-${workspace}`,
        }),
      { initialProps: { workspace: 'a' as const } },
    );

    rerender({ workspace: 'b' });

    await act(async () => {
      workspaceBRequest.resolve([]);
      await workspaceBRequest.promise;
    });

    expect(result.current.activeSubscriptionPlan).toBe(SubscriptionPlan.Free);

    await act(async () => {
      workspaceARequest.resolve([proSubscription]);
      await workspaceARequest.promise;
    });

    expect(result.current.activeSubscriptionPlan).toBe(SubscriptionPlan.Free);
    expect(result.current.isPro).toBe(false);
  });

  it('expires a mounted Pro result and publishes the refreshed downgrade', async () => {
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const downgradeRequest = deferred<Subscription[]>();
    const getSubscriptions = jest
      .fn<Promise<Subscription[]>, []>()
      .mockResolvedValueOnce([proSubscription])
      .mockImplementationOnce(() => downgradeRequest.promise);
    const { result, rerender } = renderHook(() =>
      useSubscriptionPlan(getSubscriptions, { cacheKey: 'workspace:mounted-ttl' }),
    );

    await waitFor(() => expect(result.current.isPro).toBe(true));

    dateNow.mockReturnValue(61_001);
    rerender();

    expect(result.current.isPro).toBe(false);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(getSubscriptions).toHaveBeenCalledTimes(2));

    await act(async () => {
      downgradeRequest.resolve([]);
      await downgradeRequest.promise;
    });

    expect(result.current.activeSubscriptionPlan).toBe(SubscriptionPlan.Free);
    expect(result.current.isPro).toBe(false);
    expect(result.current.isLoading).toBe(false);
    dateNow.mockRestore();
  });

  it('keeps the committed loader live when a concurrent identity render is abandoned', async () => {
    const workspaceARequest = deferred<Subscription[]>();
    const neverResolve = new Promise<void>(() => undefined);
    const getWorkspaceA = jest.fn(() => workspaceARequest.promise);
    const getWorkspaceB = jest.fn<Promise<Subscription[]>, []>();
    let selectWorkspaceB!: () => void;

    function SubscriptionResult({ workspace }: { workspace: 'a' | 'b' }) {
      const subscription = useSubscriptionPlan(
        workspace === 'a' ? getWorkspaceA : getWorkspaceB,
      );

      if (workspace === 'b') throw neverResolve;

      return (
        <output data-testid='subscription-plan'>
          {subscription.activeSubscriptionPlan ?? 'unknown'}
        </output>
      );
    }

    function ConcurrentHarness() {
      const [workspace, setWorkspace] = useState<'a' | 'b'>('a');

      selectWorkspaceB = () => setWorkspace('b');
      return (
        <Suspense fallback={<span>Loading next workspace</span>}>
          <SubscriptionResult workspace={workspace} />
        </Suspense>
      );
    }

    render(<ConcurrentHarness />);
    expect(screen.getByTestId('subscription-plan').textContent).toBe('unknown');

    act(() => {
      startTransition(selectWorkspaceB);
    });

    // The transition suspended, so workspace A is still the committed tree.
    expect(screen.getByTestId('subscription-plan').textContent).toBe('unknown');

    await act(async () => {
      workspaceARequest.resolve([proSubscription]);
      await workspaceARequest.promise;
    });

    expect(screen.getByTestId('subscription-plan').textContent).toBe(SubscriptionPlan.Pro);
    expect(getWorkspaceB).not.toHaveBeenCalled();
  });
});
