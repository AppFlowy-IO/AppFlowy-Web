export function getErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string') return message;
  }

  return fallback;
}

export function isAPIErrorCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

/**
 * Returns true only when an HTTP 404/405 represents a route that is not
 * available on the current server. AppFlowy application errors can also use
 * HTTP 404, so a distinct payload code must not activate a compatibility
 * fallback.
 */
export function isUnsupportedRouteError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as {
    code?: unknown;
    httpStatus?: unknown;
    response?: {
      status?: unknown;
      data?: { code?: unknown };
    };
  };
  const httpStatus =
    typeof candidate.httpStatus === 'number'
      ? candidate.httpStatus
      : typeof candidate.response?.status === 'number'
      ? candidate.response.status
      : undefined;
  const payloadCode =
    typeof candidate.code === 'number'
      ? candidate.code
      : typeof candidate.response?.data?.code === 'number'
      ? candidate.response.data.code
      : undefined;

  if (httpStatus !== undefined) {
    return (httpStatus === 404 || httpStatus === 405) && (payloadCode === undefined || payloadCode === httpStatus);
  }

  // Normalized errors from older clients may not retain the transport status.
  return payloadCode === 404 || payloadCode === 405;
}
