import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Subscription, SubscriptionPlan } from '@/application/types';
import { getProAccessPlanFromSubscriptions, isAppFlowyHosted } from '@/utils/subscription';

const SUBSCRIPTION_PLAN_CACHE_TTL_MS = 60_000;

type SubscriptionPlanStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SubscriptionPlanCacheSnapshot {
  expiresAt: number;
  plan: SubscriptionPlan | null;
  revision: number;
  status: SubscriptionPlanStatus;
}

interface SubscriptionPlanCacheEntry {
  listeners: Set<() => void>;
  promise?: Promise<SubscriptionPlan | null>;
  snapshot: SubscriptionPlanCacheSnapshot;
}

const EMPTY_CACHE_SNAPSHOT: SubscriptionPlanCacheSnapshot = Object.freeze({
  expiresAt: 0,
  plan: null,
  revision: 0,
  status: 'idle',
});
const subscriptionPlanCache = new Map<string, SubscriptionPlanCacheEntry>();

export interface UseSubscriptionPlanOptions {
  /**
   * Shares an in-flight request and its short-lived result between hook
   * consumers that read the same subscription scope (normally a workspace).
   */
  cacheKey?: string;
  /** Defers the request until the feature surface is opened. */
  enabled?: boolean;
}

interface SubscriptionPlanState {
  identity: string | (() => Promise<Subscription[] | undefined>) | undefined;
  plan: SubscriptionPlan | null;
  status: SubscriptionPlanStatus;
}

function planFromSubscriptions(subscriptions: Subscription[] | undefined): SubscriptionPlan {
  return getProAccessPlanFromSubscriptions(subscriptions);
}

function reportSubscriptionError(errorValue: unknown): void {
  const error = errorValue as { code?: number; message?: string };
  const isExpectedError =
    error?.code === -1 &&
    (error?.message === 'No response data received' ||
      error?.message === 'No response received from server' ||
      error?.message === 'API service not initialized');

  if (!isExpectedError) {
    console.error(errorValue);
  }
}

function createCacheEntry(): SubscriptionPlanCacheEntry {
  return {
    listeners: new Set(),
    snapshot: EMPTY_CACHE_SNAPSHOT,
  };
}

function getOrCreateCacheEntry(cacheKey: string): SubscriptionPlanCacheEntry {
  let entry = subscriptionPlanCache.get(cacheKey);

  if (!entry) {
    entry = createCacheEntry();
    subscriptionPlanCache.set(cacheKey, entry);
  }

  return entry;
}

function updateCacheEntry(
  entry: SubscriptionPlanCacheEntry,
  next: Omit<SubscriptionPlanCacheSnapshot, 'revision'>,
): void {
  entry.snapshot = {
    ...next,
    revision: entry.snapshot.revision + 1,
  };
  entry.listeners.forEach((listener) => listener());
}

