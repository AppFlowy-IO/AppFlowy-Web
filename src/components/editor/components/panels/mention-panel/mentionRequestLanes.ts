import { v4 as uuidv4 } from 'uuid';

import type { APIError } from '@/application/services/js-services/http/core';
import { MentionSearchOptions, MentionSearchRequest } from '@/application/types';

import { isDatabaseRowOnlyMentionRequest } from './mentionUtils';

/**
 * A request lane of one mention-panel session. Each lane is its own Search supersession stream,
 * `web-mention-<sessionId>-<lane>`, so requests on different lanes never cancel each other.
 *
 * - `bare`: the empty query. Typing does not abort it, so its complete answer is still cached.
 * - `primary` and `rows`: a typed query, sent as two concurrent requests, the second one for
 *   database rows only.
 * - `refresh` and `refresh-rows`: the background revalidation of a cached typed query.
 */
export type MentionLane = 'bare' | 'primary' | 'rows' | 'refresh' | 'refresh-rows';

/**
 * The lanes of a typed search. Closing the panel or unmounting it aborts the typed search in flight;
 * a query change does too under the legacy scheduler (see `mentionSearchScheduler.ts`).
 */
export const MENTION_TYPED_LANES: readonly MentionLane[] = ['primary', 'rows'];

/** A typed request still pending after this long is aborted and fails. */
export const MENTION_TYPED_DEADLINE_MS = 2_500;
/** An empty-query request still pending after this long is aborted and fails. */
export const MENTION_BARE_DEADLINE_MS = 5_000;

/** One request issued on a lane. */
export interface MentionRequestTicket {
  readonly lane: MentionLane;
  /** The request's position on its lane, counted from 1. */
  readonly seq: number;
  readonly streamId: string;
  /** Epoch milliseconds, strictly increasing within the lane. */
  readonly requestTime: number;
  readonly signal: AbortSignal;
  /** Whether the deadline aborted the request. */
  deadlineExceeded(): boolean;
  /** Stops the deadline once the request has settled. */
  settle(): void;
  /**
   * Aborts the request, so its answer is never used, even once it arrived. Only a request still
   * pending counts as aborted.
   */
  abort(): void;
}

/** How many requests a session sent, and how many of those it aborted while they were pending. */
export interface MentionRequestCounts {
  sent: number;
  aborted: number;
}

class LaneTicket implements MentionRequestTicket {
  readonly lane: MentionLane;
  readonly seq: number;
  readonly streamId: string;
  readonly requestTime: number;
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly onAbortWhilePending: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private exceeded = false;
  private settled = false;

  constructor(
    lane: MentionLane,
    seq: number,
    streamId: string,
    requestTime: number,
    deadlineMs: number,
    onAbortWhilePending: () => void
  ) {
    this.lane = lane;
    this.seq = seq;
    this.streamId = streamId;
    this.requestTime = requestTime;
    this.signal = this.controller.signal;
    this.onAbortWhilePending = onAbortWhilePending;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.exceeded = true;
      this.abortRequest();
    }, deadlineMs);
  }

  deadlineExceeded() {
    return this.exceeded;
  }

  settle() {
    this.settled = true;
    this.stopDeadline();
  }

  abort() {
    this.stopDeadline();
    this.abortRequest();
  }

  private stopDeadline() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  // Aborting a request that already settled changes nothing, so only a pending one counts.
  private abortRequest() {
    if (!this.settled && !this.signal.aborted) this.onAbortWhilePending();
    this.controller.abort();
  }
}

/**
 * The request lanes of one mention-panel session: a new instance, with a new session id, for each
 * time the panel opens. Each lane keeps a sequence number, and only its newest request is current.
 */
export class MentionRequestLanes {
  readonly sessionId: string;
  private readonly now: () => number;
  private readonly newest = new Map<MentionLane, LaneTicket>();
  private sent = 0;
  private aborted = 0;

  constructor(sessionId: string = uuidv4(), now: () => number = () => Date.now()) {
    this.sessionId = sessionId;
    this.now = now;
  }

  /** Issues the next request of `lane` and aborts the lane's previous one. */
  issue(lane: MentionLane): MentionRequestTicket {
    const previous = this.newest.get(lane);

    previous?.abort();

    const ticket = new LaneTicket(
      lane,
      (previous?.seq ?? 0) + 1,
      `web-mention-${this.sessionId}-${lane}`,
      // Search pre-cancels a request that is not newer than the one in flight on its stream, so two
      // requests issued within one millisecond still need different times.
      Math.max(Math.trunc(this.now()), (previous?.requestTime ?? 0) + 1),
      lane === 'bare' ? MENTION_BARE_DEADLINE_MS : MENTION_TYPED_DEADLINE_MS,
      () => {
        this.aborted += 1;
      }
    );

    this.sent += 1;
    this.newest.set(lane, ticket);
    return ticket;
  }

  /**
   * The requests this session issued, and those it aborted while they were pending: replaced by a
   * newer request on their lane, stopped by a query change or the panel closing, or past their
   * deadline. A session report counts them.
   */
  requestCounts(): MentionRequestCounts {
    return { sent: this.sent, aborted: this.aborted };
  }

  /** Whether `ticket` is its lane's newest request and was not aborted. Only such answers are cached. */
  isCurrent(ticket: MentionRequestTicket) {
    return this.newest.get(ticket.lane) === ticket && !ticket.signal.aborted;
  }

  /** Aborts the newest request of each lane, so that its answer is never used, even once it arrived. */
  abort(lanes: readonly MentionLane[]) {
    lanes.forEach((lane) => this.newest.get(lane)?.abort());
  }
}

/** The lane the panel sends `request` on; `refresh` marks the revalidation of a cached answer. */
export function mentionRequestLane(request: MentionSearchRequest, refresh: boolean): MentionLane {
  if (!request.query?.trim()) return 'bare';

  const rows = isDatabaseRowOnlyMentionRequest(request);

  if (refresh) return rows ? 'refresh-rows' : 'refresh';
  return rows ? 'rows' : 'primary';
}

/** The transport options that send a request on its ticket's stream. */
export function mentionTicketOptions(ticket: MentionRequestTicket): MentionSearchOptions {
  return { signal: ticket.signal, streamId: ticket.streamId, requestTime: ticket.requestTime };
}

function mentionTransportError(transportFailure: 'cancelled' | 'timeout', message: string): APIError {
  return { code: -1, message, sourceDomain: 'transport', transportFailure };
}

/**
 * The error a failed request reports: a `timeout` when its deadline aborted it, a `cancelled` one
 * when the panel aborted it, and otherwise `error` itself.
 */
export function mentionTicketFailure(ticket: MentionRequestTicket, error: unknown): unknown {
  if (ticket.deadlineExceeded()) {
    return mentionTransportError('timeout', `Mention search on the ${ticket.lane} lane exceeded its deadline`);
  }

  if (ticket.signal.aborted) return mentionTransportError('cancelled', 'Mention search was cancelled');

  return error;
}

/** Whether a mention search failed only because it was aborted. Such failures are not reported. */
export function isMentionSearchCancelled(error: unknown) {
  return typeof error === 'object' && error !== null && (error as APIError).transportFailure === 'cancelled';
}
