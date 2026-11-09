import type { APIError } from '@/application/services/js-services/http/core';
import { MentionSearchRequest, MentionSearchResponse, MentionSearchSection, SearchMentions } from '@/application/types';

import {
  isMentionSearchCancelled,
  MentionRequestTicket,
  mentionTicketFailure,
  mentionTicketOptions,
} from './mentionRequestLanes';
import { isMentionSearchRetryLater, markMentionSearchRetryLater } from './mentionSearchCache';
import {
  isCompleteMentionResponse,
  isDatabaseRowOnlyMentionRequest,
  mergeMentionSearchResponses,
  shouldRetryMentionRowsResponse,
} from './mentionUtils';

const DATABASE_ROW_SEARCH_RETRY_DELAY_MS = 500;

/**
 * How one request of a search ended:
 * - `ok`: answered. The answer can still report a failed section.
 * - `failed`: rejected, by an error status or a network failure while online.
 * - `timeout`: its deadline aborted it.
 * - `offline`: its transport failed while the browser was offline.
 * - `retry_later`: the server asked to retry later (RetryLater).
 * - `cancelled`: the panel aborted it, so nobody uses its answer.
 */
export type MentionLaneStatus = 'ok' | 'failed' | 'timeout' | 'offline' | 'retry_later' | 'cancelled';

export interface MentionLaneOutcome {
  request: MentionSearchRequest;
  status: MentionLaneStatus;
  /** The answer, when `status` is `ok`. */
  response?: MentionSearchResponse;
  /** Why the request did not answer, when `status` is not `ok`. */
  error?: unknown;
  ticket?: MentionRequestTicket;
}

/**
 * How a search's answer may be used:
 * - `complete`: every request answered, without a failed section or a superseded answer. Only a
 *   complete answer is cached.
 * - `unavailable`: some suggestions are missing: a request failed or timed out, a section failed,
 *   or an answer was superseded.
 * - `busy`: the server asked to send the primary (or empty-query) request again later.
 * - `offline`: a request could not reach the server because the browser is offline.
 */
export type MentionAnswerState = 'complete' | 'unavailable' | 'busy' | 'offline';

export interface MentionSectionsFetchResult {
  /** The merged sections of every request that answered. */
  sections: MentionSearchSection[];
  /** The final outcome of each request, in request order. A rows retry replaces the first rows outcome. */
  outcomes: MentionLaneOutcome[];
  /**
   * The tickets of the answers that make up `sections`. A rows ticket that this fetch's own retry
   * replaced is not among them. Cache the sections only while all of them are current.
   */
  tickets: MentionRequestTicket[];
  state: MentionAnswerState;
}

export interface FetchMentionSectionsOptions {
  searchMentions: SearchMentions;
  requests: MentionSearchRequest[];
  cacheKey: string;
  isCurrent: () => boolean;
  /**
   * Issues the ticket that each request, including the rows retry, is sent on: its stream, request
   * time, abort signal and deadline. Without it, requests are sent without them.
   */
  issueTicket?: (request: MentionSearchRequest) => MentionRequestTicket;
  // Receives merged sections while the database-row search or its retry is still pending. The
  // final sections are only returned, so callers decide whether to cache them.
  onSections?: (sections: MentionSearchSection[]) => void;
}

type DeliverSections = (responses: MentionSearchResponse[]) => void;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Classifies why a request did not answer. Deadline and panel aborts arrive already classified. */
export function mentionLaneFailureStatus(error: unknown): Exclude<MentionLaneStatus, 'ok'> {
  if (isMentionSearchCancelled(error)) return 'cancelled';
  if (isMentionSearchRetryLater(error)) return 'retry_later';

  const transportFailure =
    typeof error === 'object' && error !== null ? (error as APIError).transportFailure : undefined;

  if ((transportFailure === 'network' || transportFailure === 'timeout') && isBrowserOffline()) return 'offline';
  if (transportFailure === 'timeout') return 'timeout';
  return 'failed';
}

function answeredResponses(outcomes: MentionLaneOutcome[]) {
  return outcomes.flatMap(({ status, response }) => (status === 'ok' && response ? [response] : []));
}

function isCompleteOutcome({ status, request, response }: MentionLaneOutcome) {
  return status === 'ok' && response !== undefined && isCompleteMentionResponse(request, response);
}

/** How the panel shows an answer made of `outcomes`; see {@link MentionAnswerState}. */
export function mentionAnswerState(outcomes: MentionLaneOutcome[]): MentionAnswerState {
  // Only the primary request carries people, whose roster single-flight answers RetryLater. A rows
  // request asked to wait is an unavailable lane, while the primary results stay on screen.
  if (outcomes.some(({ status, request }) => status === 'retry_later' && !isDatabaseRowOnlyMentionRequest(request))) {
    return 'busy';
  }

  if (outcomes.some(({ status }) => status === 'offline')) return 'offline';
  return outcomes.every(isCompleteOutcome) ? 'complete' : 'unavailable';
}

