import { ERROR_CODE } from '@/application/constants';
import { MentionSearchSectionKind } from '@/application/types';

import { clearMentionSearchCacheForTests, MentionSearchCache } from '../mentionSearchCache';

describe('mentionSearchCache', () => {
  let cache: MentionSearchCache;

  beforeEach(() => {
    clearMentionSearchCacheForTests();
    cache = new MentionSearchCache(() => true);
  });

  it('does not treat a retry-later cooldown as cached mention data', () => {
    cache.markRetryLater('empty-query', {
      code: ERROR_CODE.RETRY_LATER,
      message: 'retry later',
    });

    expect(cache.retryLaterRemainingMs('empty-query')).toBeGreaterThan(0);
    expect(cache.getSections('empty-query')).toBeUndefined();
  });

  it('discards cached mention data when authority asks to retry later', () => {
    const sections = [
      {
        kind: MentionSearchSectionKind.Pages,
        title: 'Pages',
        status: 'ready',
        has_more: false,
        items: [],
      },
    ];

    cache.beginRead('page-query').setSections(sections);
    cache.markRetryLater('page-query', {
      code: ERROR_CODE.RETRY_LATER,
      message: 'retry later',
    });

    expect(cache.retryLaterRemainingMs('page-query')).toBeGreaterThan(0);
    expect(cache.getSections('page-query')).toBeUndefined();
  });

  it('deduplicates in-flight refreshes for the same cache key', async () => {
    let requestCount = 0;
    const refresh = () => {
      requestCount += 1;
      return Promise.resolve();
    };

    const first = cache.startRefresh('page-query', refresh);
    const second = cache.startRefresh('page-query', refresh);

    expect(second).toBe(first);
    await first;
    expect(requestCount).toBe(1);
  });
  it('cannot publish a late success after RetryLater or a newer read', () => {
    const older = cache.beginRead('same-key');

    cache.markRetryLater('same-key', { code: ERROR_CODE.RETRY_LATER, message: 'changed authority' });
    older.setSections([]);
    expect(older.isCurrent()).toBe(false);
    expect(cache.getSections('same-key')).toBeUndefined();
    const current = cache.beginRead('same-key');
    const currentSections: [] = [];

    current.setSections(currentSections);
    older.setSections([]);
    expect(cache.getSections('same-key')).toBe(currentSections);
  });

  it('isolates identical keys across fresh scope instances and rejects invalidated writes', async () => {
    let current = true;
    const old = new MentionSearchCache(() => current);
    const read = old.beginRead('same-account-and-workspace');

    read.setSections([]);
    let release!: () => void;
    const pending = old.startRefresh(
      'same-account-and-workspace',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    current = false;
    expect(old.getSections('same-account-and-workspace')).toBeUndefined();
    const next = new MentionSearchCache(() => true);

    expect(next.getSections('same-account-and-workspace')).toBeUndefined();
    expect(next.retryLaterRemainingMs('same-account-and-workspace')).toBe(0);
    const nextSections: [] = [];

    next.beginRead('same-account-and-workspace').setSections(nextSections);
    old.markRetryLater('same-account-and-workspace');
    read.setSections([]);
    release();
    await pending;
    expect(next.getSections('same-account-and-workspace')).toBe(nextSections);
    const forbidden = jest.fn();

    await old.startRefresh('same-account-and-workspace', forbidden);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('bounds retained entries to 50 across scopes and fences an evicted in-flight read', () => {
    const evicted = cache.beginRead('first');

    for (let index = 0; index < 50; index += 1) {
      new MentionSearchCache(() => true).beginRead(`other-${index}`).setSections([]);
    }

    evicted.setSections([]);
    expect(evicted.isCurrent()).toBe(false);
    expect(cache.getSections('first')).toBeUndefined();
  });
});
