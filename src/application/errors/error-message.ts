import i18next, { TFunction } from 'i18next';

import catalog from './shared-error-catalog.json';

export type ErrorSource = 'appflowy.server' | 'http' | 'gotrue' | 'transport' | 'client';
export type TransportFailure = 'network' | 'timeout' | 'cancelled';

export interface ErrorIdentity {
  code?: number;
  httpStatus?: number;
  sourceDomain: ErrorSource;
  diagnosticMessage: string;
  errorCode?: string;
  transportFailure?: TransportFailure;
  user_error?: unknown;
  requestId?: string;
}

export interface ErrorMessageOptions {
  fallback?: string;
  operation?: 'action' | 'mutation';
  t?: TFunction;
  /** Omit hosted plan names when deployment capabilities are unknown or self-hosted. */
  hostedBilling?: boolean;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);

export function errorCodeNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;

  return typeof number === 'number' && Number.isInteger(number) && number >= -2147483648 && number <= 2147483647
    ? number
    : undefined;
}

function lookup<T>(table: Record<string, T>, key: string | number | undefined): T | undefined {
  return key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Source identity is supplied by endpoint adapters; legacy bare HTTP errors remain readable. */
export function readErrorIdentity(error: unknown): ErrorIdentity {
  const outer = record(error) ?? {};
  const response = record(outer.response);
  const body = record(response?.data) ?? outer;
  const code = errorCodeNumber(body.code);
  const httpStatus = errorCodeNumber(response?.status ?? outer.httpStatus ?? outer.statusCode);
  const errorCode = text(body.errorCode) ?? text(body.error_code);
  const source = outer.sourceDomain;
  const sourceDomain: ErrorSource =
    source === 'appflowy.server' ||
    source === 'http' ||
    source === 'gotrue' ||
    source === 'transport' ||
    source === 'client'
      ? source
      : outer.isAxiosError && !response
      ? 'transport'
      : errorCode
      ? 'gotrue'
      : response
      ? code !== undefined && code !== 0
        ? 'appflowy.server'
        : 'http'
      : code !== undefined
      ? code >= 100 && code <= 599
        ? 'http'
        : 'appflowy.server'
      : httpStatus !== undefined
      ? 'http'
      : 'client';
  const transportFailure =
    outer.transportFailure === 'timeout' || outer.code === 'ECONNABORTED' || outer.code === 'ETIMEDOUT'
      ? 'timeout'
      : outer.transportFailure === 'cancelled' || outer.code === 'ERR_CANCELED'
      ? 'cancelled'
      : 'network';

  return {
    code: code ?? (sourceDomain === 'http' || sourceDomain === 'gotrue' ? httpStatus : undefined),
    httpStatus,
    sourceDomain,
    diagnosticMessage:
      text(body.diagnosticMessage) ??
      text(body.originalError) ??
      text(body.error_description) ??
      text(body.msg) ??
      text(body.message) ??
      text(outer.message) ??
      '',
    errorCode,
    transportFailure: sourceDomain === 'transport' ? transportFailure : undefined,
    user_error: body.user_error,
    requestId: text(body.requestId) ?? text(body.request_id),
  };
}

/** Raw text is only for recovery checks, logs, and explicit support copying. */
export function getErrorDiagnostic(error: unknown): string {
  return readErrorIdentity(error).diagnosticMessage;
}

export function supportedPublicError(
  value: unknown
): { reason: string; message: string; maxChars?: number } | undefined {
  const envelope = record(value);

  if (
    envelope?.schema_version !== 1 ||
    typeof envelope.reason !== 'string' ||
    !/^[A-Z0-9_]{1,64}$/.test(envelope.reason) ||
    typeof envelope.message !== 'string' ||
    !envelope.message.trim() ||
    envelope.message.length > 1024 ||
    // Explicitly reject control characters in server-declared public copy.
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f-\x9f]/.test(envelope.message)
  )
    return undefined;
  const max = record(envelope.parameters)?.max_chars;

  return {
    reason: envelope.reason,
    message: envelope.message,
    maxChars: typeof max === 'number' && Number.isInteger(max) && max > 0 && max <= 2147483647 ? max : undefined,
  };
}

function legacyCloudReason(error: ErrorIdentity): string | undefined {
  const { code, diagnosticMessage: message } = error;

  if (
    code === 1008 &&
    [
      'space must keep at least one explicit owner',
      'cannot remove the last space owner without an active workspace owner',
      'they are the last owner of private space',
      'they own legacy private space',
    ].some((fragment) => message.includes(fragment))
  )
    return 'SPACE_OWNER_REQUIRED';
  if (
    (code === 1017 || code === 1020) &&
    message.includes('af_inline_comment') &&
    message.includes('af_inline_comment_oid_fkey')
  ) {
    return 'COMMENT_DOCUMENT_SYNC_REQUIRED';
  }

  if (code === 1003 || code === 1024) {
    const lower = message.toLowerCase();

    if (lower.includes('invalid login credentials') || lower.includes('invalid username or password'))
      return 'SIGN_IN_CREDENTIALS';
    if (lower.includes('rate limit') || lower.includes('for security purposes')) return 'RATE_LIMITED';
    if (
      lower.includes('token is invalid or expired') ||
      lower.includes('token has expired or is invalid') ||
      lower.includes('otp_expired')
    )
      return 'VERIFICATION_EXPIRED';
  }

  if (code !== undefined && [1008, 1017, 1054, 1079].includes(code)) {
    const providerReasons = {
      'AI provider authentication failed': 'AI_CONFIGURATION_REQUIRED',
      'AI provider request is invalid': 'AI_REQUEST_PROBLEM',
      'AI provider rate limit exceeded': 'AI_RATE_LIMITED',
      'AI provider is temporarily unavailable': 'AI_UNAVAILABLE',
    };

    for (const [prefix, reason] of Object.entries(providerReasons)) {
      if (message === prefix || message.startsWith(`${prefix}. request_id:`)) return reason;
    }
  }

  return undefined;
}

