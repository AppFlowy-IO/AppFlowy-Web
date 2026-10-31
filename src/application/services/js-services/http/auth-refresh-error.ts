import { readErrorIdentity } from '@/application/errors/error-message';

const INVALID_SESSION_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
]);
const LEGACY_INVALID_REFRESH_MESSAGES = [
  'invalid refresh token',
  'refresh token not found',
  'refresh token is invalid',
  'refresh token has expired',
  'session not found',
];

/** Only a confirmed GoTrue credential rejection may discard a stored login. */
export function isAuthRefreshFailure(error: unknown): boolean {
  const { httpStatus, errorCode, diagnosticMessage } = readErrorIdentity(error);

  // Proxies and temporary failures can return OAuth-shaped bodies too. Neither
  // a network error nor a 429/5xx response establishes that a login was revoked.
  if (httpStatus !== 400 && httpStatus !== 401 && httpStatus !== 403) return false;
  if (errorCode && INVALID_SESSION_CODES.has(errorCode)) return true;

  const message = diagnosticMessage.toLowerCase();

  return LEGACY_INVALID_REFRESH_MESSAGES.some((marker) => message.includes(marker));
}
