import i18next from 'i18next';

import { ERROR_CODE } from '@/application/constants';
import {
  enhanceErrorMessage,
  parseGoTrueError,
  parseGoTrueErrorFromUrl,
  parseGoTrueFailure,
} from '@/application/services/js-services/http/gotrue-error';
import { determineErrorType, ErrorType, isPermissionDeniedError } from '@/application/utils/error-utils';

import { readErrorIdentity, userErrorSupportDetails, userFriendlyErrorMessage } from '../error-message';

const diagnostic = 'SQLSTATE 23505: /private/server/data; private auth diagnostic';

describe('shared error presentation', () => {
  it.each([
    [-1, 'Error -1: Something went wrong. Contact support if this keeps happening.'],
    [1002, "This password isn't valid."],
    [1020, 'There was a problem processing data.'],
    [1035, "We couldn't prepare the data for this action."],
    [1049, 'This site address is reserved. Choose another one.'],
    [1068, "This invitation can't be used."],
    [1069, "This person is already a workspace member. You don't need to invite them as a guest."],
    [1070, 'This workspace has reached the guest limit for its free plan.'],
    [1071, 'This workspace has reached the guest limit for its paid plan.'],
    [1073, 'Other exports are in progress. Wait for one to finish.'],
    [1132, "This workspace's storage needs maintenance before this action can continue. Contact your administrator."],
    [9001, 'Error 9001: Something went wrong. Contact support if this keeps happening.'],
  ])('preserves the specific meaning of Cloud code %s without rendering diagnostics', (code, expected) => {
    const error = Object.freeze({ sourceDomain: 'appflowy.server', code, message: diagnostic, retryAfterSecs: 17 });
    const before = JSON.stringify(error);

    expect(userFriendlyErrorMessage(error)).toBe(expected);
    expect(userErrorSupportDetails(error)).toContain(diagnostic);
    expect(JSON.stringify(error)).toBe(before);
  });

  it('keeps Cloud, HTTP, and transport namespaces distinct', () => {
    const cloud = { code: -1, sourceDomain: 'appflowy.server', message: diagnostic };
    const offline = { code: -1, sourceDomain: 'transport', message: diagnostic };

    expect(determineErrorType(cloud).type).toBe(ErrorType.Unknown);
    expect(determineErrorType(offline).type).toBe(ErrorType.NetworkError);
    expect(userFriendlyErrorMessage(offline)).toBe('There was a network connection problem.');
    expect(userFriendlyErrorMessage({ code: 404, sourceDomain: 'http' })).toBe("We couldn't find this content.");
    expect(userFriendlyErrorMessage({ code: 404, sourceDomain: 'appflowy.server', httpStatus: 503 })).toMatch(
      /^Error 404:/
    );
    expect(isPermissionDeniedError({ sourceDomain: 'appflowy.server', code: 9001, httpStatus: 403 })).toBe(false);
    expect(isPermissionDeniedError({ sourceDomain: 'http', code: 403 })).toBe(true);
    expect(isPermissionDeniedError({ sourceDomain: 'appflowy.server', code: 1012 })).toBe(true);
    expect(isPermissionDeniedError({ code: 9001, httpStatus: 403 })).toBe(false);
    expect(isPermissionDeniedError({ code: 1037, httpStatus: 403 })).toBe(false);
    expect(readErrorIdentity({ code: 1073, httpStatus: 400 }).sourceDomain).toBe('appflowy.server');
    expect(readErrorIdentity({ httpStatus: 403 }).sourceDomain).toBe('http');
  });

  it('does not mistake export contention or generic duplicates for membership', () => {
    expect(ERROR_CODE.TOO_MANY_EXPORT_TASK).toBe(1073);
    expect(ERROR_CODE.INVALID_GUEST).toBe(1069);
    expect(determineErrorType({ code: 1073 }).type).not.toBe(ErrorType.AlreadyJoined);
    expect(determineErrorType({ code: 1069 }).type).toBe(ErrorType.AlreadyJoined);
    expect(determineErrorType({ code: -3 }).type).toBe(ErrorType.AlreadyExists);
    expect(determineErrorType({ code: ERROR_CODE.ACCESS_REQUEST_ALREADY_DENIED }).type).not.toBe(ErrorType.AlreadyJoined);
    expect(determineErrorType({ code: ERROR_CODE.ACCESS_REQUEST_ALREADY_APPROVED }).type).not.toBe(ErrorType.AlreadyJoined);
  });

  it('keeps timeout and cancellation distinct from network errors', () => {
    expect(userFriendlyErrorMessage({ isAxiosError: true, code: 'ECONNABORTED', message: diagnostic })).toBe(
      'The request timed out.'
    );
    expect(determineErrorType({ isAxiosError: true, code: 'ETIMEDOUT' }).type).toBe(ErrorType.Timeout);
    expect(userFriendlyErrorMessage({ isAxiosError: true, code: 'ERR_CANCELED' })).toBe('The connection was cancelled.');
    expect(determineErrorType({ sourceDomain: 'http', code: 504 }).type).toBe(ErrorType.Timeout);
  });

  it.each([
    undefined,
    { schema_version: 2, reason: 'CUSTOM', message: diagnostic },
    { schema_version: 1, reason: 'invalid-reason', message: diagnostic },
    { schema_version: 1, reason: 'CUSTOM', message: 'bad\ntext' },
    { schema_version: 1, reason: 'CUSTOM', message: 'a'.repeat(1025) },
    { schema_version: 1, reason: 'CUSTOM', message: '   ' },
  ])('ignores unsupported or malformed optional public metadata: %j', (user_error) => {
    expect(userFriendlyErrorMessage({ code: 1017, message: diagnostic, user_error })).toBe(
      'Error 1017: Something went wrong. Contact support if this keeps happening.'
    );
  });

  it("uses a newer server's explicitly public explanation for an unknown reason", () => {
    const error = {
      code: 9001,
      message: diagnostic,
      user_error: {
        schema_version: 1,
        reason: 'NEW_PUBLIC_CONDITION',
        message: 'Contact the workspace owner to complete this action.',
      },
    };

    expect(userFriendlyErrorMessage(error)).toBe('Error 9001: Contact the workspace owner to complete this action.');
  });

  it('localizes a known public reason and its approved parameter', async () => {
    const instance = i18next.createInstance();

    await instance.init({
      lng: 'test',
      resources: {
        test: {
          translation: {
            userError: { NEW_PASSWORD_UNCHANGED: 'Localized password reuse' },
            userErrorDetail: { publishNameTooLong: 'Maximum {{max}} characters' },
          },
        },
      },
      initImmediate: false,
    });
    expect(
      userFriendlyErrorMessage({ code: 422, sourceDomain: 'gotrue', errorCode: 'same_password' }, { t: instance.t })
    ).toBe('Localized password reuse');
    expect(
      userFriendlyErrorMessage(
        {
          code: 1052,
          user_error: {
            schema_version: 1,
            reason: 'PUBLISH_NAME_TOO_LONG',
            message: 'Public limit',
            parameters: { max_chars: 32 },
          },
        },
        { t: instance.t }
      )
    ).toBe('Maximum 32 characters');
  });

  it('recognizes reviewed legacy owner and comment conditions', () => {
    expect(
      userFriendlyErrorMessage({ code: 1008, message: 'Invalid request:space must keep at least one explicit owner' })
    ).toContain('Choose another owner');
    expect(
      userFriendlyErrorMessage({ code: 1017, message: 'af_inline_comment violates af_inline_comment_oid_fkey' })
    ).toBe('Wait for this page to finish syncing before adding a comment.');
  });

  it('retains a known mutation failure cause alongside uncertain completion', () => {
    expect(
      userFriendlyErrorMessage(
        { code: -1, sourceDomain: 'transport', transportFailure: 'timeout' },
        { operation: 'mutation' }
      )
    ).toBe(
      "The request timed out.\nWe couldn't confirm whether this action finished. Check the result before trying again."
    );
  });

  it('never treats a raw exception as public copy', () => {
    const error = new Error(diagnostic);

    expect(userFriendlyErrorMessage(error)).not.toContain(diagnostic);
    expect(userErrorSupportDetails(error)).toContain(diagnostic);
    expect(readErrorIdentity(error).sourceDomain).toBe('client');
  });
});