function resolveReason(error: ErrorIdentity): string | undefined {
  if (error.sourceDomain === 'transport') {
    return error.transportFailure === 'timeout'
      ? 'REQUEST_TIMEOUT'
      : error.transportFailure === 'cancelled'
      ? 'CONNECTION_CANCELLED'
      : 'CONNECTION_UNAVAILABLE';
  }

  if (error.sourceDomain === 'appflowy.server') {
    return legacyCloudReason(error) ?? lookup(catalog.codes, error.code)?.reason ?? undefined;
  }

  if (error.sourceDomain === 'gotrue') {
    // A stable machine reason takes precedence. Only absent reasons may use an
    // exact reviewed legacy string; arbitrary diagnostic text never becomes UI.
    const reason = error.errorCode
      ? lookup(catalog.gotrue_codes, error.errorCode)
      : lookup(catalog.gotrue_legacy_messages, error.diagnosticMessage);
    const status = error.httpStatus ?? (error.code !== undefined && error.code >= 100 && error.code <= 599 ? error.code : undefined);

    if (
      reason &&
      (!['NEW_PASSWORD_UNCHANGED', 'NEW_PASSWORD_TOO_WEAK'].includes(reason) || status === undefined || status === 422)
    )
      return reason;
  }

  if (error.sourceDomain === 'http' || error.sourceDomain === 'gotrue') {
    const status = error.httpStatus ?? error.code;

    return (
      lookup(catalog.http_codes, status) ??
      (status !== undefined && status >= 500 && status <= 599 ? catalog.http_server_error_reason : undefined)
    );
  }

  return undefined;
}

/** A display boundary: wire codes and diagnostics never authorize public text. */
export function userFriendlyErrorMessage(error: unknown, options: ErrorMessageOptions = {}): string {
  const identity = readErrorIdentity(error);
  const publicError = supportedPublicError(identity.user_error);
  let reason = publicError?.reason ?? resolveReason(identity);

  if (!publicError && options.hostedBilling === false &&
    (reason === 'FREE_GUEST_LIMIT_REACHED' || reason === 'PAID_GUEST_LIMIT_REACHED')) {
    reason = 'GUEST_LIMIT_REACHED';
  }

  const translate = options.t ?? (i18next.isInitialized ? i18next.t.bind(i18next) : undefined);
  const localized = (key: string, fallback: string, args: Record<string, string | number> = {}) => {
    const result = translate?.(key, { defaultValue: fallback, ...args });

    return typeof result === 'string' && result.trim() && result !== key ? result : fallback;
  };

  const guidance = (key: string) =>
    localized(`userError.${key}`, lookup(catalog.reasons, key) ?? catalog.reasons.ACTION_PROBLEM);

  if (reason === 'PUBLISH_NAME_TOO_LONG' && publicError?.maxChars) {
    return localized(
      'userErrorDetail.publishNameTooLong',
      `Keep the page address to ${publicError.maxChars} characters or fewer.`,
      { max: publicError.maxChars }
    );
  }

  if (!reason || reason === 'ACTION_PROBLEM' || !lookup(catalog.reasons, reason)) {
    const generic =
      options.operation === 'mutation' ? guidance('OUTCOME_UNKNOWN') : options.fallback || guidance('ACTION_PROBLEM');
    const message = publicError
      ? options.operation === 'mutation'
        ? `${generic}\n${publicError.message}`
        : publicError.message
      : generic;

    return identity.code === undefined
      ? message
      : localized('userErrorDetail.withCode', `Error ${identity.code}: ${message}`, { code: identity.code, message });
  }

  const message = guidance(reason);

  if (
    options.operation === 'mutation' &&
    [
      'CONNECTION_UNAVAILABLE',
      'CONNECTION_CANCELLED',
      'SERVICE_UNAVAILABLE',
      'RESPONSE_PROBLEM',
      'REQUEST_TIMEOUT',
      'RESPONSE_TIMEOUT',
      'ACTION_TIMEOUT',
      'LOCK_TIMEOUT',
    ].includes(reason)
  )
    return `${message}\n${guidance('OUTCOME_UNKNOWN')}`;
  return message;
}

export function userErrorSupportDetails(error: unknown): string {
  const identity = readErrorIdentity(error);

  return [
    userFriendlyErrorMessage(error),
    ...(identity.code === undefined ? [] : [`Code: ${identity.code}`]),
    `Source: ${identity.sourceDomain}`,
    ...(identity.httpStatus === undefined ? [] : [`HTTP: ${identity.httpStatus}`]),
    ...(identity.diagnosticMessage ? [`Message: ${identity.diagnosticMessage}`] : []),
    ...(identity.requestId && /^[a-zA-Z0-9_.-]{1,128}$/.test(identity.requestId)
      ? [`Reference: ${identity.requestId}`]
      : []),
  ].join('\n');
}
