import { ERROR_CODE } from '@/application/constants';
import {
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';

import { clearMentionSearchCacheForTests, mentionSearchRetryLaterRemainingMs } from '../mentionSearchCache';
import { fetchMentionSearchSections } from '../mentionSearchFetch';
import { buildMentionSearchRequests, mergeMentionSearchResponses } from '../mentionUtils';

const CACHE_KEY = 'mention-search';
const typedRequests = buildMentionSearchRequests({
  query: 'road',
  include: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
});

function response(kind: MentionSearchSectionKind, title: string, partial?: boolean): MentionSearchResponse {
  const itemKind = kind === MentionSearchSectionKind.Pages ? MentionTargetKind.Page : MentionTargetKind.DatabaseRow;

  return {
    sections: [
      {
        kind,
        title: kind,
        has_more: false,
        status: 'ready',
        items: [
          {
            kind: itemKind,
            object_id: title,
            title,
            mention: { type: MentionTargetKind.Page, page_id: title },
          },
        ],
      },
    ],
    partial,
  };
}

const pages = response(MentionSearchSectionKind.Pages, 'Roadmap');
const partialRows = response(MentionSearchSectionKind.DatabaseRows, 'Partial row', true);
const rows = response(MentionSearchSectionKind.DatabaseRows, 'Row');

function later(delayMs: number, outcome: MentionSearchResponse | { error: unknown }) {
  return new Promise<MentionSearchResponse>((resolve, reject) => {
    setTimeout(() => ('error' in outcome ? reject(outcome.error) : resolve(outcome)), delayMs);
  });
}

function createSearch(lanes: { primary: Array<() => Promise<MentionSearchResponse>>; rows: typeof lanes.primary }) {
  return jest.fn((request: MentionSearchRequest) => {
    const lane = request.include?.includes(MentionTargetKind.DatabaseRow) ? lanes.rows : lanes.primary;
    const next = lane.shift();

    return next ? next() : Promise.reject(new Error('unplanned search'));
  });
}

describe('fetchMentionSearchSections', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clearMentionSearchCacheForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects with a primary failure only after every request settles, without intermediate sections', async () => {
    const primaryError = new Error('primary failed');
    const onSections = jest.fn();
    let rejectedAtMs: number | undefined;
    const startedAt = Date.now();
    const result = fetchMentionSearchSections({
      searchMentions: createSearch({
        primary: [() => later(80, { error: primaryError })],
        rows: [() => later(400, rows)],
      }),
      requests: typedRequests,
      cacheKey: CACHE_KEY,
      hasQuery: true,
      isCurrent: () => true,
      onSections,
    }).catch((error: unknown) => {
      rejectedAtMs = Date.now() - startedAt;
      return error;
    });

    await jest.advanceTimersByTimeAsync(400);

    await expect(result).resolves.toBe(primaryError);
    expect(rejectedAtMs).toBe(400);
    expect(onSections).not.toHaveBeenCalled();
  });

  it('keeps a database-row RetryLater failure non-blocking and marks the cache key', async () => {
    const onSections = jest.fn();
    const search = createSearch({
      primary: [() => later(80, pages)],
      rows: [() => later(80, { error: { code: ERROR_CODE.RETRY_LATER, message: 'retry later' } }), () => later(80, rows)],
    });
    const result = fetchMentionSearchSections({
      searchMentions: search,
      requests: typedRequests,
      cacheKey: CACHE_KEY,
      hasQuery: true,
      isCurrent: () => true,
      onSections,
    });

    await jest.advanceTimersByTimeAsync(80);
    expect(onSections).toHaveBeenCalledTimes(1);
    expect(onSections).toHaveBeenLastCalledWith(mergeMentionSearchResponses([pages]).sections);
    expect(mentionSearchRetryLaterRemainingMs(CACHE_KEY)).toBeGreaterThan(0);

    await jest.advanceTimersByTimeAsync(580);
    await expect(result).resolves.toEqual({
      sections: mergeMentionSearchResponses([pages, rows]).sections,
      databaseRowResponse: rows,
    });
    expect(search).toHaveBeenCalledTimes(3);
    expect(onSections).toHaveBeenCalledTimes(1);
  });

  it('stops delivering and skips the rows retry once the search is no longer current', async () => {
    const onSections = jest.fn();
    let current = true;
    const search = createSearch({
      primary: [() => later(80, pages)],
      rows: [() => later(200, partialRows), () => later(80, rows)],
    });
    const result = fetchMentionSearchSections({
      searchMentions: search,
      requests: typedRequests,
      cacheKey: CACHE_KEY,
      hasQuery: true,
      isCurrent: () => current,
      onSections,
    });

    await jest.advanceTimersByTimeAsync(100);
    current = false;
    await jest.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual({
      sections: mergeMentionSearchResponses([pages, partialRows]).sections,
      databaseRowResponse: partialRows,
    });
    expect(onSections).toHaveBeenCalledTimes(1);
    expect(onSections).toHaveBeenCalledWith(mergeMentionSearchResponses([pages]).sections);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('never delivers intermediate sections for an unsplit empty-query search', async () => {
    const onSections = jest.fn();
    const requests = buildMentionSearchRequests({ query: '', include: [MentionTargetKind.Page] });
    const result = fetchMentionSearchSections({
      searchMentions: createSearch({ primary: [() => later(80, pages)], rows: [] }),
      requests,
      cacheKey: CACHE_KEY,
      hasQuery: false,
      isCurrent: () => true,
      onSections,
    });

    await jest.advanceTimersByTimeAsync(80);

    expect(requests).toHaveLength(1);
    await expect(result).resolves.toEqual({ sections: pages.sections, databaseRowResponse: undefined });
    expect(onSections).not.toHaveBeenCalled();
  });
});
