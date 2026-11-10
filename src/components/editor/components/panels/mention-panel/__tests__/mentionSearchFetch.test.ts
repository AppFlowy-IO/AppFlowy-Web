import { ERROR_CODE } from '@/application/constants';
import {
  MentionSearchOptions,
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';

import {
  isMentionSearchCancelled,
  MENTION_TYPED_DEADLINE_MS,
  mentionRequestLane,
  MentionRequestLanes,
  MentionRequestTicket,
} from '../mentionRequestLanes';
import { clearMentionSearchCacheForTests, mentionSearchRetryLaterRemainingMs } from '../mentionSearchCache';
import { fetchMentionSearchSections, mentionLaneFailureStatus, MentionSectionsFetchResult } from '../mentionSearchFetch';
import { buildMentionSearchRequests, mergeMentionSearchResponses } from '../mentionUtils';

const CACHE_KEY = 'mention-search';
const typedRequests = buildMentionSearchRequests({
  query: 'road',
  include: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
});
// The picker's typed primary request, which Cloud answers with People, Dates and Links of its own.
const pickerRequests = buildMentionSearchRequests({
  query: 'road',
  include: [
    MentionTargetKind.Person,
    MentionTargetKind.Page,
    MentionTargetKind.Database,
    MentionTargetKind.DatabaseRow,
    MentionTargetKind.Date,
  ],
});

function response(kind: MentionSearchSectionKind, title: string, partial?: boolean): MentionSearchResponse {
  const itemKind = kind === MentionSearchSectionKind.Pages ? MentionTargetKind.Page : MentionTargetKind.DatabaseRow;

  return {
    sections: [
      {
        kind,
        title: kind,
        has_more: false,
        status: 'ok',
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

function failedSection(kind: MentionSearchSectionKind): MentionSearchSection {
  return { kind, title: kind, items: [], has_more: false, status: 'failed', message: 'unavailable' };
}

const pages = response(MentionSearchSectionKind.Pages, 'Roadmap');
const rows = response(MentionSearchSectionKind.DatabaseRows, 'Row');
// Search's breadcrumb paths were load-shed: every row is there, only `partial` is set.
const pathShedRows = response(MentionSearchSectionKind.DatabaseRows, 'Path-shed row', true);
// A degraded keyword search fails the requested Pages section, where Search puts typed rows.
const failedPagesRows: MentionSearchResponse = {
  sections: [failedSection(MentionSearchSectionKind.Pages)],
  partial: true,
};
// Cloud fails a rows section when its object source errs or times out.
const failedRowsSection: MentionSearchResponse = {
  sections: [failedSection(MentionSearchSectionKind.DatabaseRows)],
  partial: true,
};
// A disabled keyword index fails the section for good, without `partial`.
const indexDisabledRows: MentionSearchResponse = { sections: [failedSection(MentionSearchSectionKind.Pages)] };
const supersededRows: MentionSearchResponse = { sections: [], partial: true };

function later(delayMs: number, outcome: MentionSearchResponse | { error: unknown }) {
  return new Promise<MentionSearchResponse>((resolve, reject) => {
    setTimeout(() => ('error' in outcome ? reject(outcome.error) : resolve(outcome)), delayMs);
  });
}

function createSearch(lanes: { primary: Array<() => Promise<MentionSearchResponse>>; rows: typeof lanes.primary }) {
  return jest.fn((request: MentionSearchRequest) => {
    const include = request.include ?? [];
    const lane = include.length === 1 && include[0] === MentionTargetKind.DatabaseRow ? lanes.rows : lanes.primary;
    const next = lane.shift();

    return next ? next() : Promise.reject(new Error('unplanned search'));
  });
}

function fetchTyped(search: ReturnType<typeof createSearch>, extra: { onSections?: jest.Mock } = {}) {
  return fetchMentionSearchSections({
    searchMentions: search,
    requests: typedRequests,
    cacheKey: CACHE_KEY,
    isCurrent: () => true,
    ...extra,
  });
}

describe('fetchMentionSearchSections', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clearMentionSearchCacheForTests();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('the rows retry', () => {
    it('never retries rows that are partial only because paths were shed, and the answer is complete', async () => {
      const search = createSearch({ primary: [() => later(80, pages)], rows: [() => later(80, pathShedRows)] });
      const result = fetchTyped(search);

      await jest.advanceTimersByTimeAsync(2_000);

      await expect(result).resolves.toMatchObject({
        sections: mergeMentionSearchResponses([pages, pathShedRows]).sections,
        state: 'complete',
        cacheable: true,
      });
      expect(search).toHaveBeenCalledTimes(2);
    });

    it.each([
      { name: 'a failed Pages section from Search', firstRows: failedPagesRows },
      { name: 'a failed DatabaseRows section from Cloud', firstRows: failedRowsSection },
      { name: 'a superseded answer', firstRows: supersededRows },
    ])('retries rows once, 500 ms later, after $name', async ({ firstRows }) => {
      const onSections = jest.fn();
      const search = createSearch({
        primary: [() => later(80, pages)],
        rows: [() => later(80, firstRows), () => later(80, rows)],
      });
      const result = fetchTyped(search, { onSections });

      await jest.advanceTimersByTimeAsync(579);
      expect(search).toHaveBeenCalledTimes(2);
      // The primary sections show while the retry waits.
      expect(onSections).toHaveBeenLastCalledWith(mergeMentionSearchResponses([pages, firstRows]).sections);

      await jest.advanceTimersByTimeAsync(1);
      expect(search).toHaveBeenCalledTimes(3);

      await jest.advanceTimersByTimeAsync(80);
      await expect(result).resolves.toMatchObject({
        sections: mergeMentionSearchResponses([pages, rows]).sections,
        state: 'complete',
        cacheable: true,
      });
      await jest.advanceTimersByTimeAsync(2_000);
      expect(search).toHaveBeenCalledTimes(3);
    });

    it('retries rows only once, and a second failed answer leaves the answer unavailable', async () => {
      const search = createSearch({
        primary: [() => later(80, pages)],
        rows: [() => later(80, failedPagesRows), () => later(80, failedRowsSection)],
      });
      const result = fetchTyped(search);

      await jest.advanceTimersByTimeAsync(3_000);

      await expect(result).resolves.toMatchObject({ state: 'unavailable', cacheable: false });
      expect(search).toHaveBeenCalledTimes(3);
    });

    // The retry could not complete the answer, so it settles at once. The panel sends every request
    // again from its Retry row or busy countdown.
    it.each([
      {
        name: 'the primary request failed',
        primary: () => later(80, { error: { code: 500, message: 'Internal Server Error' } }),
        state: 'unavailable',
      },
      {
        name: 'the primary request was asked to retry later',
        primary: () => later(80, { error: { code: ERROR_CODE.RETRY_LATER, message: 'retry later' } }),
        state: 'busy',
      },
      {
        name: 'the primary answer has a failed section',
        primary: () => later(80, failedPagesRows),
        state: 'unavailable',
      },
    ])('never retries failed rows when $name, and settles at once', async ({ primary, state }) => {
      const search = createSearch({
        primary: [primary],
        rows: [() => later(80, failedPagesRows), () => later(80, rows)],
      });
      let settled: MentionSectionsFetchResult | undefined;

      void fetchTyped(search).then((answer) => {
        settled = answer;
      });
      await jest.advanceTimersByTimeAsync(80);

      expect(settled).toMatchObject({ state, cacheable: false });
      await jest.advanceTimersByTimeAsync(2_000);
      expect(search).toHaveBeenCalledTimes(2);
    });

    it('never retries a section that failed without partial, as with a disabled keyword index', async () => {
      const search = createSearch({ primary: [() => later(80, pages)], rows: [() => later(80, indexDisabledRows)] });
      const result = fetchTyped(search);

      await jest.advanceTimersByTimeAsync(2_000);

      await expect(result).resolves.toMatchObject({ state: 'unavailable' });
      expect(search).toHaveBeenCalledTimes(2);
    });

    it('never retries a rows request that was rejected, and reports it', async () => {
      const rowsError = { code: 500, message: 'Internal Server Error' };
      const search = createSearch({ primary: [() => later(80, pages)], rows: [() => later(80, { error: rowsError })] });
      const result = fetchTyped(search);

      await jest.advanceTimersByTimeAsync(2_000);
      const settled = await result;

      expect(search).toHaveBeenCalledTimes(2);
      expect(settled.state).toBe('unavailable');
      expect(settled.sections).toEqual(pages.sections);
      expect(settled.outcomes.map(({ status }) => status)).toEqual(['ok', 'failed']);
      expect(console.error).toHaveBeenCalledWith(rowsError);
    });

    it('stops delivering and skips the rows retry once the search is no longer current', async () => {
      const onSections = jest.fn();
      let current = true;
      const search = createSearch({
        primary: [() => later(80, pages)],
        rows: [() => later(200, failedPagesRows), () => later(80, rows)],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
        isCurrent: () => current,
        onSections,
      });

      await jest.advanceTimersByTimeAsync(100);
      current = false;
      await jest.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toMatchObject({
        sections: mergeMentionSearchResponses([pages, failedPagesRows]).sections,
        state: 'unavailable',
        tickets: [],
      });
      expect(onSections).toHaveBeenCalledTimes(1);
      expect(onSections).toHaveBeenCalledWith(mergeMentionSearchResponses([pages]).sections);
      expect(search).toHaveBeenCalledTimes(2);
    });
  });

  describe('a failed request', () => {
    it('keeps the rows when the primary request fails, and shows nothing before every request settles', async () => {
      // A 503 from a proxy in front of Cloud.
      const primaryError = { code: 503, message: 'Service Unavailable', sourceDomain: 'http', httpStatus: 503 };
      const onSections = jest.fn();
      const search = createSearch({
        primary: [() => later(80, { error: primaryError })],
        rows: [() => later(400, rows)],
      });
      const result = fetchTyped(search, { onSections });

      await jest.advanceTimersByTimeAsync(399);
      expect(onSections).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      const settled = await result;

      expect(settled.sections).toEqual(rows.sections);
      expect(settled.state).toBe('unavailable');
      expect(settled.outcomes.map(({ status, error }) => [status, error])).toEqual([
        ['failed', primaryError],
        ['ok', undefined],
      ]);
      expect(onSections).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(primaryError);
    });

    it('marks the cooldown and reports busy when the primary request is asked to retry later', async () => {
      const retryLater = { code: ERROR_CODE.RETRY_LATER, message: 'retry later' };
      const search = createSearch({ primary: [() => later(80, { error: retryLater })], rows: [() => later(80, rows)] });
      const result = fetchTyped(search);

      await jest.advanceTimersByTimeAsync(80);
      const settled = await result;

      expect(settled.state).toBe('busy');
      expect(settled.sections).toEqual(rows.sections);
      // Mention RetryLater carries no Retry-After, so the cooldown is the 3 s default.
      expect(mentionSearchRetryLaterRemainingMs(CACHE_KEY)).toBe(3_000);
      expect(console.error).not.toHaveBeenCalled();
      expect(search).toHaveBeenCalledTimes(2);
    });

    it('keeps the primary answer and marks the cooldown when the rows request is asked to retry later', async () => {
      const retryLater = { code: ERROR_CODE.RETRY_LATER, message: 'retry later', retryAfterSecs: 2 };
      const search = createSearch({ primary: [() => later(80, pages)], rows: [() => later(80, { error: retryLater })] });
      const result = fetchTyped(search);

      await jest.advanceTimersByTimeAsync(2_000);
      const settled = await result;

      expect(settled.state).toBe('unavailable');
      expect(settled.sections).toEqual(pages.sections);
      expect(mentionSearchRetryLaterRemainingMs(CACHE_KEY)).toBeGreaterThan(0);
      expect(search).toHaveBeenCalledTimes(2);
    });

    it('reports offline when the transport fails while the browser is offline', async () => {
      jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      const networkError = {
        code: -1,
        message: 'Network Error',
        sourceDomain: 'transport',
        transportFailure: 'network',
      };
      const search = createSearch({
        primary: [() => later(10, { error: networkError })],
        rows: [() => later(10, { error: networkError })],
      });
      const result = fetchTyped(search);

      await jest.advanceTimersByTimeAsync(10);

      await expect(result).resolves.toMatchObject({ state: 'offline', sections: [] });
    });
  });

  describe('completeness', () => {
    // The panel aborts its own superseded primary requests, so this shape is almost always a People
    // annotation that degraded (`partial`) over objects that matched nothing.
    it('shows a primary answer of the superseded shape as complete, but never caches it', async () => {
      const people: MentionSearchSection = { ...failedSection(MentionSearchSectionKind.People), status: 'ok' };
      const dates: MentionSearchSection = { ...failedSection(MentionSearchSectionKind.Dates), status: 'ok' };
      const search = createSearch({
        primary: [() => later(80, { sections: [people, dates], partial: true })],
        rows: [() => later(80, rows)],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: pickerRequests,
        cacheKey: CACHE_KEY,
        isCurrent: () => true,
      });

      await jest.advanceTimersByTimeAsync(2_000);

      await expect(result).resolves.toMatchObject({ state: 'complete', cacheable: false });
      // Only the rows request is ever retried.
      expect(search).toHaveBeenCalledTimes(2);
    });

    it('treats an answer without section status, from an older server, as complete', async () => {
      const legacy = (answer: MentionSearchResponse) => ({
        ...answer,
        sections: answer.sections.map(({ status: _status, ...rest }) => rest as MentionSearchSection),
      });
      const search = createSearch({ primary: [() => later(80, legacy(pages))], rows: [() => later(80, legacy(rows))] });
      const result = fetchTyped(search);

      await jest.advanceTimersByTimeAsync(80);

      await expect(result).resolves.toMatchObject({ state: 'complete', cacheable: true });
    });

    it('never delivers intermediate sections for an unsplit empty-query search', async () => {
      const onSections = jest.fn();
      const requests = buildMentionSearchRequests({ query: '', include: [MentionTargetKind.Page] });
      const result = fetchMentionSearchSections({
        searchMentions: createSearch({ primary: [() => later(80, pages)], rows: [] }),
        requests,
        cacheKey: CACHE_KEY,
        isCurrent: () => true,
        onSections,
      });

      await jest.advanceTimersByTimeAsync(80);

      expect(requests).toHaveLength(1);
      await expect(result).resolves.toMatchObject({ sections: pages.sections, state: 'complete', tickets: [] });
      expect(onSections).not.toHaveBeenCalled();
    });
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
        rows: [() => later(80, failedPagesRows), () => later(80, rows)],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
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
      expect(settled.outcomes[1].response).toBe(rows);
      expect(settled.state).toBe('complete');
      expect(settled.tickets.map(({ lane, seq }) => [lane, seq])).toEqual([
        ['primary', 1],
        ['rows', 2],
      ]);
      expect(settled.tickets.every((ticket) => lanes.isCurrent(ticket))).toBe(true);
      // Every settled request stopped its deadline.
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each([false, true])('keeps the first answer current when the rows retry fails (refresh: %s)', async (refresh) => {
      const retryError = new Error('rows retry failed');
      const lanes = new MentionRequestLanes('session');
      const search = createTicketSearch({
        primary: [() => later(80, pages)],
        rows: [() => later(80, failedPagesRows), () => later(80, { error: retryError })],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
        isCurrent: () => true,
        issueTicket: issueOn(lanes, refresh),
      });

      await jest.advanceTimersByTimeAsync(660);
      const settled = await result;

      expect(search).toHaveBeenCalledTimes(3);
      expect(settled.sections).toEqual(pages.sections);
      expect(settled.state).toBe('unavailable');
      expect(settled.outcomes.map(({ status }) => status)).toEqual(['ok', 'failed']);
      // The retry replaced the first rows ticket on its lane, so the answer rests on the primary.
      expect(settled.tickets.map(({ lane }) => lane)).toEqual([refresh ? 'refresh' : 'primary']);
      expect(settled.tickets.every((ticket) => lanes.isCurrent(ticket))).toBe(true);
      expect(console.error).toHaveBeenCalledWith(retryError);
    });

    it('sends a cache refresh on the refresh lanes', async () => {
      const lanes = new MentionRequestLanes('session');
      const search = createTicketSearch({ primary: [() => later(80, pages)], rows: [() => later(80, rows)] });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
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
      const lanes = new MentionRequestLanes('session');
      const issued: MentionRequestTicket[] = [];
      let current = true;
      const search = createTicketSearch({
        primary: [() => later(80, pages)],
        rows: [(signal) => laterOrAborted(400, rows, signal)],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
        isCurrent: () => current,
        issueTicket: (request) => {
          const ticket = issueOn(lanes)(request);

          issued.push(ticket);
          return ticket;
        },
      });

      await jest.advanceTimersByTimeAsync(100);
      current = false;
      // As the panel aborts the search's tickets.
      issued.forEach((ticket) => ticket.abort());
      await jest.advanceTimersByTimeAsync(1_000);

      const settled = await result;

      expect(settled.outcomes.map(({ status }) => status)).toEqual(['ok', 'cancelled']);
      expect(settled.state).toBe('unavailable');
      expect(settled.tickets.some((ticket) => lanes.isCurrent(ticket))).toBe(false);
      expect(search).toHaveBeenCalledTimes(2);
      expect(console.error).not.toHaveBeenCalled();
      expect(mentionSearchRetryLaterRemainingMs(CACHE_KEY)).toBe(0);
    });

    it('fails a primary request that outlives its deadline with a timeout, not a cancellation', async () => {
      const lanes = new MentionRequestLanes('session');
      let settledAt: number | undefined;
      const startedAt = Date.now();
      const search = createTicketSearch({
        primary: [(signal) => laterOrAborted(60_000, pages, signal)],
        rows: [() => later(80, rows)],
      });
      const result = fetchMentionSearchSections({
        searchMentions: search,
        requests: typedRequests,
        cacheKey: CACHE_KEY,
        isCurrent: () => true,
        issueTicket: issueOn(lanes),
      }).then((answer) => {
        settledAt = Date.now() - startedAt;
        return answer;
      });

      await jest.advanceTimersByTimeAsync(MENTION_TYPED_DEADLINE_MS - 1);
      expect(settledAt).toBeUndefined();
      expect(search.mock.calls[0][1]?.signal?.aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      const settled = await result;

      expect(settledAt).toBe(MENTION_TYPED_DEADLINE_MS);
      expect(search.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(settled.state).toBe('unavailable');
      expect(settled.sections).toEqual(rows.sections);
      expect(settled.outcomes[0]).toMatchObject({
        status: 'timeout',
        error: { code: -1, sourceDomain: 'transport', transportFailure: 'timeout' },
      });
      expect(isMentionSearchCancelled(settled.outcomes[0].error)).toBe(false);
    });
  });
});

describe('mentionLaneFailureStatus', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const transport = (transportFailure: string) => ({
    code: -1,
    message: '',
    sourceDomain: 'transport',
    transportFailure,
  });

  it('classifies failures by what the user can do about them', () => {
    expect(
      [
        transport('cancelled'),
        { code: ERROR_CODE.RETRY_LATER, message: 'retry later' },
        transport('timeout'),
        transport('network'),
        { code: 500, message: 'Internal Server Error' },
        new Error('unexpected'),
        undefined,
      ].map(mentionLaneFailureStatus)
    ).toEqual(['cancelled', 'retry_later', 'timeout', 'failed', 'failed', 'failed', 'failed']);
  });

  it('reports a transport failure while the browser is offline as offline, but not a server answer', () => {
    jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);

    expect(
      [
        transport('network'),
        transport('timeout'),
        transport('cancelled'),
        { code: ERROR_CODE.RETRY_LATER, message: 'retry later' },
        { code: 500, message: 'Internal Server Error' },
      ].map(mentionLaneFailureStatus)
    ).toEqual(['offline', 'offline', 'cancelled', 'retry_later', 'failed']);
  });
});
