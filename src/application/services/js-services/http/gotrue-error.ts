import { errorCodeNumber, ErrorIdentity, readErrorIdentity, userFriendlyErrorMessage } from '@/application/errors/error-message';

/**
 * GoTrue Error Parser
 * Handles various error formats from GoTrue authentication service
 */

export interface GoTrueError extends Partial<ErrorIdentity> {
  code: number;
  message: string;
  originalError?: string;
}

/**
 * Common GoTrue error codes
 */
export enum GoTrueErrorCode {
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  UNKNOWN = -1,
}

/**
 * Known GoTrue error types
 */
export enum GoTrueErrorType {
  ACCESS_DENIED = 'access_denied',
  UNAUTHORIZED_CLIENT = 'unauthorized_client',
  INVALID_REQUEST = 'invalid_request',
  INVALID_GRANT = 'invalid_grant',
  UNSUPPORTED_GRANT_TYPE = 'unsupported_grant_type',
  SIGNUP_DISABLED = 'signup_disabled',
  USER_BANNED = 'user_banned',
  EMAIL_NOT_CONFIRMED = 'email_not_confirmed',
  BAD_JSON = 'bad_json',
  BAD_JWT = 'bad_jwt',
  NOT_ADMIN = 'not_admin',
  NO_AUTHORIZATION = 'no_authorization',
  USER_NOT_FOUND = 'user_not_found',
  SESSION_NOT_FOUND = 'session_not_found',
  FLOW_STATE_NOT_FOUND = 'flow_state_not_found',
  FLOW_STATE_EXPIRED = 'flow_state_expired',
  PKCE_VERIFIER_NOT_FOUND = 'pkce_verifier_not_found',
}

/**
 * Parse GoTrue error from URL parameters
 * Handles multiple formats that GoTrue might use in callbacks
 */
export function parseGoTrueErrorFromUrl(url: string): GoTrueError | null {
  try {
    const urlObj = new URL(url);
    const searchParams = urlObj.searchParams;
    const hash = urlObj.hash;
    const hashParams = hash ? new URLSearchParams(hash.slice(1)) : new URLSearchParams();

    // Check all possible error parameter locations and names
    const error =
      searchParams.get('error') ||
      hashParams.get('error') ||
      searchParams.get('error_type') ||
      hashParams.get('error_type');

    const errorDescription =
      searchParams.get('error_description') ||
      hashParams.get('error_description') ||
      searchParams.get('message') ||
      hashParams.get('message') ||
      searchParams.get('msg') ||
      hashParams.get('msg') ||
      searchParams.get('error_msg') ||
      hashParams.get('error_msg');

    const errorCode =
      searchParams.get('error_code') ||
      hashParams.get('error_code') ||
      searchParams.get('code') ||
      hashParams.get('code') ||
      searchParams.get('status') ||
      hashParams.get('status');

    // If no error indicators found, return null
    if (!error && !errorDescription && !errorCode) {
      return null;
    }

    // Parse the error details
    return parseGoTrueError({
      error,
      errorDescription,
      errorCode,
    });
  } catch (e) {
    console.error('[GoTrue Error Parser] Failed to parse URL:', e);
    return null;
  }
}

/**
 * Parse GoTrue error from response or error object
 */
export function parseGoTrueError(errorData: {
  error?: string | null;
  errorDescription?: string | null;
  error_description?: string;
  errorCode?: string | number | null;
  error_code?: string;
  message?: string;
  msg?: string;
  code?: number | string;
  status?: number;
  user_error?: unknown;
}): GoTrueError {
  const originalError = [errorData.errorDescription, errorData.error_description, errorData.msg, errorData.message, errorData.error]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim())) ?? 'Authentication failed';
  const numericStatus = [errorData.status, errorData.code, errorData.errorCode]
    .map(errorCodeNumber).find((value) => value !== undefined && value >= 100 && value <= 599);
  const symbolicCode = errorData.error_code ||
    (typeof errorData.errorCode === 'string' && errorCodeNumber(errorData.errorCode) === undefined ? errorData.errorCode : undefined) ||
    errorData.error || undefined;
  const identity: GoTrueError = {
    code: numericStatus ?? GoTrueErrorCode.UNKNOWN,
    sourceDomain: 'gotrue',
    httpStatus: numericStatus,
    errorCode: symbolicCode,
    diagnosticMessage: originalError,
    originalError,
    user_error: errorData.user_error,
    message: '',
  };

  return { ...identity, message: userFriendlyErrorMessage(identity) };
}

/** Keep GoTrue's HTTP namespace and transport failures distinct from Cloud codes. */
export function parseGoTrueFailure(error: unknown): GoTrueError {
  const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const response = candidate.response && typeof candidate.response === 'object'
    ? candidate.response as { status?: number; data?: unknown; headers?: Record<string, unknown> } : undefined;

  if (response) {
    const body = response.data && typeof response.data === 'object' ? response.data : {};
    const parsed = parseGoTrueError({ ...body, status: response.status });
    const requestId = response.headers?.['x-request-id'];

    return { ...parsed, ...(typeof requestId === 'string' ? { requestId } : {}) };
  }

  const parsed = readErrorIdentity(error);
  const identity = { ...parsed, code: parsed.code ?? GoTrueErrorCode.UNKNOWN };

  return {
    ...identity,
    message: userFriendlyErrorMessage(identity),
    originalError: identity.diagnosticMessage,
  };
}

/** Backward-compatible entry point, using the same reviewed catalog as requests. */
export function enhanceErrorMessage(message: string, errorType?: string | null, code?: number): string {
  return parseGoTrueError({ message, errorCode: errorType, status: code }).message;
}

/**
 * Check if a URL contains GoTrue error parameters
 */
export function hasGoTrueError(url: string): boolean {
  const error = parseGoTrueErrorFromUrl(url);

  return error !== null;
}

/**
 * Format GoTrue error for display
 */
export function formatGoTrueError(error: GoTrueError): string {
  return userFriendlyErrorMessage(error);
}