/** A request never rejects: its failure is part of its outcome. */
async function sendMentionSearch(
  { searchMentions, issueTicket }: FetchMentionSectionsOptions,
  request: MentionSearchRequest
): Promise<MentionLaneOutcome> {
  const ticket = issueTicket?.(request);

  try {
    const response = await (ticket ? searchMentions(request, mentionTicketOptions(ticket)) : searchMentions(request));

    return { request, status: 'ok', response, ticket };
  } catch (error) {
    const failure = ticket ? mentionTicketFailure(ticket, error) : error;

    return { request, status: mentionLaneFailureStatus(failure), error: failure, ticket };
  } finally {
    ticket?.settle();
  }
}

/** Logs a failed request and starts the cooldown of one that the server asked to wait. */
function reportMentionLaneFailure(cacheKey: string, { status, error }: MentionLaneOutcome) {
  if (status === 'ok' || status === 'cancelled') return;

  if (status === 'retry_later') {
    markMentionSearchRetryLater(cacheKey, error as APIError);
    return;
  }

  console.error(error);
}

function createSectionsDelivery({ isCurrent, onSections }: FetchMentionSectionsOptions): DeliverSections {
  let deliveredResponseCount = 0;

  return (responses) => {
    if (!onSections || responses.length <= deliveredResponseCount || !isCurrent()) return;

    deliveredResponseCount = responses.length;
    onSections(mergeMentionSearchResponses(responses).sections ?? []);
  };
}

// Once the row search has settled, the merged result follows in the same pass, so showing the
// primary sections alone would only flash an incomplete list.
function deliverPrimaryBeforeRows(
  requests: MentionSearchRequest[],
  pendingOutcomes: Promise<MentionLaneOutcome>[],
  deliver: DeliverSections
) {
  const rowIndex = requests.findIndex(isDatabaseRowOnlyMentionRequest);

  if (rowIndex === -1) return;

  let rowSearchSettled = false;
  const markRowSearchSettled = () => {
    rowSearchSettled = true;
  };

  pendingOutcomes[rowIndex].then(markRowSearchSettled, markRowSearchSettled);
  Promise.all(pendingOutcomes.filter((_, index) => index !== rowIndex)).then(
    (primaryOutcomes) => {
      // A failed primary request has nothing to show early. The final answer reports it.
      if (rowSearchSettled || primaryOutcomes.some(({ status }) => status !== 'ok')) return;

      deliver(answeredResponses(primaryOutcomes));
    },
    () => undefined
  );
}

function mentionFetchResult(outcomes: MentionLaneOutcome[]): MentionSectionsFetchResult {
  return {
    sections: mergeMentionSearchResponses(answeredResponses(outcomes)).sections ?? [],
    outcomes,
    tickets: outcomes.flatMap(({ status, ticket }) => (status === 'ok' && ticket ? [ticket] : [])),
    state: mentionAnswerState(outcomes),
  };
}

/**
 * Sends the requests of one search concurrently and merges what they answer. A request that fails
 * leaves the others' sections in the answer, and the answer's `state` says what is missing. The
 * rows-only request is sent once more, 500 ms later, only when its answer reports a retryable
 * failed section or was superseded; an error, a timeout or a path-shed `partial` never retries it.
 */
export async function fetchMentionSearchSections(
  options: FetchMentionSectionsOptions
): Promise<MentionSectionsFetchResult> {
  const { requests, cacheKey, isCurrent } = options;
  const deliver = createSectionsDelivery(options);
  // Every request is issued in this tick, each on its own ticket.
  const pendingOutcomes = requests.map((request) => sendMentionSearch(options, request));

  deliverPrimaryBeforeRows(requests, pendingOutcomes, deliver);

  const outcomes = await Promise.all(pendingOutcomes);

  outcomes.forEach((outcome) => reportMentionLaneFailure(cacheKey, outcome));

  const rowIndex = requests.findIndex(isDatabaseRowOnlyMentionRequest);
  const rowOutcome = rowIndex === -1 ? undefined : outcomes[rowIndex];

  if (!rowOutcome?.response || !shouldRetryMentionRowsResponse(rowOutcome.request, rowOutcome.response)) {
    return mentionFetchResult(outcomes);
  }

  deliver(answeredResponses(outcomes));
  await delay(DATABASE_ROW_SEARCH_RETRY_DELAY_MS);

  if (!isCurrent()) return mentionFetchResult(outcomes);

  // The retry replaces the first rows request on its lane, so its outcome replaces the first one.
  const rowRetry = await sendMentionSearch(options, rowOutcome.request);

  reportMentionLaneFailure(cacheKey, rowRetry);
  return mentionFetchResult(outcomes.map((outcome, index) => (index === rowIndex ? rowRetry : outcome)));
}
