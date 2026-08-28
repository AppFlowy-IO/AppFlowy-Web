import { assertSuccessfulAppFlowyResponse } from './appflowy-response';

describe('assertSuccessfulAppFlowyResponse', () => {
  it('accepts an HTTP success with AppFlowy code zero', () => {
    expect(() =>
      assertSuccessfulAppFlowyResponse({
        bodyText: JSON.stringify({ code: 0, data: null, message: 'success' }),
        ok: true,
        operation: 'Verify user',
        status: 200,
      })
    ).not.toThrow();
  });

  it('rejects an application error returned with HTTP 200', () => {
    expect(() =>
      assertSuccessfulAppFlowyResponse({
        bodyText: JSON.stringify({ code: 1012, message: 'workspace limit reached' }),
        ok: true,
        operation: 'Verify user',
        status: 200,
      })
    ).toThrow('Verify user failed with AppFlowy code 1012: workspace limit reached');
  });

  it('rejects a successful HTTP response without an AppFlowy envelope', () => {
    expect(() =>
      assertSuccessfulAppFlowyResponse({
        bodyText: '<html>unexpected response</html>',
        ok: true,
        operation: 'Verify user',
        status: 200,
      })
    ).toThrow('Verify user returned an invalid AppFlowy response envelope (HTTP 200)');
  });

  it('rejects an HTTP error before accepting its envelope', () => {
    expect(() =>
      assertSuccessfulAppFlowyResponse({
        bodyText: JSON.stringify({ code: 0, message: 'success' }),
        ok: false,
        operation: 'Verify user',
        status: 503,
      })
    ).toThrow('Verify user failed with HTTP 503');
  });
});
