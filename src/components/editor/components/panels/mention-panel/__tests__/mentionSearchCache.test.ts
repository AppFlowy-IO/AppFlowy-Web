import { ERROR_CODE } from '@/application/constants';
import { MentionSearchSectionKind } from '@/application/types';

import {
  clearMentionSearchCacheForTests,
  getCachedMentionSections,
  markMentionSearchRetryLater,
  mentionSearchRetryLaterRemainingMs,
  setCachedMentionSections,
  startMentionSearchRefresh,
} from '../mentionSearchCache';

describe('mentionSearchCache', () => {
  beforeEach(() => {
    clearMentionSearchCacheForTests();
  });

  it('does not treat a retry-later cooldown as cached mention data', () => {
    markMentionSearchRetryLater('empty-query', {
      code: ERROR_CODE.RETRY_LATER,
      message: 'retry later',
    });

    expect(mentionSearchRetryLaterRemainingMs('empty-query')).toBeGreaterThan(0);
    expect(getCachedMentionSections('empty-query')).toBeUndefined();
  });

  it('keeps cached mention data available while retry-later cooldown is active', () => {
    const sections = [
      {
        kind: MentionSearchSectionKind.Pages,
        title: 'Pages',
        status: 'ready',
        has_more: false,
        items: [],
      },
    ];

    setCachedMentionSections('page-query', sections);
    markMentionSearchRetryLater('page-query', {
      code: ERROR_CODE.RETRY_LATER,
      message: 'retry later',
    });

    expect(mentionSearchRetryLaterRemainingMs('page-query')).toBeGreaterThan(0);
    expect(getCachedMentionSections('page-query')).toBe(sections);
  });

  it('deduplicates in-flight refreshes for the same cache key', async () => {
    let requestCount = 0;
    const refresh = () => {
      requestCount += 1;
      return Promise.resolve();
    };

    const first = startMentionSearchRefresh('page-query', refresh);
    const second = startMentionSearchRefresh('page-query', refresh);

    expect(second).toBe(first);
    await first;
    expect(requestCount).toBe(1);
  });
});
