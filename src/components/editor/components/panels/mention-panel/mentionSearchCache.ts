import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import type { APIError } from '@/application/services/js-services/http/core';
import { MentionSearchResultItem, MentionSearchSection, MentionTargetKind } from '@/application/types';

import { onMentionSessionInvalid } from './mentionSessionInvalid';

import type { EventEmitter } from 'events';

const MENTION_SEARCH_CACHE_LIMIT = 50;
const DEFAULT_MENTION_SEARCH_RETRY_LATER_MS = 3000;
// How many revoked views are remembered. They filter late answers, which settle within seconds, and
// keep the picker from bringing one back from the local index until access returns (MEN-WEB-10);
// far fewer views are revoked in a session.
const MENTION_SEARCH_REVOKED_VIEW_LIMIT = 100;

/**
 * A cached answer younger than this is shown without asking the server again, unless an event
 * marked it stale since.
 */
export const MENTION_SEARCH_CACHE_FRESH_MS = 10_000;

/**
 * Workspace events after which a cached answer may be outdated, so its next use revalidates it.
 * `PERMISSION_CHANGED` does too, and more (see {@link markMentionSearchAccessChanged}).
 */
const MENTION_SEARCH_STALE_EVENTS = [
  APP_EVENTS.SECTION_CHANGED,
  APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED,
  APP_EVENTS.FOLDER_OUTLINE_CHANGED,
  APP_EVENTS.FOLDER_VIEW_CHANGED,
];

interface MentionSearchCacheEntry {
  sections: MentionSearchSection[];
  cachedAt?: number;
  /** The send sequence of the request that `sections` answer. An older request's answer is ignored. */
  sequence?: number;
  /** The cache generation that request was sent in ({@link MentionSearchCacheStamp}). */
  generation?: number;
  /** An event may have changed the answer since it was cached, so its next use revalidates it. */
  stale?: boolean;
  retryLaterUntil?: number;
  /** The refresh of this key in flight, which resolves with what the refresh answered. */
  refreshPromise?: Promise<unknown>;
}

/** A cached answer, with whether it is fresh enough to show without asking the server again. */
export interface CachedMentionSearch {
  sections: MentionSearchSection[];
  cachedAt: number;
  fresh: boolean;
}

/**
 * When a request was sent, as far as the cache is concerned. An answer to a request sent before the
 * cache was cleared is dropped, and so is one sent before the answer already stored under its key.
 * One sent before entries were marked stale is stored stale, without the views revoked since.
 */
export interface MentionSearchCacheStamp {
  readonly epoch: number;
  readonly generation: number;
  /** Counts stamps, so a request sent later has a larger sequence. */
  readonly sequence: number;
}

const mentionSearchCache = new Map<string, MentionSearchCacheEntry>();
// Counts clears (sign-out, workspace switch). An answer from an earlier epoch is never stored.
let cacheEpoch = 0;
// Counts stale marks. An answer sent before the latest one is stored, but stale.
let cacheGeneration = 0;
// Counts stamps and writes, in the order requests were sent.
let cacheSequence = 0;
// The generation of the latest access change that names no view (PERMISSION_CHANGED). An answer to a
// request sent in an earlier generation may list a page the user can no longer read.
let accessChangeGeneration = 0;
// Each view the user lost access to and has not regained, with the generation its revoke started.
// Answers to requests sent before may still list it, and so may the local index until its sources
// catch up.
const revokedViewGenerations = new Map<string, number>();
// The ids in `revokedViewGenerations`, replaced whenever they change, and who to tell.
let revokedViewIds: ReadonlySet<string> = new Set();
const revokedViewListeners = new Set<() => void>();
// The workspace and user of the entries, from the last panel that opened.
let cacheScope: string | undefined;
const invalidationEmitters = new WeakSet<EventEmitter>();

/** A cached answer as {@link MentionSearchCacheView} reads it, with when its request was sent. */
export interface CachedMentionAnswer {
  sections: MentionSearchSection[];
  /**
   * The send sequence of the request it answers ({@link MentionSearchCacheStamp}): of two cached
   * answers, the one with the larger sequence was asked for later.
   */
  sequence: number;
  /**
   * When it was stored, in epoch milliseconds. The picker's bare `@` patch lifts this tab's activity
   * since shortly before (MEN-WEB-09).
   */
  cachedAt: number;
  /**
   * Its request was sent before the user's access last changed in a way that names no view
   * ({@link markMentionSearchAccessChanged}), so it may list a page the user can no longer read.
   */
  beforeAccessChange: boolean;
}

/**
 * The cached answers as a render reads them (MEN-WEB-08's provisional sections), replaced after
 * every change, so a memo that depends on it reads them again.
 */
export interface MentionSearchCacheView {
  /** Counts the changes to the cached answers. */
  readonly version: number;
  /**
   * The cache generation of the user's latest access change that names no view
   * ({@link markMentionSearchAccessChanged}): a request stamped in an earlier generation
   * ({@link MentionSearchCacheStamp}) was sent before it, and its answer may list a page the user
   * can no longer read. It changes only with such a change.
   */
  readonly accessChangeGeneration: number;
  /** The cached answer of `key`, fresh or stale, with when its request was sent. */
  answer(key: string): CachedMentionAnswer | undefined;
}

