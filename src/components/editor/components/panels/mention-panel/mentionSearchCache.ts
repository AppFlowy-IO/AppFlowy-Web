import { ERROR_CODE } from '@/application/constants';
import type { APIError } from '@/application/services/js-services/http/core';
import { MentionSearchSection } from '@/application/types';

const MENTION_SEARCH_CACHE_LIMIT = 50;
const DEFAULT_MENTION_SEARCH_RETRY_LATER_MS = 3000;

interface MentionSearchCacheEntry {
  sections: MentionSearchSection[];
  cachedAt?: number;
  retryLaterUntil?: number;
  refreshPromise?: Promise<void>;
}

const mentionSearchCache = new Map<string, MentionSearchCacheEntry>();

export function getCachedMentionSections(key: string): MentionSearchSection[] | undefined {
  const entry = mentionSearchCache.get(key);

  return entry?.cachedAt ? entry.sections : undefined;
}

export function setCachedMentionSections(key: string, sections: MentionSearchSection[]) {
  if (!mentionSearchCache.has(key) && mentionSearchCache.size >= MENTION_SEARCH_CACHE_LIMIT) {
    const oldestKey = mentionSearchCache.keys().next().value;

    if (oldestKey) {
      mentionSearchCache.delete(oldestKey);
    }
  }

  const previous = mentionSearchCache.get(key);

  mentionSearchCache.set(key, {
    ...previous,
    sections,
    cachedAt: Date.now(),
  });
}

export function isMentionSearchRetryLater(error: unknown): error is APIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === ERROR_CODE.RETRY_LATER
  );
}

export function mentionSearchRetryLaterDelayMs(error?: APIError): number {
  const retryAfterMs = error?.retryAfterSecs ? error.retryAfterSecs * 1000 : DEFAULT_MENTION_SEARCH_RETRY_LATER_MS;

  return Math.max(retryAfterMs, 1000);
}

export function markMentionSearchRetryLater(key: string, error?: APIError) {
  const previous = mentionSearchCache.get(key);

  mentionSearchCache.set(key, {
    sections: previous?.sections ?? [],
    cachedAt: previous?.cachedAt,
    refreshPromise: previous?.refreshPromise,
    retryLaterUntil: Date.now() + mentionSearchRetryLaterDelayMs(error),
  });
}

export function mentionSearchRetryLaterRemainingMs(key: string): number {
  const entry = mentionSearchCache.get(key);
  const retryLaterUntil = entry?.retryLaterUntil;

  if (!retryLaterUntil) return 0;

  const remainingMs = retryLaterUntil - Date.now();

  if (remainingMs > 0) return remainingMs;

  mentionSearchCache.set(key, {
    ...entry,
    retryLaterUntil: undefined,
  });
  return 0;
}

export function startMentionSearchRefresh(key: string, refresh: () => Promise<void>) {
  const existing = mentionSearchCache.get(key)?.refreshPromise;

  if (existing) return existing;

  const refreshPromise = refresh().finally(() => {
    const current = mentionSearchCache.get(key);

    if (current?.refreshPromise === refreshPromise) {
      mentionSearchCache.set(key, {
        ...current,
        refreshPromise: undefined,
      });
    }
  });
  const previous = mentionSearchCache.get(key);

  mentionSearchCache.set(key, {
    sections: previous?.sections ?? [],
    cachedAt: previous?.cachedAt,
    retryLaterUntil: previous?.retryLaterUntil,
    refreshPromise,
  });

  return refreshPromise;
}

export function clearMentionSearchCacheForTests() {
  mentionSearchCache.clear();
}