function subscribeToCachedPlan(cacheKey: string | undefined, listener: () => void): () => void {
  if (!cacheKey) return () => undefined;
  const entry = getOrCreateCacheEntry(cacheKey);

  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

function readCacheSnapshot(cacheKey: string | undefined): SubscriptionPlanCacheSnapshot {
  if (!cacheKey) return EMPTY_CACHE_SNAPSHOT;
  return subscriptionPlanCache.get(cacheKey)?.snapshot ?? EMPTY_CACHE_SNAPSHOT;
}

function readCachedPlan(cacheKey: string | undefined): SubscriptionPlan | null {
  const snapshot = readCacheSnapshot(cacheKey);

  if (snapshot.plan === null || snapshot.expiresAt <= Date.now()) return null;
  return snapshot.plan;
}

function requestSubscriptionPlan(
  getSubscriptions: () => Promise<Subscription[] | undefined>,
  cacheKey: string | undefined,
): Promise<SubscriptionPlan | null> {
  if (!cacheKey) {
    return getSubscriptions()
      .then(planFromSubscriptions)
      .catch((error) => {
        reportSubscriptionError(error);
        return null;
      });
  }

  const cached = readCachedPlan(cacheKey);

  if (cached) return Promise.resolve(cached);

  const entry = getOrCreateCacheEntry(cacheKey);

  if (entry.promise) return entry.promise;

  updateCacheEntry(entry, {
    expiresAt: 0,
    plan: null,
    status: 'loading',
  });

  const promise = getSubscriptions()
    .then(planFromSubscriptions)
    .then((plan) => {
      entry.promise = undefined;
      updateCacheEntry(entry, {
        expiresAt: Date.now() + SUBSCRIPTION_PLAN_CACHE_TTL_MS,
        plan,
        status: 'ready',
      });
      return plan;
    })
    .catch((error) => {
      // Do not cache failures as Free. A transient billing outage must not
      // make every later Pro check look authoritatively denied for the TTL.
      entry.promise = undefined;
      updateCacheEntry(entry, {
        expiresAt: 0,
        plan: null,
        status: 'error',
      });
      reportSubscriptionError(error);
      return null;
    });

  entry.promise = promise;
  return promise;
}

/**
 * Loads a subscription plan and reports loading independently from `isPro`.
 * Official-host callers can therefore distinguish an unknown plan from a
 * confirmed Free plan. Self-hosted instances keep Pro access without a
 * billing request.
 */
export function useSubscriptionPlan(
  getSubscriptions?: () => Promise<Subscription[] | undefined>,
  options: UseSubscriptionPlanOptions = {},
): {
  activeSubscriptionPlan: SubscriptionPlan | null;
  isPro: boolean;
  isLoading: boolean;
  hasError: boolean;
  loadSubscription: () => Promise<SubscriptionPlan | null>;
} {
  const { cacheKey, enabled = true } = options;
  const isHosted = isAppFlowyHosted();
  const identity = cacheKey ?? getSubscriptions;
  const usesSharedCache = Boolean(cacheKey && getSubscriptions);
  const initialPlan = isHosted
    ? getSubscriptions
      ? readCachedPlan(cacheKey)
      : SubscriptionPlan.Free
    : null;
  const initialStatus: SubscriptionPlanStatus =
    !isHosted || !getSubscriptions || initialPlan !== null
      ? 'ready'
      : enabled
        ? 'loading'
        : 'idle';
  const [localState, setLocalState] = useState<SubscriptionPlanState>(() => ({
    identity,
    plan: initialPlan,
    status: initialStatus,
  }));
  const mountedRef = useRef(false);
  const committedIdentityRef = useRef<typeof identity>();
  const identityGenerationRef = useRef(0);
  const localRequestGenerationRef = useRef(0);
  const subscribe = useCallback(
    (listener: () => void) => subscribeToCachedPlan(usesSharedCache ? cacheKey : undefined, listener),
    [cacheKey, usesSharedCache],
  );
  const getSnapshot = useCallback(
    () => readCacheSnapshot(usesSharedCache ? cacheKey : undefined),
    [cacheKey, usesSharedCache],
  );
  const cacheSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const sharedCacheExpired =
    usesSharedCache &&
    cacheSnapshot.plan !== null &&
    cacheSnapshot.expiresAt > 0 &&
    cacheSnapshot.expiresAt <= Date.now();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const generation = identityGenerationRef.current + 1;

    identityGenerationRef.current = generation;
    committedIdentityRef.current = identity;
    localRequestGenerationRef.current += 1;

    return () => {
      if (identityGenerationRef.current === generation) {
        identityGenerationRef.current += 1;
        committedIdentityRef.current = undefined;
        localRequestGenerationRef.current += 1;
      }
    };
  }, [identity, usesSharedCache]);

  useEffect(() => {
    if (!usesSharedCache) {
      setLocalState({ identity, plan: initialPlan, status: initialStatus });
    }
  }, [identity, initialPlan, initialStatus, usesSharedCache]);

  const isCurrentIdentity = useCallback(
    (generation: number) =>
      mountedRef.current &&
      identityGenerationRef.current === generation &&
      committedIdentityRef.current === identity,
    [identity],
  );

  const loadSubscription = useCallback(async (): Promise<SubscriptionPlan | null> => {
    const identityGeneration = identityGenerationRef.current;

    if (!isHosted) return SubscriptionPlan.Pro;
    if (!getSubscriptions) {
      if (isCurrentIdentity(identityGeneration)) {
        setLocalState({ identity, plan: SubscriptionPlan.Free, status: 'ready' });
      }

      return SubscriptionPlan.Free;
    }

    if (usesSharedCache) {
      const plan = await requestSubscriptionPlan(getSubscriptions, cacheKey);

      // Imperative callers (for example, a retry button) must not apply a
      // response that belongs to a workspace which was replaced meanwhile.
      return isCurrentIdentity(identityGeneration) ? plan : null;
    }

    const requestGeneration = localRequestGenerationRef.current + 1;

    localRequestGenerationRef.current = requestGeneration;
    if (isCurrentIdentity(identityGeneration)) {
      setLocalState({ identity, plan: null, status: 'loading' });
    }

    const plan = await requestSubscriptionPlan(getSubscriptions, undefined);

    if (
      isCurrentIdentity(identityGeneration) &&
      localRequestGenerationRef.current === requestGeneration
    ) {
      setLocalState({ identity, plan, status: plan === null ? 'error' : 'ready' });
      return plan;
    }

    return null;
  }, [cacheKey, getSubscriptions, identity, isCurrentIdentity, isHosted, usesSharedCache]);

  useEffect(() => {
    if (!enabled || !isHosted || !getSubscriptions) return;
    void loadSubscription();
  }, [enabled, getSubscriptions, isHosted, loadSubscription]);

  useEffect(() => {
    if (
      !enabled ||
      !usesSharedCache ||
      cacheSnapshot.plan === null ||
      cacheSnapshot.expiresAt <= 0
    ) {
      return;
    }

    const remainingMs = cacheSnapshot.expiresAt - Date.now();

    if (sharedCacheExpired || remainingMs <= 0) {
      void loadSubscription();
      return;
    }

    // A cache entry does not publish an external-store revision merely
    // because wall-clock time passes. Wake the active consumer at expiry so
    // a workspace downgrade cannot leave a mounted Form gate on stale Pro
    // access indefinitely.
    const timer = window.setTimeout(() => void loadSubscription(), remainingMs + 1);

    return () => window.clearTimeout(timer);
  }, [
    cacheSnapshot.expiresAt,
    cacheSnapshot.plan,
    enabled,
    loadSubscription,
    sharedCacheExpired,
    usesSharedCache,
  ]);

  const currentState: SubscriptionPlanState = !isHosted
    ? { identity, plan: null, status: 'ready' }
    : usesSharedCache
      ? {
          identity,
          plan: sharedCacheExpired ? null : cacheSnapshot.plan,
          status:
            sharedCacheExpired && enabled
              ? 'loading'
              : cacheSnapshot.status === 'idle' && enabled
                ? 'loading'
                : cacheSnapshot.status,
        }
      : localState.identity === identity
        ? localState
        : {
            identity,
            plan: initialPlan,
            status: initialStatus,
          };
  const activeSubscriptionPlan = currentState.plan;

  return {
    activeSubscriptionPlan,
    isPro: activeSubscriptionPlan === SubscriptionPlan.Pro || !isHosted,
    isLoading: currentState.status === 'loading',
    hasError: currentState.status === 'error',
    loadSubscription,
  };
}
