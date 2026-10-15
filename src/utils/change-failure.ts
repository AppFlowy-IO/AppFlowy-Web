import { ERROR_CODE } from '@/application/constants';
import { userFriendlyErrorMessage } from '@/application/errors/error-message';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
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

const NO_PUBLIC_MESSAGE = '\u0000';

/**
 * The reviewed words the server or the shared error catalog gives for this error, in the
 * reader's language, or undefined when only generic guidance would apply. Never raw server text.
 */
export function publicErrorMessage(error: unknown): string | undefined {
  const message = userFriendlyErrorMessage(error, {
    fallback: NO_PUBLIC_MESSAGE,
    hostedBilling: getWorkspacePlanPolicy().usesHostedBilling,
  });

  return message.includes(NO_PUBLIC_MESSAGE) ? undefined : message;
}

/**
 * Why a change didn't go through, in plain words, to follow the name of the change in a toast
 * ("Couldn't change access for Alex. You don't have permission to do this."). One precedence for
 * every permission screen: billing remedies; then this client's words for lost rights and things
 * that changed elsewhere; then a public message from the server or the shared catalog; then the
 * copy an error raised by this client carries; then a generic reason. Server text, which can name
 * internal IDs, is never shown.
 */
export function changeFailureReason(error: unknown, t: TFunction): string {
  const billingMessage = getBillingErrorMessage(error);

  if (billingMessage) return billingMessage;
  if (isPermissionError(error)) return t('changeFailure.noPermission');
  if (isGoneError(error)) return t('changeFailure.changedElsewhere');
  const publicMessage = publicErrorMessage(error);

  if (publicMessage) return publicMessage;
  if (getAPIErrorCode(error) === undefined && error instanceof Error && error.message) return error.message;
  return t('changeFailure.unknown');
}
