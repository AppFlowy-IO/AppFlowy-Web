import { MentionTargetKind } from '@/application/types';

import {
  isMentionSearchCancelled,
  MENTION_BARE_DEADLINE_MS,
  MENTION_TYPED_DEADLINE_MS,
  MENTION_TYPED_LANES,
  MentionLane,
  mentionRequestLane,
  MentionRequestLanes,
  mentionTicketFailure,
  mentionTicketOptions,
} from '../mentionRequestLanes';
import { buildMentionSearchRequests } from '../mentionUtils';

const ALL_LANES: MentionLane[] = ['bare', 'primary', 'rows', 'refresh', 'refresh-rows'];

describe('MentionRequestLanes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('gives every lane of a session its own stream, named after the session', () => {
    const lanes = new MentionRequestLanes('session-a');
    const streams = ALL_LANES.map((lane) => lanes.issue(lane).streamId);

    expect(streams).toEqual([
      'web-mention-session-a-bare',
      'web-mention-session-a-primary',
      'web-mention-session-a-rows',
      'web-mention-session-a-refresh',
      'web-mention-session-a-refresh-rows',
    ]);
    expect(new Set(streams).size).toBe(ALL_LANES.length);
    expect(new MentionRequestLanes('session-b').issue('primary').streamId).toBe('web-mention-session-b-primary');
  });

  it('opens each panel session on new streams', () => {
    const first = new MentionRequestLanes();
    const second = new MentionRequestLanes();

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.issue('primary').streamId).not.toBe(second.issue('primary').streamId);
  });

  it('keeps request times strictly increasing within a lane, also within one millisecond', () => {
    let now = 1_000;
    const lanes = new MentionRequestLanes('session', () => now);

    expect([1, 2, 3].map(() => lanes.issue('primary').requestTime)).toEqual([1_000, 1_001, 1_002]);
    // Lanes count independently: they are different streams.
    expect(lanes.issue('rows').requestTime).toBe(1_000);

    now = 5_000;
    expect(lanes.issue('primary').requestTime).toBe(5_000);

    // A clock that steps back still never repeats or lowers a lane's time.
    now = 4_000;
    expect(lanes.issue('primary').requestTime).toBe(5_001);
    expect(lanes.issue('primary').seq).toBe(6);
  });

  it('aborts the previous request of the lane it issues on, and only that one', () => {
    const lanes = new MentionRequestLanes('session');
    const bare = lanes.issue('bare');
    const rows = lanes.issue('rows');
    const first = lanes.issue('primary');

    first.settle();
    const second = lanes.issue('primary');

    // Even an answer that already arrived is no longer current once a newer request replaced it.
    expect(first.signal.aborted).toBe(true);
    expect(lanes.isCurrent(first)).toBe(false);
    expect(lanes.isCurrent(second)).toBe(true);
    expect([bare, rows].map((ticket) => [ticket.signal.aborted, lanes.isCurrent(ticket)])).toEqual([
      [false, true],
      [false, true],
    ]);
    expect([first.seq, second.seq]).toEqual([1, 2]);
  });

  it('aborts the typed lanes on a query change, leaving bare and refresh requests running', () => {
    const lanes = new MentionRequestLanes('session');
    const tickets = Object.fromEntries(ALL_LANES.map((lane) => [lane, lanes.issue(lane)]));

    lanes.abort(MENTION_TYPED_LANES);

    expect(Object.fromEntries(ALL_LANES.map((lane) => [lane, tickets[lane].signal.aborted]))).toEqual({
      bare: false,
      primary: true,
      rows: true,
      refresh: false,
      'refresh-rows': false,
    });
    expect(ALL_LANES.filter((lane) => lanes.isCurrent(tickets[lane]))).toEqual(['bare', 'refresh', 'refresh-rows']);
    expect(tickets.primary.deadlineExceeded()).toBe(false);
  });

  it.each([
    ['primary', MENTION_TYPED_DEADLINE_MS],
    ['rows', MENTION_TYPED_DEADLINE_MS],
    ['refresh', MENTION_TYPED_DEADLINE_MS],
    ['refresh-rows', MENTION_TYPED_DEADLINE_MS],
    ['bare', MENTION_BARE_DEADLINE_MS],
  ] as const)('aborts a pending %s request at its %i ms deadline', (lane, deadlineMs) => {
    const lanes = new MentionRequestLanes('session');
    const ticket = lanes.issue(lane);

    jest.advanceTimersByTime(deadlineMs - 1);
    expect(ticket.signal.aborted).toBe(false);
    expect(ticket.deadlineExceeded()).toBe(false);

    jest.advanceTimersByTime(1);
    expect(ticket.signal.aborted).toBe(true);
    expect(ticket.deadlineExceeded()).toBe(true);
    expect(lanes.isCurrent(ticket)).toBe(false);
  });

  it('stops the deadline once a request settles or is aborted', () => {
    const lanes = new MentionRequestLanes('session');
    const settled = lanes.issue('primary');
    const aborted = lanes.issue('bare');

    expect(jest.getTimerCount()).toBe(2);
    settled.settle();
    lanes.abort(['bare']);
    expect(jest.getTimerCount()).toBe(0);

    jest.advanceTimersByTime(MENTION_BARE_DEADLINE_MS);
    expect(settled.signal.aborted).toBe(false);
    expect(settled.deadlineExceeded()).toBe(false);
    expect(lanes.isCurrent(settled)).toBe(true);
    expect(aborted.deadlineExceeded()).toBe(false);
  });

  describe('request counts for the session report', () => {
    it('counts every request the session issued, on every lane', () => {
      const lanes = new MentionRequestLanes('session');

      expect(lanes.requestCounts()).toEqual({ sent: 0, aborted: 0 });
      ALL_LANES.forEach((lane) => lanes.issue(lane).settle());
      lanes.issue('primary');
      expect(lanes.requestCounts()).toEqual({ sent: ALL_LANES.length + 1, aborted: 0 });
    });

    it('counts a pending request a newer one replaced on its lane, or the panel aborted', () => {
      const lanes = new MentionRequestLanes('session');

      lanes.issue('primary');
      lanes.issue('rows');
      // A keystroke: the new pair replaces the pending one.
      lanes.issue('primary');
      lanes.issue('rows');
      expect(lanes.requestCounts()).toEqual({ sent: 4, aborted: 2 });

      // The query changes again, or the panel closes: the typed lanes are stopped.
      lanes.abort(MENTION_TYPED_LANES);
      expect(lanes.requestCounts()).toEqual({ sent: 4, aborted: 4 });
    });

    it('counts a request its deadline aborted, once', () => {
      const lanes = new MentionRequestLanes('session');
      const ticket = lanes.issue('bare');

      jest.advanceTimersByTime(MENTION_BARE_DEADLINE_MS);
      expect(ticket.deadlineExceeded()).toBe(true);
      expect(lanes.requestCounts()).toEqual({ sent: 1, aborted: 1 });

      // Replacing or stopping the already aborted request counts nothing more.
      lanes.abort(['bare']);
      lanes.issue('bare');
      expect(lanes.requestCounts()).toEqual({ sent: 2, aborted: 1 });
    });

    it('does not count a request that settled before it was replaced or stopped', () => {
      const lanes = new MentionRequestLanes('session');

      lanes.issue('primary').settle();
      lanes.issue('primary').settle();
      lanes.issue('rows').settle();
      lanes.abort(MENTION_TYPED_LANES);
      expect(lanes.requestCounts()).toEqual({ sent: 3, aborted: 0 });
    });

    it('counts each session on its own', () => {
      const first = new MentionRequestLanes('first');
      const second = new MentionRequestLanes('second');

      first.issue('primary');
      first.abort(['primary']);
      second.issue('primary');
      expect([first.requestCounts(), second.requestCounts()]).toEqual([
        { sent: 1, aborted: 1 },
        { sent: 1, aborted: 0 },
      ]);
    });
  });

  it('passes the stream, the request time and the signal as transport options', () => {
    const lanes = new MentionRequestLanes('session', () => 42);
    const ticket = lanes.issue('rows');

    expect(mentionTicketOptions(ticket)).toEqual({
      signal: ticket.signal,
      streamId: 'web-mention-session-rows',
      requestTime: 42,
    });
  });
});

