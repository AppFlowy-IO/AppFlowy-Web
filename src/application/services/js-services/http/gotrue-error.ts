/**
 * GoTrue Error Parser
 * Handles various error formats from GoTrue authentication service
 */

export interface GoTrueError {
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

    // Log for debugging (remove in production)
    if (process.env.NODE_ENV === 'development') {
      console.log('[GoTrue Error Parser] URL:', url);
      console.log('[GoTrue Error Parser] Search params:', Array.from(searchParams.entries()));
      console.log('[GoTrue Error Parser] Hash params:', Array.from(hashParams.entries()));
    }

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
  errorCode?: string | null;
  message?: string;
  msg?: string;
  code?: number | string;
  status?: number;
}): GoTrueError {
  // Get the most descriptive error message available
  const errorMessage =
    errorData.errorDescription ||
    errorData.message ||
    errorData.msg ||
    errorData.error ||
    'Authentication failed';

  // Parse error code from various sources
  let code = GoTrueErrorCode.UNKNOWN;

  // Try to get code from explicit field
  if (errorData.code) {
    code = typeof errorData.code === 'number' ? errorData.code : Number.parseInt(errorData.code);
  } else if (errorData.errorCode) {
    code = Number.parseInt(errorData.errorCode);
  } else if (errorData.status) {
    code = errorData.status;
  }

  // Try to extract code from message format like "422: Signups not allowed"
  if (code === GoTrueErrorCode.UNKNOWN && errorMessage) {
    const codeMatch = errorMessage.match(/^(\d{3}):/);

    if (codeMatch) {
      code = Number.parseInt(codeMatch[1]);
    }
  }

  // Clean up the message - remove error codes and clean up formatting
  const cleanMessage = errorMessage
    .replace(/^\d{3}:\s*/, '') // Remove "422: " prefix
    .replace(/\+/g, ' ') // Replace + with spaces (URL encoding)
    .replace(/%20/g, ' ') // Replace %20 with spaces
    .trim();

  // Return the actual error message from GoTrue (don't replace it)
  return {
    code,
    message: cleanMessage,
    originalError: errorMessage,
  };
}

/**
 * Enhance error messages to be more user-friendly (optional)
 * You can use this function if you want to provide custom user-friendly messages
 * while keeping the original error available for debugging
 */
export function enhanceErrorMessage(message: string, errorType?: string | null, code?: number): string {
  const lowerMessage = message.toLowerCase();

  // Signup disabled errors
  if (lowerMessage.includes('signups not allowed') ||
      lowerMessage.includes('signup disabled') ||
      errorType === GoTrueErrorType.SIGNUP_DISABLED ||
      code === GoTrueErrorCode.UNPROCESSABLE_ENTITY) {
    return 'Sign-ups are currently disabled. Please contact your administrator to request access.';
  }

  // Invalid credentials
  if (lowerMessage.includes('invalid login credentials') ||
      lowerMessage.includes('incorrect password') ||
      errorType === GoTrueErrorType.INVALID_GRANT) {
    return 'Invalid email or password. Please try again.';
  }

  // Email not confirmed
  if (lowerMessage.includes('email not confirmed') ||
      errorType === GoTrueErrorType.EMAIL_NOT_CONFIRMED) {
    return 'Please confirm your email address before signing in.';
  }

  // User banned
  if (lowerMessage.includes('user banned') ||
      errorType === GoTrueErrorType.USER_BANNED) {
    return 'Your account has been suspended. Please contact support.';
  }

  // Rate limiting
  if (lowerMessage.includes('too many requests') ||
      code === GoTrueErrorCode.TOO_MANY_REQUESTS) {
    return 'Too many attempts. Please try again later.';
  }

  // Access denied
  if (errorType === GoTrueErrorType.ACCESS_DENIED) {
    return 'Access denied. You do not have permission to perform this action.';
  }

  // Session expired
  if (lowerMessage.includes('session expired') ||
      lowerMessage.includes('token expired')) {
    return 'Your session has expired. Please sign in again.';
  }

  // Network or server errors
  if (code === GoTrueErrorCode.INTERNAL_SERVER_ERROR) {
    return 'A server error occurred. Please try again later.';
  }

  // Default - return the cleaned message as-is
  return message;
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
  if (process.env.NODE_ENV === 'development' && error.originalError) {
    // In development, show more details
    return `${error.message}\n\n[Debug] Original: ${error.originalError} (Code: ${error.code})`;
  }

  return error.message;
}