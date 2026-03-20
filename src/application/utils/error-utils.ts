import axios from 'axios';

import { ERROR_CODE } from '@/application/constants';

/**
 * Error types based on server HTTP status codes and selective error codes
 *
 * Server Error Response Format:
 * {
 *   code: number,    // ErrorCode enum (e.g., 1068, 1073, 1041)
 *   message: string
 * }
 *
 * HTTP Status Mapping (from server IntoResponse):
 * - 404: RecordNotFound
 * - 401: UserUnAuthorized, NotLoggedIn
 * - 403: NotEnoughPermissions
 * - 400: InvalidRequest, InvalidEmail, InvalidPassword
 * - 500: Internal, Unhandled
 * - 503: ServiceTemporaryUnavailable, AIServiceUnavailable
 * - 409: RecordAlreadyExists, UserAlreadyRegistered
 * - 429: TooManyRequests
 */
export enum ErrorType {
  /** 404 - Page/resource not found */
  PageNotFound = 'PAGE_NOT_FOUND',

  /** 401 - User not authenticated */
  Unauthorized = 'UNAUTHORIZED',

  /** 403 - User doesn't have permission */
  Forbidden = 'FORBIDDEN',

  /** 500, 502, 503, 504 - Server errors */
  ServerError = 'SERVER_ERROR',

  /** Network connection failed (no response from server) */
  NetworkError = 'NETWORK_ERROR',

  /** 400 with code 1068 - Invalid invitation/link */
  InvalidLink = 'INVALID_LINK',

  /** 409 with code 1073 - User already joined/exists */
  AlreadyJoined = 'ALREADY_JOINED',

  /** 403 with code 1041 - Not invitee of invitation */
  NotInvitee = 'NOT_INVITEE',

  /** 429 - Rate limited */
  RateLimited = 'RATE_LIMITED',

  /** 410 - Resource deleted */
  Gone = 'GONE',

  /** 408 - Request timeout */
  Timeout = 'TIMEOUT',

  /** Fallback for unhandled errors */
  Unknown = 'UNKNOWN',
}

/**
 * Structured error object with type, message, and optional code/status
 */
export interface AppError {
  /** Determined error type for UI handling */
  type: ErrorType;

  /** Human-readable error message from server */
  message: string;

  /** Server error code (e.g., 1068, 1073, 1041) */
  code?: number;

  /** HTTP status code (e.g., 404, 401, 403) */
  statusCode?: number;
}

/**
 * Determines error type from thrown error
 *
 * Strategy:
 * 1. Check if network error (no response)
 * 2. Check for specific error codes that need custom UX
 * 3. Fall back to HTTP status code mapping
 *
 * @param error - Error from API call or thrown exception
 * @returns Structured AppError object
 *
 * @example
 * ```typescript
 * try {
 *   await loadView(viewId);
 * } catch (error) {
 *   const appError = determineErrorType(error);
 *
 *   switch (appError.type) {
 *     case ErrorType.PageNotFound:
 *       return <PageNotFoundError />;
 *     case ErrorType.Unauthorized:
 *       return <UnauthorizedError />;
 *     case ErrorType.NetworkError:
 *       return <NetworkError onRetry={retry} />;
 *   }
 * }
 * ```
 */

/**
 * Maps a server error code (from the APIResponse `code` field) to an ErrorType.
 * Returns undefined if the code is not recognized — caller should fall back to
 * HTTP status mapping or Unknown.
 *
 * This is the single source of truth for error-code-to-UI-type mapping.
 * Both the AxiosError path and the normalized APIError path delegate here.
 */
