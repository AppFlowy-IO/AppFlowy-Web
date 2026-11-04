import type { APIResponse } from './core';
import type { SearchDocumentResponseItem } from './misc-api';

export const SEARCH_STREAM_MAX_EVENT_BYTES = 8 * 1024 * 1024;
export const SEARCH_STREAM_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
export const SEARCH_STREAM_TIMEOUT_MS = 30_000;

export interface SearchStreamSnapshot {
  type: 'snapshot';
  query_id: string;
  sequence: number;
  phase: 'keyword' | 'final';
  /** Replace the previous ranked list with this complete snapshot. */
  items: SearchDocumentResponseItem[];
}

export interface SearchStreamDone {
  type: 'done';
  query_id: string;
  sequence: number;
  outcome: 'complete' | 'degraded' | 'superseded';
}

interface SearchStreamError {
  type: 'error';
  query_id: string;
  sequence: number;
  error: APIResponse;
}

type SearchStreamEvent = SearchStreamSnapshot | SearchStreamDone | SearchStreamError;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function invalidProtocol(message: string): never {
  // Never include a server frame, query, or JSON parsing diagnostics in a public error.
  throw new Error(`Search stream ${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function validItem(value: unknown): value is SearchDocumentResponseItem {
  return (
    record(value) &&
    typeof value.object_id === 'string' &&
    typeof value.workspace_id === 'string' &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    typeof value.content === 'string' &&
    nullableString(value.preview) &&
    nullableString(value.database_view_id) &&
    nullableString(value.database_id) &&
    nullableString(value.database_row_id)
  );
}

function parseFrame(bytes: Uint8Array): SearchStreamEvent | undefined {
  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalidProtocol('contains invalid UTF-8');
  }

  let name: string | undefined;
  const data: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const rawValue = colon < 0 ? '' : line.slice(colon + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') {
      if (name !== undefined) invalidProtocol('contains an invalid event frame');
      name = value;
    } else if (field === 'data') data.push(value);
    // Ignore SSE metadata and comments. They never enable replay or change query identity.
  }

  if (data.length === 0) return undefined;
  let value: unknown;

  try {
    value = JSON.parse(data.join('\n'));
  } catch {
    return invalidProtocol('contains invalid event JSON');
  }

  if (
    !record(value) ||
    !['snapshot', 'done', 'error'].includes(String(value.type)) ||
    name !== value.type ||
    typeof value.query_id !== 'string' ||
    !UUID_PATTERN.test(value.query_id) ||
    typeof value.sequence !== 'number' ||
    !Number.isInteger(value.sequence) ||
    value.sequence < 0 ||
    value.sequence > 0xffffffff
  )
    invalidProtocol('contains an invalid event frame');

  if (value.type === 'snapshot') {
    if (
      !['keyword', 'final'].includes(String(value.phase)) ||
      !Array.isArray(value.items) ||
      !value.items.every(validItem)
    )
      invalidProtocol('contains an invalid snapshot');
  } else if (value.type === 'done') {
    if (!['complete', 'degraded', 'superseded'].includes(String(value.outcome))) {
      invalidProtocol('contains an invalid completion');
    }
  } else if (
    !record(value.error) ||
    typeof value.error.code !== 'number' ||
    !Number.isInteger(value.error.code) ||
    value.error.code === 0 ||
    typeof value.error.message !== 'string'
  ) {
    invalidProtocol('contains an invalid error');
  }

  return value as unknown as SearchStreamEvent;
}

/** Bounded byte framing keeps split UTF-8 safe and validates the full response before completion. */
export class SearchStreamDecoder {
  private frame = new Uint8Array(1024);
  private length = 0;
  private lineStart = 0;
  private totalBytes = 0;
  private queryId?: string;
  private nextSequence = 0;
  private phase: 'start' | 'keyword' | 'final' | 'terminal' = 'start';
  private terminal?: SearchStreamDone | SearchStreamError;

  push(chunk: Uint8Array, onSnapshot: (snapshot: SearchStreamSnapshot) => void): void {
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > SEARCH_STREAM_MAX_TOTAL_BYTES) invalidProtocol('exceeds its total byte limit');

    let offset = 0;

    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.byteLength : newline + 1;
      const part = chunk.subarray(offset, end);

      if (part.byteLength > SEARCH_STREAM_MAX_EVENT_BYTES - this.length) {
        invalidProtocol('event exceeds its byte limit');
      }

      const required = this.length + part.byteLength;

      if (required > this.frame.byteLength) {
        const grown = new Uint8Array(Math.min(SEARCH_STREAM_MAX_EVENT_BYTES, Math.max(required, this.frame.length * 2)));

        grown.set(this.frame.subarray(0, this.length));
        this.frame = grown;
      }

      this.frame.set(part, this.length);
      this.length = required;
      offset = end;
      if (newline < 0) break;
      const lineLength = this.length - this.lineStart;
      const blank = lineLength === 1 || (lineLength === 2 && this.frame[this.length - 2] === 13);

      this.lineStart = this.length;
      if (!blank) continue;
      const event = parseFrame(this.frame.subarray(0, this.length));

      this.length = 0;
      this.lineStart = 0;
      if (event) {
        this.accept(event);
        if (event.type === 'snapshot') onSnapshot(event);
      }
    }
  }

  finish(): SearchStreamDone | SearchStreamError {
    if (this.length !== 0) invalidProtocol('ended in an incomplete event frame');
    if (!this.terminal) invalidProtocol('ended without a terminal event');
    return this.terminal;
  }

  private accept(event: SearchStreamEvent): void {
    if (this.phase === 'terminal') invalidProtocol('contains an event after termination');
    if (this.queryId !== undefined && event.query_id.toLowerCase() !== this.queryId) {
      invalidProtocol('query identity changed');
    }

    if (event.sequence !== this.nextSequence) invalidProtocol('event sequence is invalid');

    if (event.type === 'snapshot') {
      if (
        (event.phase === 'keyword' && this.phase !== 'start') ||
        (event.phase === 'final' && this.phase !== 'start' && this.phase !== 'keyword')
      ) {
        invalidProtocol('event order is invalid');
      }

      this.phase = event.phase;
    } else {
      if (event.type === 'done' && event.outcome !== 'superseded' && this.phase !== 'final') {
        invalidProtocol('event order is invalid');
      }

      this.phase = 'terminal';
      this.terminal = event;
    }

    this.queryId = event.query_id.toLowerCase();
    this.nextSequence++;
  }
}
