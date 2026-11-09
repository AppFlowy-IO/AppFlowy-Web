import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import type { APIError } from '@/application/services/js-services/http/core';
import { EventType, on } from '@/application/session/event';
import { MentionSearchResultItem, MentionSearchSection, MentionTargetKind } from '@/application/types';

import type { EventEmitter } from 'events';

const MENTION_SEARCH_CACHE_LIMIT = 50;
const DEFAULT_MENTION_SEARCH_RETRY_LATER_MS = 3000;

/**
 * A cached answer younger than this is shown without asking the server again, unless an event
 * marked it stale since.
 */
export const MENTION_SEARCH_CACHE_FRESH_MS = 10_000;

/** Workspace events after which a cached answer may be outdated, so its next use revalidates it. */
const MENTION_SEARCH_STALE_EVENTS = [
  APP_EVENTS.SECTION_CHANGED,
  APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED,
  APP_EVENTS.FOLDER_OUTLINE_CHANGED,
  APP_EVENTS.FOLDER_VIEW_CHANGED,
  APP_EVENTS.PERMISSION_CHANGED,
];

interface MentionSearchCacheEntry {
  sections: MentionSearchSection[];
  cachedAt?: number;
  /** An event may have changed the answer since it was cached, so its next use revalidates it. */
  stale?: boolean;
  retryLaterUntil?: number;
  refreshPromise?: Promise<void>;
}

/** A cached answer, with whether it is fresh enough to show without asking the server again. */
export interface CachedMentionSearch {
  sections: MentionSearchSection[];
  cachedAt: number;
  fresh: boolean;
}

/**
 * When a request was sent, as far as the cache is concerned. An answer to a request sent before the
 * cache was cleared is dropped, and one sent before entries were marked stale is stored stale.
 */
export interface MentionSearchCacheStamp {
  readonly epoch: number;
  readonly generation: number;
}

const mentionSearchCache = new Map<string, MentionSearchCacheEntry>();
// Counts clears (sign-out, workspace switch). An answer from an earlier epoch is never stored.
let cacheEpoch = 0;
// Counts stale marks. An answer sent before the latest one is stored, but stale.
let cacheGeneration = 0;
// The workspace and user of the entries, from the last panel that opened.
let cacheScope: string | undefined;
const invalidationEmitters = new WeakSet<EventEmitter>();

function setMentionSearchCacheEntry(key: string, entry: MentionSearchCacheEntry) {
  if (mentionSearchCache.has(key)) {
    // Re-insert so Map iteration order tracks recency (LRU eviction).
    mentionSearchCache.delete(key);
  } else if (mentionSearchCache.size >= MENTION_SEARCH_CACHE_LIMIT) {
    const oldestKey = mentionSearchCache.keys().next().value;

    if (oldestKey !== undefined) {
      mentionSearchCache.delete(oldestKey);
    }
  }

  mentionSearchCache.set(key, entry);
}

/** Captures the cache's state when a request is sent; pass it to {@link setCachedMentionSections}. */
export function mentionSearchCacheStamp(): MentionSearchCacheStamp {
  return { epoch: cacheEpoch, generation: cacheGeneration };
}

export function getCachedMentionSearch(key: string, now = Date.now()): CachedMentionSearch | undefined {
  const entry = mentionSearchCache.get(key);

  if (!entry?.cachedAt) return undefined;

  return {
    sections: entry.sections,
    cachedAt: entry.cachedAt,
    fresh: !entry.stale && now - entry.cachedAt < MENTION_SEARCH_CACHE_FRESH_MS,
  };
}

export function getCachedMentionSections(key: string): MentionSearchSection[] | undefined {
  return getCachedMentionSearch(key)?.sections;
}

/**
 * Stores a complete, current answer. With the `stamp` of its request, an answer sent before the
 * cache was cleared is dropped, and one sent before entries were marked stale is stored stale.
 */
export function setCachedMentionSections(
  key: string,
  sections: MentionSearchSection[],
  stamp?: MentionSearchCacheStamp
) {
  if (stamp && stamp.epoch !== cacheEpoch) return;

  const previous = mentionSearchCache.get(key);

  setMentionSearchCacheEntry(key, {
    ...previous,
    sections,
    cachedAt: Date.now(),
    stale: stamp !== undefined && stamp.generation !== cacheGeneration,
  });
}

/** Marks every cached answer stale: it is still shown at once, but its next use revalidates it. */
export function markMentionSearchCacheStale() {
  cacheGeneration += 1;
  mentionSearchCache.forEach((entry, key) => {
    mentionSearchCache.set(key, { ...entry, stale: true });
  });
}

function itemTargetsView(item: MentionSearchResultItem, viewId: string) {
  // A person's payload names the page the person would be mentioned on, not the person.
  if (item.kind === MentionTargetKind.Person) return false;

  const payload = item.mention as unknown as Record<string, unknown>;

  return (
    item.object_id === viewId ||
    item.database_view_id === viewId ||
    payload.page_id === viewId ||
    payload.database_view_id === viewId
  );
}

/**
 * The user lost access to `viewId`: drops it from every cached answer, so its title is never shown
 * from the cache, and marks every answer stale.
 */
export function forgetMentionSearchView(viewId: string) {
  mentionSearchCache.forEach((entry, key) => {
    mentionSearchCache.set(key, {
      ...entry,
      sections: entry.sections.map((section) => ({
        ...section,
        items: section.items.filter((item) => !itemTargetsView(item, viewId)),
      })),
    });
  });
  markMentionSearchCacheStale();
}

/** Forgets every cached answer and cooldown. Answers to requests sent before are never stored. */
export function clearMentionSearchCache() {
  cacheEpoch += 1;
  cacheGeneration += 1;
  mentionSearchCache.clear();
}

/**
 * Called when a panel opens with the workspace and user it searches. Another scope than the
 * cached one (a workspace switch, another account) clears the cache.
 */
export function ensureMentionSearchCacheScope(scope: string) {
  if (cacheScope === scope) return;
  if (cacheScope !== undefined) clearMentionSearchCache();

  cacheScope = scope;
}

/**
 * Keeps the cache in step with the app's workspace events: answers turn stale when the outline,
 * the recent views, the people or permissions change, and a revoked view is dropped. One listener
 * set per app emitter, which stays while no panel is open.
 */
export function subscribeMentionSearchCacheInvalidation(eventEmitter: EventEmitter | undefined) {
  if (!eventEmitter || invalidationEmitters.has(eventEmitter)) return;

  invalidationEmitters.add(eventEmitter);
  MENTION_SEARCH_STALE_EVENTS.forEach((event) => {
    eventEmitter.on(event, () => markMentionSearchCacheStale());
  });
  eventEmitter.on(APP_EVENTS.VIEW_ACCESS_REVOKED, (payload?: { viewId?: string }) => {
    if (payload?.viewId) forgetMentionSearchView(payload.viewId);
    else markMentionSearchCacheStale();
  });
}

// Cached answers belong to the account that asked.
on(EventType.SESSION_INVALID, clearMentionSearchCache);

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

  setMentionSearchCacheEntry(key, {
    ...previous,
    sections: previous?.sections ?? [],
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

  setMentionSearchCacheEntry(key, {
    ...previous,
    sections: previous?.sections ?? [],
    refreshPromise,
  });

  return refreshPromise;
}

export function clearMentionSearchCacheForTests() {
  clearMentionSearchCache();
  cacheScope = undefined;
}