describe('GoTrue namespace and legacy responses', () => {
  it.each([
    { code: 422, error_code: 'same_password', msg: diagnostic },
    { code: '422', msg: 'New password should be different from the old password.' },
    { status: 422, message: 'New password should be different from the old password.' },
  ])('explains password reuse without optional public metadata: %j', (body) => {
    const error = parseGoTrueError(body);

    expect(error.message).toBe('Your new password must be different from your current password.');
    expect(error.sourceDomain).toBe('gotrue');
    expect(error.code).toBe(422);
    expect(error.originalError).toBe(body.msg ?? body.message);
  });

  it('does not turn all 422 validation failures into disabled signup or registered email', () => {
    expect(parseGoTrueError({ status: 422, error_code: 'weak_password', msg: diagnostic }).message).toBe(
      'Your new password is too weak.'
    );
    expect(enhanceErrorMessage(diagnostic, undefined, 422)).toMatch(/^Error 422: Something went wrong/);
    expect(
      parseGoTrueError({
        status: 422,
        error_code: 'future_condition',
        msg: 'New password should be different from the old password.',
      }).message
    ).toMatch(/^Error 422:/);
  });

  it('keeps the actual HTTP status when body code differs', () => {
    expect(parseGoTrueError({ status: 503, code: 422, error_code: 'same_password', msg: diagnostic }).message).toBe(
      "AppFlowy isn't available right now. Try again later."
    );
  });

  it('accepts symbolic OAuth callback reasons without producing NaN or showing diagnostics', () => {
    const result = parseGoTrueErrorFromUrl(
      `https://appflowy.test/callback?error_code=otp_expired&error_description=${encodeURIComponent(diagnostic)}`
    );

    expect(result?.code).toBe(-1);
    expect(result?.message).toBe('This code or link is invalid or has expired. Request a new one.');
    expect(result?.originalError).toBe(diagnostic);
  });

  it('retains the OAuth response error_description for support', () => {
    const result = parseGoTrueFailure({ response: { status: 400, data: {
      error: 'invalid_grant', error_description: 'Invalid login credentials',
    } } });

    expect(result.message).toBe("These sign-in details don't match. Check your email or username and password.");
    expect(result.diagnosticMessage).toBe('Invalid login credentials');
  });

  it('preserves transport failures and public response metadata through normalization', () => {
    expect(parseGoTrueFailure({ isAxiosError: true, code: 'ERR_NETWORK', message: diagnostic }).message).toBe(
      'There was a network connection problem.'
    );
    const error = parseGoTrueFailure({
      response: {
        status: 429,
        data: {
          code: 429,
          msg: diagnostic,
          user_error: {
            schema_version: 1,
            reason: 'NEW_AUTH_LIMIT',
            message: 'Wait before requesting another sign-in email.',
          },
        },
        headers: { 'x-request-id': 'auth-123' },
      },
    });

    expect(error.message).toBe('Error 429: Wait before requesting another sign-in email.');
    expect(userErrorSupportDetails(error)).toContain('Reference: auth-123');
    expect(userErrorSupportDetails(error)).toContain(diagnostic);
  });
});
