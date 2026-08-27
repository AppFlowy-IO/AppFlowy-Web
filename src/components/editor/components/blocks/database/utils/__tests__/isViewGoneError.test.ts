import { isViewGoneError } from '../databaseBlockUtils';

describe('isViewGoneError', () => {
  it('recognizes server record-not-found responses', () => {
    // RecordNotFound app error code with HTTP 404
    expect(isViewGoneError({ code: -2, message: 'Record not exist in db.', httpStatus: 404 })).toBe(true);
    // RecordDeleted app error code with HTTP 410
    expect(isViewGoneError({ code: -4, message: 'Record deleted', httpStatus: 410 })).toBe(true);
    // Raw HTTP status propagated as code (no app error body)
    expect(isViewGoneError({ code: 404, message: 'Request failed' })).toBe(true);
    // Message-only fallback
    expect(isViewGoneError({ code: -1, message: 'View not found' })).toBe(true);
  });

  it('rejects transient and permission errors', () => {
    expect(isViewGoneError({ code: -1, message: 'Network error' })).toBe(false);
    expect(isViewGoneError({ code: 500, message: 'Internal server error', httpStatus: 500 })).toBe(false);
    expect(isViewGoneError({ code: 1012, message: 'Not enough permissions', httpStatus: 403 })).toBe(false);
    expect(isViewGoneError(undefined)).toBe(false);
    expect(isViewGoneError('not found')).toBe(false);
  });
});
