import axios from 'axios';

import { getAxios, handleAPIError, handleAPIResponseError } from './core';
import { SearchStreamDecoder, SEARCH_STREAM_TIMEOUT_MS } from './search-stream-protocol';

import type { SearchStreamDone, SearchStreamSnapshot } from './search-stream-protocol';

export type { SearchStreamSnapshot } from './search-stream-protocol';

const MAX_ERROR_BODY_BYTES = 64 * 1024;
const UNSUPPORTED_STATUSES = new Set([404, 405, 501]);

/** Only this error permits a caller to fall back to the legacy search endpoint. */
export class SearchStreamUnsupportedError extends Error {
  constructor() {
    super('Progressive search is unavailable');
    this.name = 'SearchStreamUnsupportedError';
  }
}

export interface SearchStreamOptions {
  signal?: AbortSignal;
  requestStreamId?: string;
  mode?: 'hybrid' | 'keyword';
  limit?: number;
  /** Synchronous notification; hydrate view metadata separately so the body keeps draining. */
  onSnapshot: (snapshot: SearchStreamSnapshot) => void;
}

/**
 * Display replacement snapshots immediately, then resolve only after a valid terminal event and EOF.
 * Never replays an interrupted search; authentication can recover once before an HTTP 401 body.
 */
export async function searchWorkspaceDocumentStream(
  workspaceId: string,
  query: string,
  options: SearchStreamOptions
): Promise<Pick<SearchStreamDone, 'outcome'>> {
  if (options.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  if (typeof fetch !== 'function' || typeof ReadableStream !== 'function' || typeof TextDecoder !== 'function') {
    throw new SearchStreamUnsupportedError();
  }

  const client = getAxios();

  if (!client) throw handleAPIError({ code: -1, sourceDomain: 'client', message: 'API service not initialized' });

  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timedOut = false;
  let finished = false;
  let rejectAbort: (error: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abortError = () =>
    timedOut
      ? handleAPIError({
          code: -1,
          sourceDomain: 'transport',
          transportFailure: 'timeout',
          message: 'Search stream timed out',
        })
      : new DOMException('The operation was aborted', 'AbortError');
  const cancelReader = () => {
    void reader?.cancel().catch(() => undefined);
  };

  const onAbort = () => {
    cancelReader();
    rejectAbort(abortError());
  };

  const onCallerAbort = () => controller.abort();

  controller.signal.addEventListener('abort', onAbort, { once: true });
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SEARCH_STREAM_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'x-request-time': Date.now().toString(),
    };

    if (options.requestStreamId) headers['x-request-stream-id'] = options.requestStreamId;
    const response = await Promise.race([
      client.get<ReadableStream<Uint8Array>>(`/api/search/${encodeURIComponent(workspaceId)}/stream`, {
        adapter: 'fetch',
        responseType: 'stream',
        signal: controller.signal,
        skipResponseCache: true,
        skipTransportRetry: true,
        // Keep the shared 401 refresh flow. Inspect every other status without automatic retries.
        validateStatus: (status) => status !== 401,
        params: {
          query,
          mode: options.mode ?? 'hybrid',
          limit: options.limit ?? 10,
          preview_size: 80,
          score: 0.2,
        },
        headers,
      }),
      aborted,
    ]);

    if (controller.signal.aborted) throw abortError();
    const contentType = String(response.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    // These statuses identify an older route before any result is accepted. No paid query is replayed.
    const jsonContentType = contentType === 'application/json' || contentType.endsWith('+json');

    if (UNSUPPORTED_STATUSES.has(response.status) && !jsonContentType) {
      void response.data?.cancel?.().catch(() => undefined);
      throw new SearchStreamUnsupportedError();
    }

    if (!response.data || typeof response.data.getReader !== 'function') {
      if (response.status !== 200) throw handleAPIResponseError({ ...response, data: undefined });
      throw new Error('Search stream response has no readable body');
    }

    reader = response.data.getReader();
    const next = () => Promise.race([reader!.read(), aborted]);

    if (response.status !== 200 || contentType !== 'text/event-stream') {
      const payload = await readErrorBody(next, jsonContentType);

      if (
        UNSUPPORTED_STATUSES.has(response.status) &&
        !(payload && typeof payload.code === 'number' && payload.code !== 0)
      ) {
        throw new SearchStreamUnsupportedError();
      }

      if (response.status === 200 && (!payload || typeof payload.code !== 'number' || payload.code === 0)) {
        throw new Error('Search stream response has an invalid content type');
      }

      throw handleAPIResponseError({ ...response, data: payload });
    }

    const decoder = new SearchStreamDecoder();

    for (;;) {
      const { done, value } = await next();

      if (controller.signal.aborted) throw abortError();
      if (done) break;
      decoder.push(value, (snapshot) => {
        if (snapshot.items.some((item) => item.workspace_id.toLowerCase() !== workspaceId.toLowerCase())) {
          throw new Error('Search stream contains results from a different workspace');
        }

        options.onSnapshot(snapshot);
      });
    }

    const terminal = decoder.finish();

    finished = true;
    if (terminal.type === 'error') throw handleAPIResponseError({ ...response, data: terminal.error });
    return { outcome: terminal.outcome };
  } catch (error) {
    if (controller.signal.aborted) throw abortError();
    if (error instanceof SearchStreamUnsupportedError) throw error;
    // Axios knows the network/HTTP identity; protocol failures belong to the client decoder.
    if (axios.isAxiosError(error) || (typeof error === 'object' && error !== null && 'code' in error)) {
      throw handleAPIError(error);
    }

    throw handleAPIError({
      code: -1,
      sourceDomain: 'client',
      message: error instanceof Error ? error.message : 'Search stream was interrupted',
    });
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', onCallerAbort);
    controller.signal.removeEventListener('abort', onAbort);
    if (!finished) {
      cancelReader();
      controller.abort();
    }

    reader?.releaseLock();
  }
}

async function readErrorBody(
  next: () => Promise<ReadableStreamReadResult<Uint8Array>>,
  expectJson: boolean
): Promise<Record<string, unknown> | undefined> {
  const chunks: Uint8Array[] = [];
  let length = 0;

  for (;;) {
    const { done, value } = await next();

    if (done) break;
    length += value.byteLength;
    if (length > MAX_ERROR_BODY_BYTES) throw new Error('Search error response exceeds its byte limit');
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

    if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  } catch {
    // A malformed declared JSON response must never trigger a legacy replay.
  }

  if (expectJson) throw new Error('Search error response contains invalid JSON');
  return undefined;
}
