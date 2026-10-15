import { ERROR_CODE } from '@/application/constants';
import type { APIError } from '@/application/services/js-services/http/core';
import { MentionSearchSection } from '@/application/types';

const MENTION_SEARCH_CACHE_LIMIT = 50;
const DEFAULT_MENTION_SEARCH_RETRY_LATER_MS = 3000;

interface MentionSearchCacheEntry {
  owner: object;
  sections: MentionSearchSection[];
  cachedAt?: number;
  retryLaterUntil?: number;
  refreshPromise?: Promise<void>;
  read?: object;
}

export interface MentionSearchRead {
  isCurrent: () => boolean;
  setSections: (sections: MentionSearchSection[]) => void;
}

const mentionSearchCache = new Map<string, MentionSearchCacheEntry>();

/** Entries belong to one permission/session scope object (`owner`, by identity). Handles that share
 * it, such as one mounted picker across close and reopen, reuse each other's entries; a new scope
 * after a permission or session change, or a remounted panel (which cannot know what changed while
 * it was unmounted), starts empty even for the same account. Without an owner, the handle itself is
 * the scope. The shared map bounds retained entries across all panels; invalidated async work
 * cannot fill it, and a retired scope frees its entries at once.
 */
export class MentionSearchCache {
  private readonly owner: object;

  constructor(private readonly isCurrent: () => boolean, owner?: object) {
    this.owner = owner ?? this;
  }

  private entry(key: string) {
    if (!this.isCurrent()) return undefined;
    const entry = mentionSearchCache.get(key);

    return entry?.owner === this.owner ? entry : undefined;
  }

  private setEntry(key: string, entry: Omit<MentionSearchCacheEntry, 'owner'>) {
    if (!this.isCurrent()) return;
    if (mentionSearchCache.has(key)) {
      mentionSearchCache.delete(key);
    } else if (mentionSearchCache.size >= MENTION_SEARCH_CACHE_LIMIT) {
      const oldestKey = mentionSearchCache.keys().next().value;

      if (oldestKey !== undefined) mentionSearchCache.delete(oldestKey);
    }

    mentionSearchCache.set(key, { ...entry, owner: this.owner });
  }

  /** Drop this scope's entries once it is replaced or its panel unmounts. */
  retire() {
    mentionSearchCache.forEach((entry, key) => {
      if (entry.owner === this.owner) mentionSearchCache.delete(key);
    });
  }

  getSections(key: string): MentionSearchSection[] | undefined {
    const entry = this.entry(key);

    return entry?.cachedAt !== undefined ? entry.sections : undefined;
  }

  /** A newer read or RetryLater retires this attempt, even within an unchanged access scope. */
  beginRead(key: string): MentionSearchRead {
    const read = {};
    const previous = this.entry(key);

    this.setEntry(key, { ...previous, sections: previous?.sections ?? [], read });
    const isCurrent = () => this.entry(key)?.read === read;

    return {
      isCurrent,
      setSections: (sections) => {
        if (isCurrent()) this.setEntry(key, { ...this.entry(key), sections, cachedAt: Date.now() });
      },
    };
  }

  markRetryLater(key: string, error?: APIError) {
    const previous = this.entry(key);

    this.setEntry(key, {
      refreshPromise: previous?.refreshPromise,
      // RetryLater can signal changed/dirty authority before a notification arrives.
      // Its cooldown is not evidence that previously returned suggestions remain readable.
      sections: [],
      retryLaterUntil: Date.now() + mentionSearchRetryLaterDelayMs(error),
    });
  }

  forget(key: string) {
    if (this.entry(key)) mentionSearchCache.delete(key);
  }

  retryLaterRemainingMs(key: string): number {
    const until = this.entry(key)?.retryLaterUntil;

    return until ? Math.max(until - Date.now(), 0) : 0;
  }

  startRefresh(key: string, refresh: () => Promise<void>) {
    if (!this.isCurrent()) return Promise.resolve();
    const previous = this.entry(key);

    if (previous?.refreshPromise) return previous.refreshPromise;
    const refreshPromise = refresh().finally(() => {
      const current = this.entry(key);

      // A stale completion must not clear another scope's in-flight refresh.
      if (current?.refreshPromise === refreshPromise) {
        this.setEntry(key, { ...current, refreshPromise: undefined });
      }
    });

    const started = this.entry(key);

    this.setEntry(key, { ...started, sections: started?.sections ?? [], refreshPromise });
    return refreshPromise;
  }
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

export function clearMentionSearchCacheForTests() {
  mentionSearchCache.clear();
}
