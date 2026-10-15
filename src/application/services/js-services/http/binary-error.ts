import type { AxiosResponse } from 'axios';

import { APIError, handleAPIError, handleAPIResponseError } from './core';

const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * Binary-only endpoints may return JSON errors under either 2xx or 4xx/5xx.
 * Keep their entire response identity, and never read successful binary data
 * or an unbounded error body merely to produce a display message.
 */
export async function readBinaryErrorResponse(
  response: Pick<AxiosResponse, 'data' | 'status' | 'headers'>
): Promise<APIError | undefined> {
  const body: unknown = response.data;
  const contentType = response.headers?.['content-type'] ?? (body instanceof Blob ? body.type : '');

  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('json')) return undefined;

  try {
    let json: string | undefined;

    if (body instanceof Blob && body.size <= MAX_ERROR_BODY_BYTES) {
      json = await body.text();
    } else if ((body instanceof ArrayBuffer || ArrayBuffer.isView(body)) && body.byteLength <= MAX_ERROR_BODY_BYTES) {
      json = new TextDecoder().decode(body);
    }

    if (json !== undefined) {
      const payload: unknown = JSON.parse(json);

      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
        return handleAPIResponseError({ ...response, data: payload });
      }
    }
  } catch {
    // JSON that cannot be decoded is still not valid binary endpoint data.
  }

  return handleAPIError({
    code: -1,
    sourceDomain: 'client',
    httpStatus: response.status,
    message: 'Expected binary data but received an invalid JSON response',
  });
}