function mapErrorCodeToType(code: number | undefined): ErrorType | undefined {
  if (code === undefined) return undefined;

  // Network error (code -1 from handleAPIError)
  if (code === -1) return ErrorType.NetworkError;

  // Not found
  if (code === ERROR_CODE.RECORD_NOT_FOUND || code === ERROR_CODE.WORKSPACE_NOT_FOUND) {
    return ErrorType.PageNotFound;
  }

  // Deleted / gone
  if (code === ERROR_CODE.RECORD_DELETED) return ErrorType.Gone;

  // Unauthorized (need to sign in)
  if (code === ERROR_CODE.USER_UNAUTHORIZED || code === ERROR_CODE.NOT_LOGGED_IN) {
    return ErrorType.Unauthorized;
  }

  // Forbidden (signed in but no permission, or plan guest limit exceeded)
  if (
    code === ERROR_CODE.NOT_HAS_PERMISSION ||
    code === ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED ||
    code === ERROR_CODE.PAID_PLAN_GUEST_LIMIT_EXCEEDED
  ) {
    return ErrorType.Forbidden;
  }

  // Invalid invitation link
  if (code === ERROR_CODE.INVALID_LINK) return ErrorType.InvalidLink;

  // Already joined / exists
  if (code === ERROR_CODE.ALREADY_JOINED || code === ERROR_CODE.RECORD_ALREADY_EXISTS) {
    return ErrorType.AlreadyJoined;
  }

  // Not invitee
  if (code === ERROR_CODE.NOT_INVITEE_OF_INVITATION) return ErrorType.NotInvitee;

  // Rate limited
  if (code === ERROR_CODE.TOO_MANY_REQUESTS) return ErrorType.RateLimited;

  // Service unavailable
  if (code === ERROR_CODE.AI_SERVICE_UNAVAILABLE || code === ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE) {
    return ErrorType.ServerError;
  }

  // Timeout
  if (code === ERROR_CODE.REQUEST_TIMEOUT) return ErrorType.Timeout;

  // Storage / payload limits
  if (
    code === ERROR_CODE.PAYLOAD_TOO_LARGE ||
    code === ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED ||
    code === ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED ||
    code === ERROR_CODE.STORAGE_SPACE_NOT_ENOUGH
  ) {
    return ErrorType.Forbidden;
  }

  return undefined;
}

/**
 * Maps an HTTP status code to an ErrorType.
 */
function mapHttpStatusToType(status: number): ErrorType {
  if (status === 404) return ErrorType.PageNotFound;
  if (status === 401) return ErrorType.Unauthorized;
  if (status === 403) return ErrorType.Forbidden;
  if (status === 408) return ErrorType.Timeout;
  if (status === 410) return ErrorType.Gone;
  if (status === 429) return ErrorType.RateLimited;
  if (status >= 500 && status < 600) return ErrorType.ServerError;
  return ErrorType.Unknown;
}

export function determineErrorType(error: unknown): AppError {
  // Network error (no response from server)
  if (axios.isAxiosError(error) && !error.response) {
    return {
      type: ErrorType.NetworkError,
      message: error.message || 'Network connection failed. Please check your internet connection.',
    };
  }

  // HTTP error (server responded with error status)
  if (axios.isAxiosError(error) && error.response) {
    const status = error.response.status;
    const data = error.response.data as { code?: number; message?: string } | undefined;
    const code = data?.code;
    const message = data?.message || error.message || 'An unexpected error occurred';

    // Priority 1: Map by server error code
    const typeFromCode = mapErrorCodeToType(code);

    if (typeFromCode) {
      return { type: typeFromCode, message, code, statusCode: status };
    }

    // Priority 2: Map by HTTP status code
    return { type: mapHttpStatusToType(status), message, code, statusCode: status };
  }

  // Normalized APIError from executeAPIRequest / executeAPIVoidRequest / handleAPIError.
  // These are plain { code: number, message: string } objects — not AxiosError instances.
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'number'
  ) {
    const apiError = error as { code: number; message?: string };
    const code = apiError.code;
    const message = apiError.message || 'Request failed';

    // Priority 1: Map by server error code
    const typeFromCode = mapErrorCodeToType(code);

    if (typeFromCode) {
      return { type: typeFromCode, message, code };
    }

    // Priority 2: Treat the code as an HTTP status (fallback for errors
    // where handleAPIError used response.status as the code value)
    return { type: mapHttpStatusToType(code), message, statusCode: code };
  }

  // Non-axios error (e.g., thrown exception, logic error)
  const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

  return {
    type: ErrorType.Unknown,
    message: errorMessage,
  };
}

/**
 * Type guard to check if error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    'message' in error &&
    Object.values(ErrorType).includes((error as AppError).type)
  );
}

/**
 * Formats error for logging/debugging
 */
export function formatErrorForLogging(error: unknown): string {
  const appError = determineErrorType(error);
  const parts = [
    `[${appError.type}]`,
    appError.message,
  ];

  if (appError.statusCode) {
    parts.push(`(HTTP ${appError.statusCode})`);
  }

  if (appError.code) {
    parts.push(`(Code ${appError.code})`);
  }

  return parts.join(' ');
}
