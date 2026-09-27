import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

import { BillingService } from '@/application/services/domains';
import { PricingCatalog } from '@/application/types';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { Log } from '@/utils/log';

/** Mirrors the endpoint's `Cache-Control: public, max-age=300`. */
export const PRICING_CATALOG_CACHE_TTL_MS = 5 * 60_000;

type PricingCatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PricingCatalogSnapshot {
  catalog: PricingCatalog | null;
  error: unknown;
  expiresAt: number;
  status: PricingCatalogStatus;
}

type PricingCatalogFetcher = () => Promise<PricingCatalog>;

const EMPTY_SNAPSHOT: PricingCatalogSnapshot = Object.freeze({
  catalog: null,
  error: null,
  expiresAt: 0,
  status: 'idle',
});

// The catalog is global (not per workspace), so one entry serves every consumer.
let snapshot: PricingCatalogSnapshot = EMPTY_SNAPSHOT;
let inFlight: Promise<PricingCatalog | null> | undefined;
const listeners = new Set<() => void>();

function publish(next: PricingCatalogSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PricingCatalogSnapshot {
  return snapshot;
}

function isFresh(entry: PricingCatalogSnapshot): boolean {
  return entry.catalog !== null && entry.expiresAt > Date.now();
}

/** Test helper: forget the cached catalog and any in-flight request. */
export function resetPricingCatalogCache(): void {
  snapshot = EMPTY_SNAPSHOT;
  inFlight = undefined;
}

function requestPricingCatalog(
  fetcher: PricingCatalogFetcher,
  options: { force?: boolean } = {},
): Promise<PricingCatalog | null> {
  if (!options.force && isFresh(snapshot)) return Promise.resolve(snapshot.catalog);
  if (inFlight) return inFlight;

  // A stale catalog stays visible while it refreshes.
  publish({ ...snapshot, error: null, status: 'loading' });

  const request = fetcher()
    .then((catalog) => {
      inFlight = undefined;
      publish({
        catalog,
        error: null,
        expiresAt: Date.now() + PRICING_CATALOG_CACHE_TTL_MS,
        status: 'ready',
      });
      return catalog;
    })
    .catch((error: unknown) => {
      // Never cache a failure: a transient billing outage must not hide
      // pricing for the whole TTL.
      inFlight = undefined;
      Log.error('[usePricingCatalog] Failed to load pricing catalog:', error);
      publish({ ...snapshot, error, status: 'error' });
      return null;
    });

  inFlight = request;
  return request;
}

export interface UsePricingCatalogOptions {
  /** Defers the request until the pricing surface is opened. */
  enabled?: boolean;
}

export interface UsePricingCatalogResult {
  catalog: PricingCatalog | null;
  isLoading: boolean;
  hasError: boolean;
  error: unknown;
  /** Refetches even when a fresh catalog is cached; in-flight requests are shared. */
  reload: () => Promise<PricingCatalog | null>;
}

/**
 * Loads the public plan pricing catalog once per TTL and shares it between
 * every consumer. Failures are reported but never cached, so a retry always
 * hits the network. A previously loaded catalog stays available through a
 * failed refresh.
 */
export function usePricingCatalog({ enabled = true }: UsePricingCatalogOptions = {}): UsePricingCatalogResult {
  const operations = useContext(AppOperationsContext);
  // Stories and tests inject the fetcher through the operations context; the
  // service fallback keeps the hook usable outside AppBusinessLayer.
  const fetcher: PricingCatalogFetcher = operations?.getPricingCatalog ?? BillingService.getPricingCatalog;
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const reload = useCallback(() => requestPricingCatalog(fetcher, { force: true }), [fetcher]);

  useEffect(() => {
    if (!enabled) return;
    void requestPricingCatalog(fetcher);
  }, [enabled, fetcher]);

  return {
    catalog: current.catalog,
    isLoading: current.status === 'loading' || (enabled && current.status === 'idle'),
    hasError: current.status === 'error',
    error: current.error,
    reload,
  };
}