function cachedMentionAnswer(key: string): CachedMentionAnswer | undefined {
  const entry = mentionSearchCache.get(key);

  // Every stored answer has a sequence and a generation; an entry without `cachedAt` only holds
  // bookkeeping.
  return entry?.cachedAt
    ? {
        sections: entry.sections,
        sequence: entry.sequence ?? 0,
        cachedAt: entry.cachedAt,
        beforeAccessChange: (entry.generation ?? 0) < accessChangeGeneration,
      }
    : undefined;
}

function createMentionSearchCacheView(version: number): MentionSearchCacheView {
  return { version, accessChangeGeneration, answer: cachedMentionAnswer };
}

let cacheView = createMentionSearchCacheView(0);
const cacheListeners = new Set<() => void>();

function cachedAnswersChanged() {
  cacheView = createMentionSearchCacheView(cacheView.version + 1);
  cacheListeners.forEach((listener) => listener());
}

/**
 * The cached answers, a new view after every change to them: one is stored, every answer turns
 * stale, a revoked view leaves them, or the cache is cleared. Cooldown and refresh bookkeeping
 * change no answer.
 */
export function getMentionSearchCacheView(): MentionSearchCacheView {
  return cacheView;
}

/** Calls `listener` whenever {@link getMentionSearchCacheView} changes; returns the unsubscribe. */
export function subscribeMentionSearchCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

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

function nextCacheSequence() {
  cacheSequence += 1;
  return cacheSequence;
}

/** Captures the cache's state when a request is sent; pass it to {@link setCachedMentionSections}. */
export function mentionSearchCacheStamp(): MentionSearchCacheStamp {
  return { epoch: cacheEpoch, generation: cacheGeneration, sequence: nextCacheSequence() };
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
 * cache was cleared is dropped, and so is one sent before the answer stored under `key`, which
 * arrived first: a bare request outlives its panel, so two of them can answer out of order. One
 * sent before entries were marked stale is stored stale, without the views revoked since. Without
 * a stamp, the answer counts as sent now.
 */
export function setCachedMentionSections(
  key: string,
  sections: MentionSearchSection[],
  stamp?: MentionSearchCacheStamp
) {
  if (stamp && stamp.epoch !== cacheEpoch) return;

  const previous = mentionSearchCache.get(key);
  const sequence = stamp?.sequence ?? nextCacheSequence();

  if (previous?.sequence !== undefined && sequence < previous.sequence) return;

  setMentionSearchCacheEntry(key, {
    ...previous,
    sections: stamp ? withoutRevokedMentionViews(sections, stamp) : sections,
    cachedAt: Date.now(),
    sequence,
    generation: stamp?.generation ?? cacheGeneration,
    stale: stamp !== undefined && stamp.generation !== cacheGeneration,
  });
  cachedAnswersChanged();
}

/** Marks every cached answer stale: it is still shown at once, but its next use revalidates it. */
export function markMentionSearchCacheStale() {
  cacheGeneration += 1;
  mentionSearchCache.forEach((entry, key) => {
    mentionSearchCache.set(key, { ...entry, stale: true });
  });
  cachedAnswersChanged();
}

/**
 * The user's access changed in a way that names no view they lost (`PERMISSION_CHANGED`: a space's
 * access or members, a member's role, a group). Marks every answer stale, as other workspace events
 * do, and the answers to requests sent before, cached now or later, as asked for before the change
 * ({@link CachedMentionAnswer.beforeAccessChange}): they may list a page the user can no longer
 * read, and no view can be dropped from them.
 */
export function markMentionSearchAccessChanged() {
  // The generation the stale mark below moves to, set first so the view it publishes carries it.
  accessChangeGeneration = cacheGeneration + 1;
  markMentionSearchCacheStale();
}

/** The ids an item shows a view by: the page, the database view, or the view a row is shown through. */
function shownViewIds(item: MentionSearchResultItem): unknown[] {
  // A person's payload names the page the person would be mentioned on, not the person.
  if (item.kind === MentionTargetKind.Person) return [];

  const payload = item.mention as unknown as Record<string, unknown>;

  return [item.object_id, item.database_view_id, payload.page_id, payload.database_view_id];
}

function itemTargetsView(item: MentionSearchResultItem, viewId: string) {
  return shownViewIds(item).includes(viewId);
}

/**
 * Whether `item` shows one of `viewIds`, as {@link withoutMentionView} tells: the page, the database
 * view or a row shown through it, never a person.
 */
export function mentionItemShowsAnyView(item: MentionSearchResultItem, viewIds: ReadonlySet<string>): boolean {
  return viewIds.size > 0 && shownViewIds(item).some((id) => typeof id === 'string' && viewIds.has(id));
}

/**
 * `sections` without the items that show `viewId`: the page, the database view or a row shown
 * through it, never a person. The same array when no item shows it.
 */
export function withoutMentionView(sections: MentionSearchSection[], viewId: string) {
  if (!sections.some((section) => section.items.some((item) => itemTargetsView(item, viewId)))) return sections;

  return sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => !itemTargetsView(item, viewId)),
  }));
}

