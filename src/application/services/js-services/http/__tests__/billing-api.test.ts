import {
  Subscription,
  SubscriptionInterval,
  SubscriptionPlan,
} from '@/application/types';

import {
  getBillingPortalLink,
  getPricingCatalog,
  getWorkspaceSubscriptionStatus,
  getWorkspaceSubscriptions,
  getWorkspaceUsage,
  setSubscriptionRecurringInterval,
} from '../billing-api';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => {
    const response = await request();
    return response.data.data;
  },
  executeAPIVoidRequest: async (request: () => Promise<unknown>) => {
    await request();
  },
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

describe('getPricingCatalog', () => {
  it('requests the public pricing endpoint and unwraps the catalog', async () => {
    const catalog = { version: 1, currency: 'USD', annual_discount_percent: 20, plans: [], comparison: [] };

    mockGet.mockResolvedValueOnce({ data: { data: catalog } });

    await expect(getPricingCatalog()).resolves.toEqual(catalog);
    expect(mockGet).toHaveBeenCalledWith('/billing/api/v1/pricing');
  });
});

describe('workspace billing endpoints', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('reads workspace subscription status and usage from their own endpoints', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } }).mockResolvedValueOnce({ data: { data: { member_count: 1 } } });

    await expect(getWorkspaceSubscriptionStatus('workspace-1')).resolves.toEqual([]);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/billing/api/v1/subscription-status/workspace-1');

    await expect(getWorkspaceUsage('workspace-1')).resolves.toEqual({ member_count: 1 });
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-1/usage-and-limit');
  });

  it('requests the Stripe customer portal link', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: 'https://portal' } });

    await expect(getBillingPortalLink()).resolves.toBe('https://portal');
    expect(mockGet).toHaveBeenCalledWith('/billing/api/v1/portal-session-link');
  });

  it('posts interval changes with the billing service payload', async () => {
    mockPost.mockResolvedValue({ data: { code: 0 } });

    await setSubscriptionRecurringInterval('workspace-1', SubscriptionPlan.AIMax, SubscriptionInterval.Month);
    expect(mockPost).toHaveBeenCalledWith('/billing/api/v1/subscription-recurring-interval', {
      workspace_id: 'workspace-1',
      plan: 'ai_max',
      recurring_interval: 'month',
    });
  });
});
