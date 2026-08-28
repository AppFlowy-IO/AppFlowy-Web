import {
  Subscription,
  SubscriptionInterval,
  SubscriptionPlan,
} from '@/application/types';

import { getWorkspaceSubscriptions } from '../billing-api';

const mockGet = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({ get: (...args: unknown[]) => mockGet(...args) }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => {
    const response = await request();
    return response.data.data;
  },
  executeAPIVoidRequest: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('getWorkspaceSubscriptions', () => {
  it('loads active plans and subscription definitions in parallel', async () => {
    const activePlans = deferred<{ data: { data: SubscriptionPlan[] } }>();
    const subscriptions = deferred<{ data: { data: Subscription[] } }>();
    const proSubscription: Subscription = {
      currency: 'USD',
      plan: SubscriptionPlan.Pro,
      price_cents: 1000,
      recurring_interval: SubscriptionInterval.Month,
    };

    mockGet.mockImplementation((url: string) => {
      if (url.includes('active-subscription')) return activePlans.promise;
      return subscriptions.promise;
    });

    const resultPromise = getWorkspaceSubscriptions('workspace-id');

    expect(mockGet).toHaveBeenCalledTimes(2);

    activePlans.resolve({ data: { data: [SubscriptionPlan.Pro] } });
    subscriptions.resolve({ data: { data: [proSubscription] } });

    await expect(resultPromise).resolves.toEqual([proSubscription]);
  });
});
