import { ERROR_CODE } from '@/application/constants';
import { ClientValidationError } from '@/application/errors/client-validation-error';
import { PlainError } from '@/application/errors/plain-error';
import { changeFailureReason, publicErrorMessage } from '@/utils/change-failure';

import type { TFunction } from 'i18next';

const t = ((key: string) => key) as unknown as TFunction;
const publicServerError = (message: string) => ({
  code: ERROR_CODE.INVALID_REQUEST,
  httpStatus: 400,
  sourceDomain: 'appflowy.server',
  message: 'raw diagnostic naming space 3fa85f64',
  user_error: { schema_version: 1, reason: 'TEXT_TOO_LONG', message, locale: 'en' },
});

describe('changeFailureReason precedence', () => {
  it('keeps this client\'s words for lost rights, even when the catalog has its own', () => {
    expect(changeFailureReason({ code: ERROR_CODE.NOT_HAS_PERMISSION, httpStatus: 403 }, t)).toBe('changeFailure.noPermission');
    expect(changeFailureReason({ httpStatus: 403, message: 'forbidden' }, t)).toBe('changeFailure.noPermission');
  });

  it('keeps this client\'s words when what was changed is gone', () => {
    expect(changeFailureReason({ code: ERROR_CODE.RECORD_NOT_FOUND, message: 'record not found' }, t)).toBe(
      'changeFailure.changedElsewhere'
    );
  });

  it('shows a public server message when this client has no words of its own for the case', () => {
    expect(changeFailureReason(publicServerError('Keep the space name short.'), t)).toBe('Keep the space name short.');
  });

  it('shows the shared catalog\'s words for a known server failure', () => {
    expect(changeFailureReason({ code: 500, httpStatus: 500, message: 'pool timed out' }, t)).toBe(
      "AppFlowy isn't available right now. Try again later."
    );
    expect(changeFailureReason({ code: ERROR_CODE.INVALID_REQUEST, message: 'user 42 is invalid' }, t)).toBe(
      "This request isn't valid."
    );
  });

  it('shows the copy carried by errors this client raises', () => {
    expect(changeFailureReason(new PlainError('Something changed. Try again.'), t)).toBe('Something changed. Try again.');
    expect(changeFailureReason(new ClientValidationError('ATOMIC_CREATION_OFFLINE'), t)).toBe(
      'Connect to the internet to create this item.'
    );
  });

  it('falls back to a generic reason, never to server text', () => {
    expect(changeFailureReason({ code: 55555, message: 'internal detail 3fa85f64' }, t)).toBe('changeFailure.unknown');
    expect(changeFailureReason({}, t)).toBe('changeFailure.unknown');
  });
});

describe('publicErrorMessage', () => {
  it('returns nothing when only generic guidance would apply', () => {
    expect(publicErrorMessage(new Error('Cannot read properties of undefined'))).toBeUndefined();
    expect(publicErrorMessage({ code: 55555, message: 'internal detail' })).toBeUndefined();
  });
});
