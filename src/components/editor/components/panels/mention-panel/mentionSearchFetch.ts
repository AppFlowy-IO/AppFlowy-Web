import {
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchSection,
  MentionTargetKind,
  SearchMentions,
} from '@/application/types';

import { isMentionSearchRetryLater, markMentionSearchRetryLater } from './mentionSearchCache';
import { mergeMentionSearchResponses, shouldCacheMentionSearchSections } from './mentionUtils';

const DATABASE_ROW_SEARCH_RETRY_DELAY_MS = 500;

export interface MentionSectionsFetchResult {
  sections: MentionSearchSection[];
  databaseRowResponse?: MentionSearchResponse;
}

export interface FetchMentionSectionsOptions {
  searchMentions: SearchMentions;
  requests: MentionSearchRequest[];
  cacheKey: string;
  hasQuery: boolean;
  isCurrent: () => boolean;
  // Receives merged sections while the database-row search or its retry is still pending. The
  // final sections are only returned, so callers decide whether to cache them.
  onSections?: (sections: MentionSearchSection[]) => void;
}

interface SearchedMentions {
  request: MentionSearchRequest;
  response: MentionSearchResponse;
}

type DeliverSections = (responses: MentionSearchResponse[]) => void;

function isDatabaseRowOnlyRequest(request: MentionSearchRequest) {
  const include = request.include ?? [];

  return include.length === 1 && include[0] === MentionTargetKind.DatabaseRow;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function reportDatabaseRowSearchError(cacheKey: string, error: unknown) {
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
  const rowIndex = requests.findIndex(isDatabaseRowOnlyRequest);

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

      if (isDatabaseRowOnlyRequest(result.value.request)) {
        databaseRowResponse = result.value.response;
      }

      return;
    }

    const request = requests[index];

    if (request && isDatabaseRowOnlyRequest(request)) {
      reportDatabaseRowSearchError(cacheKey, result.reason);
      return;
    }

    blockingError = blockingError ?? result.reason;
  });

  return { fulfilledResponses, databaseRowResponse, blockingError };
}

async function retryDatabaseRowSearch(
  { searchMentions, cacheKey, isCurrent }: FetchMentionSectionsOptions,
  rowRequest: MentionSearchRequest,
  fulfilledResponses: SearchedMentions[],
  initialResult: MentionSectionsFetchResult
): Promise<MentionSectionsFetchResult> {
  await delay(DATABASE_ROW_SEARCH_RETRY_DELAY_MS);

  if (!isCurrent()) {
    return initialResult;
  }

  try {
    const rowRetryResponse = await searchMentions(rowRequest);
    const nonRowResponses = fulfilledResponses
      .filter(({ request }) => request !== rowRequest)
      .map(({ response }) => response);

    return {
      sections: mergeMentionSearchResponses([...nonRowResponses, rowRetryResponse]).sections ?? [],
      databaseRowResponse: rowRetryResponse,
    };
  } catch (error) {
    reportDatabaseRowSearchError(cacheKey, error);
    return initialResult;
  }
}

export async function fetchMentionSearchSections(
  options: FetchMentionSectionsOptions
): Promise<MentionSectionsFetchResult> {
  const { searchMentions, requests, cacheKey, hasQuery } = options;
  const deliver = createSectionsDelivery(options);
  const pendingResponses = requests.map(async (request) => ({
    request,
    response: await searchMentions(request),
  }));

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
  const initialResult = { sections: mergeMentionSearchResponses(responses).sections ?? [], databaseRowResponse };
  const rowRequest = requests.find(isDatabaseRowOnlyRequest);

  if (!rowRequest || shouldCacheMentionSearchSections(requests, databaseRowResponse, hasQuery)) {
    return initialResult;
  }

  deliver(responses);
  return retryDatabaseRowSearch(options, rowRequest, fulfilledResponses, initialResult);
}
