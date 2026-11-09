import { ERROR_CODE } from '@/application/constants';
import {
  MentionSearchOptions,
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';

import {
  isMentionSearchCancelled,
  MENTION_TYPED_DEADLINE_MS,
  MENTION_TYPED_LANES,
  mentionRequestLane,
  MentionRequestLanes,
} from '../mentionRequestLanes';
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
      tickets: [],
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
      tickets: [],
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
    await expect(result).resolves.toEqual({ sections: pages.sections, databaseRowResponse: undefined, tickets: [] });
    expect(onSections).not.toHaveBeenCalled();
  });

  describe('with request tickets', () => {
    // Settles like axios: a request rejects as cancelled once its signal aborts.
    function laterOrAborted(delayMs: number, outcome: MentionSearchResponse | { error: unknown }, signal?: AbortSignal) {
      return new Promise<MentionSearchResponse>((resolve, reject) => {
        const timer = setTimeout(() => ('error' in outcome ? reject(outcome.error) : resolve(outcome)), delayMs);

        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject({ code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' });
        });
      });
    }

    function createTicketSearch(lanes: {
      primary: Array<(signal?: AbortSignal) => Promise<MentionSearchResponse>>;
      rows: typeof lanes.primary;
    }) {
      return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
        const lane = request.include?.includes(MentionTargetKind.DatabaseRow) ? lanes.rows : lanes.primary;
        const next = lane.shift();

        return next ? next(options?.signal) : Promise.reject(new Error('unplanned search'));
      });
    }

    function issueOn(lanes: MentionRequestLanes, refresh = false) {
      return (request: MentionSearchRequest) => lanes.issue(mentionRequestLane(request, refresh));
    }

    it('sends every request, the rows retry included, on its own lane and returns the tickets it used', async () => {
      const lanes = new MentionRequestLanes('session', () => 1_000);
      const search = createTicketSearch({
        primary: [() => later(80, pages)],
        rows: [() => later(80, partialRows), () => later(80, rows)],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
        hasQuery: true,
        isCurrent: () => true,
        issueTicket: issueOn(lanes),
      });

      await jest.advanceTimersByTimeAsync(660);
      const settled = await result;

      expect(
        search.mock.calls.map(([request, options]) => [request.include, options?.streamId, options?.requestTime])
      ).toEqual([
        [[MentionTargetKind.Page], 'web-mention-session-primary', 1_000],
        [[MentionTargetKind.DatabaseRow], 'web-mention-session-rows', 1_000],
        [[MentionTargetKind.DatabaseRow], 'web-mention-session-rows', 1_001],
      ]);
      search.mock.calls.forEach(([, options]) => expect(options?.signal).toBeInstanceOf(AbortSignal));
      expect(settled.databaseRowResponse).toBe(rows);
      expect(settled.tickets.map(({ lane, seq }) => [lane, seq])).toEqual([
        ['primary', 1],
        ['rows', 2],
      ]);
      expect(settled.tickets.every((ticket) => lanes.isCurrent(ticket))).toBe(true);
      // Every settled request stopped its deadline.
      expect(jest.getTimerCount()).toBe(0);
    });

    it('sends a cache refresh on the refresh lanes', async () => {
      const lanes = new MentionRequestLanes('session');
      const search = createTicketSearch({ primary: [() => later(80, pages)], rows: [() => later(80, rows)] });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
        hasQuery: true,
        isCurrent: () => true,
        issueTicket: issueOn(lanes, true),
      });

      await jest.advanceTimersByTimeAsync(80);
      await result;

      expect(search.mock.calls.map(([, options]) => options?.streamId)).toEqual([
        'web-mention-session-refresh',
        'web-mention-session-refresh-rows',
      ]);
    });

    it('reports nothing when the panel aborts a rows request, and does not retry it', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lanes = new MentionRequestLanes('session');
      let current = true;
      const search = createTicketSearch({
        primary: [() => later(80, pages)],
        rows: [(signal) => laterOrAborted(400, rows, signal)],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
        hasQuery: true,
        isCurrent: () => current,
        issueTicket: issueOn(lanes),
      });

      await jest.advanceTimersByTimeAsync(100);
      current = false;
      lanes.abort(MENTION_TYPED_LANES);
      await jest.advanceTimersByTimeAsync(1_000);

      const settled = await result;

      expect(settled.databaseRowResponse).toBeUndefined();
      expect(settled.tickets.some((ticket) => lanes.isCurrent(ticket))).toBe(false);
      expect(search).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(mentionSearchRetryLaterRemainingMs(CACHE_KEY)).toBe(0);
    });

    it('fails a primary request that outlives its deadline with a timeout, not a cancellation', async () => {
      const lanes = new MentionRequestLanes('session');
      let failure: unknown;
      const search = createTicketSearch({
        primary: [(signal) => laterOrAborted(60_000, pages, signal)],
        rows: [() => later(80, rows)],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
        hasQuery: true,
        isCurrent: () => true,
        issueTicket: issueOn(lanes),
      }).catch((error: unknown) => {
        failure = error;
      });

      await jest.advanceTimersByTimeAsync(MENTION_TYPED_DEADLINE_MS - 1);
      expect(failure).toBeUndefined();
      expect(search.mock.calls[0][1]?.signal?.aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await result;

      expect(search.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(failure).toMatchObject({ code: -1, sourceDomain: 'transport', transportFailure: 'timeout' });
      expect(isMentionSearchCancelled(failure)).toBe(false);
    });
  });
});