describe('mentionRequestLane', () => {
  const [primary, rows] = buildMentionSearchRequests({
    query: 'road',
    include: [MentionTargetKind.Page, MentionTargetKind.DatabaseRow],
  });

  it('sends an empty query on the bare lane, also when it refreshes a cached answer', () => {
    for (const query of [undefined, '', '   ']) {
      expect(mentionRequestLane({ query, include: [MentionTargetKind.Page] }, false)).toBe('bare');
      expect(mentionRequestLane({ query, include: [MentionTargetKind.Page] }, true)).toBe('bare');
    }
  });

  it('sends a typed query on the primary and rows lanes, and its refresh on the refresh lanes', () => {
    expect([mentionRequestLane(primary, false), mentionRequestLane(rows, false)]).toEqual(['primary', 'rows']);
    expect([mentionRequestLane(primary, true), mentionRequestLane(rows, true)]).toEqual(['refresh', 'refresh-rows']);
  });
});

describe('mentionTicketFailure', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const networkError = { code: -1, message: 'Network Error', sourceDomain: 'transport', transportFailure: 'network' };

  it('keeps the error of a request that was neither aborted nor late', () => {
    const ticket = new MentionRequestLanes('session').issue('primary');

    expect(mentionTicketFailure(ticket, networkError)).toBe(networkError);
    expect(isMentionSearchCancelled(networkError)).toBe(false);
  });

  it('reports a request the panel aborted as cancelled', () => {
    const lanes = new MentionRequestLanes('session');
    const ticket = lanes.issue('primary');

    lanes.abort(['primary']);
    const failure = mentionTicketFailure(ticket, networkError);

    expect(failure).toMatchObject({ code: -1, sourceDomain: 'transport', transportFailure: 'cancelled' });
    expect(isMentionSearchCancelled(failure)).toBe(true);
  });

  it('reports a request its deadline aborted as a timeout', () => {
    const ticket = new MentionRequestLanes('session').issue('bare');

    jest.advanceTimersByTime(MENTION_BARE_DEADLINE_MS);
    const failure = mentionTicketFailure(ticket, { transportFailure: 'cancelled' });

    expect(failure).toMatchObject({ code: -1, sourceDomain: 'transport', transportFailure: 'timeout' });
    expect(isMentionSearchCancelled(failure)).toBe(false);
  });

  it('recognizes only cancellations', () => {
    expect(
      [undefined, null, 'cancelled', new Error('cancelled'), { transportFailure: 'timeout' }].map(
        isMentionSearchCancelled
      )
    ).toEqual([false, false, false, false, false]);
  });
});
