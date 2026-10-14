import { ERROR_CODE } from '@/application/constants';
import { getBillingErrorMessage } from '@/utils/billing-error';
import { getAPIErrorCode, isUnsupportedRouteError } from '@/utils/errors';

import type { TFunction } from 'i18next';

/** React already escapes text; i18next escaping would show `&amp;` in names such as "R&D". */
export const RAW = { interpolation: { escapeValue: false } };

const PERMISSION_CODES = new Set<number>([
  ERROR_CODE.NOT_LOGGED_IN,
  ERROR_CODE.NOT_HAS_PERMISSION,
  ERROR_CODE.USER_UNAUTHORIZED,
  401,
  403,
]);
const GONE_CODES = new Set<number>([ERROR_CODE.RECORD_NOT_FOUND, 404]);

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { httpStatus: status, response } = error as { httpStatus?: unknown; response?: { status?: unknown } };

  if (typeof status === 'number') return status;
  return typeof response?.status === 'number' ? response.status : undefined;
}

/** The server refused: this account may no longer do this (lost rights or signed out). */
export function isPermissionError(error: unknown): boolean {
  const code = getAPIErrorCode(error);
  const status = httpStatus(error);

  return (code !== undefined && PERMISSION_CODES.has(code)) || status === 401 || status === 403;
}

/** What was acted on is gone: a removed member or group, or a deleted space. A missing route is not. */
export function isGoneError(error: unknown): boolean {
  if (isUnsupportedRouteError(error)) return false;
  const code = getAPIErrorCode(error);

  return (code !== undefined && GONE_CODES.has(code)) || httpStatus(error) === 404;
}

/**
 * The server refused because the copy is over its size bound: HTTP 413 with the AppFlowy code, or
 * a bare 413 from a proxy that carries no code.
 */
export function isTooLargeError(error: unknown): boolean {
  const code = getAPIErrorCode(error);

  return code === ERROR_CODE.PAYLOAD_TOO_LARGE || code === 413 || httpStatus(error) === 413;
}

/**
 * Why a change didn't go through, in plain words, to follow the name of the change in a toast
 * ("Couldn't change access for Alex. You don't have permission to do this."). Server text can name
 * internal IDs, so an answer from the server gets reviewed copy; errors raised by this client
 * already carry plain copy.
 */
export function changeFailureReason(error: unknown, t: TFunction): string {
  const billingMessage = getBillingErrorMessage(error);

  if (billingMessage) return billingMessage;
  if (getAPIErrorCode(error) === undefined) {
    return error instanceof Error && error.message ? error.message : t('changeFailure.unknown');
  }

  if (isPermissionError(error)) return t('changeFailure.noPermission');
  if (isGoneError(error)) return t('changeFailure.changedElsewhere');
  return t('changeFailure.unknown');
}
