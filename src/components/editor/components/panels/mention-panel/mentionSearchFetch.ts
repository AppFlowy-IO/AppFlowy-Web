import { MentionSearchRequest, MentionSearchResponse, MentionSearchSection, SearchMentions } from '@/application/types';

import {
  isMentionSearchCancelled,
  MentionRequestTicket,
  mentionTicketFailure,
  mentionTicketOptions,
} from './mentionRequestLanes';
import { isMentionSearchRetryLater, markMentionSearchRetryLater } from './mentionSearchCache';
import {
  isDatabaseRowOnlyMentionRequest,
  mergeMentionSearchResponses,
  shouldCacheMentionSearchSections,
} from './mentionUtils';

const DATABASE_ROW_SEARCH_RETRY_DELAY_MS = 500;

export interface MentionSectionsFetchResult {
  sections: MentionSearchSection[];
  databaseRowResponse?: MentionSearchResponse;
  /**
   * The tickets of the responses that make up `sections`, except a rows ticket that this fetch's
   * own retry replaced. Cache the sections only while all of them are current.
   */
  tickets: MentionRequestTicket[];
}

export interface FetchMentionSectionsOptions {
  searchMentions: SearchMentions;
  requests: MentionSearchRequest[];
  cacheKey: string;
  hasQuery: boolean;
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

interface SearchedMentions {
  request: MentionSearchRequest;
  response: MentionSearchResponse;
  ticket?: MentionRequestTicket;
}

type DeliverSections = (responses: MentionSearchResponse[]) => void;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function ticketsOf(searched: SearchedMentions[]) {
  return searched.flatMap(({ ticket }) => (ticket ? [ticket] : []));
}

async function sendMentionSearch(
  { searchMentions, issueTicket }: FetchMentionSectionsOptions,
  request: MentionSearchRequest
): Promise<SearchedMentions> {
  const ticket = issueTicket?.(request);

  if (!ticket) return { request, response: await searchMentions(request) };

  try {
    return { request, response: await searchMentions(request, mentionTicketOptions(ticket)), ticket };
  } catch (error) {
    throw mentionTicketFailure(ticket, error);
  } finally {
    ticket.settle();
  }
}

function reportDatabaseRowSearchError(cacheKey: string, error: unknown) {
  if (isMentionSearchCancelled(error)) return;

  if (isMentionSearchRetryLater(error)) {
    markMentionSearchRetryLater(cacheKey, error);
  } else {
    console.error(error);
  }
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
  pendingResponses: Promise<SearchedMentions>[],
  deliver: DeliverSections
) {
  const rowIndex = requests.findIndex(isDatabaseRowOnlyMentionRequest);

  if (rowIndex === -1) return;

  let rowSearchSettled = false;
  const markRowSearchSettled = () => {
    rowSearchSettled = true;
  };

  pendingResponses[rowIndex].then(markRowSearchSettled, markRowSearchSettled);
  Promise.all(pendingResponses.filter((_, index) => index !== rowIndex)).then(
    (primaryResponses) => {
      if (!rowSearchSettled) deliver(primaryResponses.map(({ response }) => response));
    },
    // A primary failure is still reported as a blocking error once every request settles.
    () => undefined
  );
}

function collectSettledResponses(
  requests: MentionSearchRequest[],
  settledResponses: PromiseSettledResult<SearchedMentions>[],
  cacheKey: string
) {
  const fulfilledResponses: SearchedMentions[] = [];
  let databaseRowResponse: MentionSearchResponse | undefined;
  let blockingError: unknown;

  settledResponses.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      fulfilledResponses.push(result.value);

      if (isDatabaseRowOnlyMentionRequest(result.value.request)) {
        databaseRowResponse = result.value.response;
      }

      return;
    }

    const request = requests[index];

    if (request && isDatabaseRowOnlyMentionRequest(request)) {
      reportDatabaseRowSearchError(cacheKey, result.reason);
      return;
    }

    blockingError = blockingError ?? result.reason;
  });

  return { fulfilledResponses, databaseRowResponse, blockingError };
}

async function retryDatabaseRowSearch(
  options: FetchMentionSectionsOptions,
  rowRequest: MentionSearchRequest,
  fulfilledResponses: SearchedMentions[],
  initialResult: MentionSectionsFetchResult
): Promise<MentionSectionsFetchResult> {
  const { cacheKey, isCurrent } = options;

  await delay(DATABASE_ROW_SEARCH_RETRY_DELAY_MS);

  if (!isCurrent()) {
    return initialResult;
  }

  const nonRowResponses = fulfilledResponses.filter(({ request }) => request !== rowRequest);

  try {
    const rowRetry = await sendMentionSearch(options, rowRequest);
    const searched = [...nonRowResponses, rowRetry];

    return {
      sections: mergeMentionSearchResponses(searched.map(({ response }) => response)).sections ?? [],
      databaseRowResponse: rowRetry.response,
      tickets: ticketsOf(searched),
    };
  } catch (error) {
    reportDatabaseRowSearchError(cacheKey, error);
    // The retry replaced the first rows request on its lane, which made that ticket stale. The
    // first answer is still this fetch's own, so its currency rests on the other requests.
    return { ...initialResult, tickets: ticketsOf(nonRowResponses) };
  }
}

export async function fetchMentionSearchSections(
  options: FetchMentionSectionsOptions
): Promise<MentionSectionsFetchResult> {
  const { requests, cacheKey, hasQuery } = options;
  const deliver = createSectionsDelivery(options);
  // Every request is issued in this tick, each on its own ticket.
  const pendingResponses = requests.map((request) => sendMentionSearch(options, request));

  deliverPrimaryBeforeRows(requests, pendingResponses, deliver);

  const { fulfilledResponses, databaseRowResponse, blockingError } = collectSettledResponses(
    requests,
    await Promise.allSettled(pendingResponses),
    cacheKey
  );

  if (blockingError) {
    throw blockingError;
  }

  const responses = fulfilledResponses.map(({ response }) => response);
  const initialResult = {
    sections: mergeMentionSearchResponses(responses).sections ?? [],
    databaseRowResponse,
    tickets: ticketsOf(fulfilledResponses),
  };
  const rowRequest = requests.find(isDatabaseRowOnlyMentionRequest);

  if (!rowRequest || shouldCacheMentionSearchSections(requests, databaseRowResponse, hasQuery)) {
    return initialResult;
  }

  deliver(responses);
  return retryDatabaseRowSearch(options, rowRequest, fulfilledResponses, initialResult);
}
