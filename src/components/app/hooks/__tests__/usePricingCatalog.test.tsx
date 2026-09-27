import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import { BillingService } from '@/application/services/domains';
import { PricingCatalog } from '@/application/types';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';

import { PRICING_CATALOG_CACHE_TTL_MS, resetPricingCatalogCache, usePricingCatalog } from '../usePricingCatalog';

jest.mock('@/application/services/domains', () => ({
  BillingService: { getPricingCatalog: jest.fn() },
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

const catalog: PricingCatalog = {
  version: 1,
  currency: 'USD',
  annual_discount_percent: 20,
  plans: [],
  comparison: [],
};

const refreshedCatalog: PricingCatalog = { ...catalog, version: 2 };

function withOperations(getPricingCatalog: () => Promise<PricingCatalog>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppOperationsContext.Provider value={{ getPricingCatalog } as unknown as AppOperationsContextType}>
        {children}
      </AppOperationsContext.Provider>
    );
  };
}

describe('usePricingCatalog', () => {
  beforeEach(() => {
    resetPricingCatalogCache();
    jest.mocked(BillingService.getPricingCatalog).mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares one in-flight request between consumers and publishes the catalog to both', async () => {
    const request = deferred<PricingCatalog>();
    const getPricingCatalog = jest.fn(() => request.promise);
    const { result } = renderHook(() => [usePricingCatalog(), usePricingCatalog()], {
      wrapper: withOperations(getPricingCatalog),
    });

    await waitFor(() => {
      expect(result.current[0].isLoading).toBe(true);
      expect(result.current[1].isLoading).toBe(true);
    });
    expect(getPricingCatalog).toHaveBeenCalledTimes(1);
    expect(result.current[0].catalog).toBeNull();

    await act(async () => {
      request.resolve(catalog);
      await request.promise;
    });

    await waitFor(() => expect(result.current[0].catalog).toEqual(catalog));
    expect(result.current[1].catalog).toEqual(catalog);
    expect(result.current[0].isLoading).toBe(false);
    expect(result.current[0].hasError).toBe(false);
    expect(getPricingCatalog).toHaveBeenCalledTimes(1);
  });

  it('defers the request until enabled', async () => {
    const getPricingCatalog = jest.fn().mockResolvedValue(catalog);
    const { result, rerender } = renderHook(({ enabled }) => usePricingCatalog({ enabled }), {
      initialProps: { enabled: false },
      wrapper: withOperations(getPricingCatalog),
    });

    expect(getPricingCatalog).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.catalog).toBeNull();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.catalog).toEqual(catalog));
    expect(getPricingCatalog).toHaveBeenCalledTimes(1);
  });

  it('reports failures without caching them and reloads on demand', async () => {
    const error = new Error('billing unavailable');
    const getPricingCatalog = jest.fn().mockRejectedValueOnce(error).mockResolvedValue(catalog);
    const { result } = renderHook(() => usePricingCatalog(), { wrapper: withOperations(getPricingCatalog) });

    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.catalog).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(error);

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => expect(result.current.catalog).toEqual(catalog));
    expect(result.current.hasError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it('fetches again after a failure when a new consumer mounts', async () => {
    const getPricingCatalog = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(catalog);
    const first = renderHook(() => usePricingCatalog(), { wrapper: withOperations(getPricingCatalog) });

    await waitFor(() => expect(first.result.current.hasError).toBe(true));
    first.unmount();

    const second = renderHook(() => usePricingCatalog(), { wrapper: withOperations(getPricingCatalog) });

    await waitFor(() => expect(second.result.current.catalog).toEqual(catalog));
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it('serves a fresh catalog from cache and refetches once the TTL has elapsed', async () => {
    const base = 1_700_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(base);
    const getPricingCatalog = jest.fn().mockResolvedValueOnce(catalog).mockResolvedValueOnce(refreshedCatalog);
    const first = renderHook(() => usePricingCatalog(), { wrapper: withOperations(getPricingCatalog) });

    await waitFor(() => expect(first.result.current.catalog).toEqual(catalog));
    first.unmount();

    now.mockReturnValue(base + PRICING_CATALOG_CACHE_TTL_MS - 1);
    const cached = renderHook(() => usePricingCatalog(), { wrapper: withOperations(getPricingCatalog) });

    expect(cached.result.current.catalog).toEqual(catalog);
    expect(cached.result.current.isLoading).toBe(false);
    expect(getPricingCatalog).toHaveBeenCalledTimes(1);
    cached.unmount();

    now.mockReturnValue(base + PRICING_CATALOG_CACHE_TTL_MS + 1);
    const expired = renderHook(() => usePricingCatalog(), { wrapper: withOperations(getPricingCatalog) });

    // The stale catalog stays visible while the refresh is in flight.
    expect(expired.result.current.catalog).toEqual(catalog);
    await waitFor(() => expect(expired.result.current.catalog).toEqual(refreshedCatalog));
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it('keeps the last catalog visible through a failed refresh', async () => {
    const base = 1_700_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(base);
    const getPricingCatalog = jest.fn().mockResolvedValueOnce(catalog).mockRejectedValueOnce(new Error('offline'));
    const first = renderHook(() => usePricingCatalog(), { wrapper: withOperations(getPricingCatalog) });

    await waitFor(() => expect(first.result.current.catalog).toEqual(catalog));
    first.unmount();

    now.mockReturnValue(base + PRICING_CATALOG_CACHE_TTL_MS + 1);
    const refreshed = renderHook(() => usePricingCatalog(), { wrapper: withOperations(getPricingCatalog) });

    await waitFor(() => expect(refreshed.result.current.hasError).toBe(true));
    expect(refreshed.result.current.catalog).toEqual(catalog);
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it('prefers the operations-context fetcher and falls back to the billing service', async () => {
    const service = jest.mocked(BillingService.getPricingCatalog).mockResolvedValue(refreshedCatalog);
    const fromContext = jest.fn().mockResolvedValue(catalog);
    const withContext = renderHook(() => usePricingCatalog(), { wrapper: withOperations(fromContext) });

    await waitFor(() => expect(withContext.result.current.catalog).toEqual(catalog));
    expect(fromContext).toHaveBeenCalledTimes(1);
    expect(service).not.toHaveBeenCalled();
    withContext.unmount();
    resetPricingCatalogCache();

    const withoutContext = renderHook(() => usePricingCatalog());

    await waitFor(() => expect(withoutContext.result.current.catalog).toEqual(refreshedCatalog));
    expect(service).toHaveBeenCalledTimes(1);
  });
});
