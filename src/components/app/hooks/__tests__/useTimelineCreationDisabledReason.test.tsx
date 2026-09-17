import { act, renderHook, waitFor } from '@testing-library/react';

import { Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';

import { useSubscriptionPlan } from '../useSubscriptionPlan';
import { useTimelineCreationDisabledReason } from '../useTimelineCreationDisabledReason';

let mockDevelopment = false;
let mockHosted = true;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }),
}));
jest.mock('@/utils/runtime-config', () => ({
  ...jest.requireActual('@/utils/runtime-config'),
  isDevelopmentOrTestEnvironment: () => mockDevelopment,
}));
jest.mock('@/utils/subscription', () => ({
  ...jest.requireActual('@/utils/subscription'),
  isAppFlowyHosted: () => mockHosted,
}));

const requiresPro = 'Creating a Timeline view requires a Pro workspace.';
const checkingPlan = 'Checking workspace plan…';
const planUnavailable = 'Unable to check the workspace plan. Try again.';
const subscription = (plan: SubscriptionPlan): Subscription => ({
  plan,
  currency: 'USD',
  price_cents: 1000,
  recurring_interval: SubscriptionInterval.Month,
});

describe('Timeline workspace access', () => {
  beforeEach(() => {
    mockDevelopment = false;
    mockHosted = true;
  });

  it.each([SubscriptionPlan.Free, SubscriptionPlan.Team, SubscriptionPlan.AIMax, SubscriptionPlan.Pro])(
    'requires exactly Pro when the workspace plan is %s',
    async (plan) => {
      const getSubscriptions = jest.fn().mockResolvedValue([subscription(plan)]);
      const { result } = renderHook(() => useTimelineCreationDisabledReason(getSubscriptions, { workspaceId: plan }));

      expect(result.current).toBe(checkingPlan);
      await waitFor(() => expect(result.current).toBe(plan === SubscriptionPlan.Pro ? undefined : requiresPro));
    }
  );

  it.each(['development', 'self-hosted'])('bypasses billing for %s', (environment) => {
    mockDevelopment = environment === 'development';
    mockHosted = environment !== 'self-hosted';
    const getSubscriptions = jest.fn();
    const { result } = renderHook(() =>
      useTimelineCreationDisabledReason(getSubscriptions, { workspaceId: environment })
    );

    expect(result.current).toBeUndefined();
    expect(getSubscriptions).not.toHaveBeenCalled();
  });

  it('does not reuse the general paid-feature cache which also accepts Team', async () => {
    const getSubscriptions = jest.fn().mockResolvedValue([subscription(SubscriptionPlan.Team)]);
    const { result } = renderHook(() => ({
      general: useSubscriptionPlan(getSubscriptions, { cacheKey: 'team-workspace' }),
      timeline: useTimelineCreationDisabledReason(getSubscriptions, { workspaceId: 'team-workspace' }),
    }));

    await waitFor(() => expect(result.current.general.isPro).toBe(true));
    expect(result.current.timeline).toBe(requiresPro);
  });

  it('revokes the previous workspace access immediately while checking the next workspace', async () => {
    let resolve!: (value: Subscription[]) => void;
    const getPro = jest.fn().mockResolvedValue([subscription(SubscriptionPlan.Pro)]);
    const getFree = jest.fn(
      () =>
        new Promise<Subscription[]>((done) => {
          resolve = done;
        })
    );
    const { result, rerender } = renderHook(
      ({ pro }) =>
        useTimelineCreationDisabledReason(pro ? getPro : getFree, { workspaceId: pro ? 'switch-pro' : 'switch-free' }),
      { initialProps: { pro: true } }
    );

    await waitFor(() => expect(result.current).toBeUndefined());
    rerender({ pro: false });
    expect(result.current).toBe(checkingPlan);
    await act(async () => resolve([]));
    expect(result.current).toBe(requiresPro);
  });

  it('blocks on a billing failure and retries when the menu is reopened', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const getSubscriptions = jest
      .fn()
      .mockRejectedValueOnce(new Error('billing unavailable'))
      .mockResolvedValueOnce([subscription(SubscriptionPlan.Pro)]);
    const { result, rerender } = renderHook(
      ({ enabled }) => useTimelineCreationDisabledReason(getSubscriptions, { workspaceId: 'retry', enabled }),
      { initialProps: { enabled: false } }
    );

    expect(getSubscriptions).not.toHaveBeenCalled();
    expect(result.current).toBe(checkingPlan);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toBe(planUnavailable));
    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toBeUndefined());
    errorLog.mockRestore();
  });
});