/**
 * `sections`, the answer to a request stamped `stamp`, without the views revoked after it was
 * sent. The same array when there are none.
 */
export function withoutRevokedMentionViews(sections: MentionSearchSection[], stamp: MentionSearchCacheStamp) {
  let visible = sections;

  revokedViewGenerations.forEach((generation, viewId) => {
    if (generation > stamp.generation) visible = withoutMentionView(visible, viewId);
  });
  return visible;
}

function revokedViewsChanged() {
  revokedViewIds = new Set(revokedViewGenerations.keys());
  revokedViewListeners.forEach((listener) => listener());
}

/**
 * The user lost access to `viewId`: drops it from every cached answer, and from the answers to
 * requests sent before that are stored later, so its title is never shown from the cache. Marks
 * every answer stale. It counts as revoked ({@link getRevokedMentionViews}) until access returns.
 */
export function forgetMentionSearchView(viewId: string) {
  mentionSearchCache.forEach((entry, key) => {
    mentionSearchCache.set(key, { ...entry, sections: withoutMentionView(entry.sections, viewId) });
  });
  markMentionSearchCacheStale();

  // Re-inserted, so the oldest revoke is the first one dropped.
  revokedViewGenerations.delete(viewId);
  revokedViewGenerations.set(viewId, cacheGeneration);
  if (revokedViewGenerations.size > MENTION_SEARCH_REVOKED_VIEW_LIMIT) {
    const oldestViewId = revokedViewGenerations.keys().next().value;

    if (oldestViewId !== undefined) revokedViewGenerations.delete(oldestViewId);
  }

  revokedViewsChanged();
}

/**
 * The user regained access to `viewId`: it no longer counts as revoked, so an answer to a request
 * sent before its revoke keeps it too.
 */
export function restoreMentionSearchView(viewId: string) {
  if (revokedViewGenerations.delete(viewId)) revokedViewsChanged();
}

/**
 * The views the user lost access to in this cache's scope (workspace and account) and has not
 * regained, at most the last {@link MENTION_SEARCH_REVOKED_VIEW_LIMIT}. The same set until one is
 * revoked or restored, or the cache is cleared. The local index lists such a view until its sources
 * catch up, so the picker never brings one back from it.
 */
export function getRevokedMentionViews(): ReadonlySet<string> {
  return revokedViewIds;
}

/** Calls `listener` whenever {@link getRevokedMentionViews} changes; returns the unsubscribe. */
export function subscribeRevokedMentionViews(listener: () => void): () => void {
  revokedViewListeners.add(listener);
  return () => {
    revokedViewListeners.delete(listener);
  };
}

/** Forgets every cached answer and cooldown. Answers to requests sent before are never stored. */
export function clearMentionSearchCache() {
  const hadRevokedViews = revokedViewGenerations.size > 0;

  cacheEpoch += 1;
  cacheGeneration += 1;
  mentionSearchCache.clear();
  revokedViewGenerations.clear();
  if (hadRevokedViews) revokedViewsChanged();
  cachedAnswersChanged();
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
 * the recent views, the people or permissions change, a revoked view is dropped, and a restored
 * one no longer counts as revoked. One listener set per app emitter, which stays while no panel is
 * open.
 */
export function subscribeMentionSearchCacheInvalidation(eventEmitter: EventEmitter | undefined) {
  if (!eventEmitter || invalidationEmitters.has(eventEmitter)) return;

  invalidationEmitters.add(eventEmitter);
  MENTION_SEARCH_STALE_EVENTS.forEach((event) => {
    eventEmitter.on(event, () => markMentionSearchCacheStale());
  });
  eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, () => markMentionSearchAccessChanged());
  eventEmitter.on(APP_EVENTS.VIEW_ACCESS_REVOKED, (payload?: { viewId?: string }) => {
    if (payload?.viewId) forgetMentionSearchView(payload.viewId);
    else markMentionSearchCacheStale();
  });
  eventEmitter.on(APP_EVENTS.VIEW_ACCESS_RESTORED, (payload?: { viewId?: string }) => {
    if (payload?.viewId) restoreMentionSearchView(payload.viewId);
  });
}

// Cached answers belong to the account that asked.
onMentionSessionInvalid(clearMentionSearchCache);

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

/**
 * Runs `refresh` for `key`, unless a refresh of the key is still in flight: that one is joined
 * instead, and its result is returned to this caller too. Every refresh of a key resolves with the
 * same type, so a panel that joins one started by an earlier opening learns what it answered.
 */
export function startMentionSearchRefresh<T>(key: string, refresh: () => Promise<T>): Promise<T> {
  const existing = mentionSearchCache.get(key)?.refreshPromise;

  if (existing) return existing as Promise<T>;

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
