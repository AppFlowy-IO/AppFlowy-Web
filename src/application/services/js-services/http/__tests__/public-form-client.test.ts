import { getPublicFormClient, getPublicFormStoredUser } from '../public-form-client';

const TOKEN_STORAGE_KEY = 'token';
const mockRefreshToken = jest.fn();
const mockInvalidToken = jest.fn();

jest.mock('../gotrue', () => ({
  initGrantService: jest.fn(),
  refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
}));

jest.mock('@/application/session/token', () => ({
  invalidToken: (...args: unknown[]) => mockInvalidToken(...args),
}));

function successfulResponse(): Response {
  return {
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '{}',
  } as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return {
    clone: () => errorResponse(status, body),
    headers: new Headers({ 'Retry-After': '3' }),
    ok: false,
    status,
    statusText: 'Request failed',
    text: async () => JSON.stringify(body),
  } as Response;
}

function transientResponse(status: number, retryAfter?: string): Response {
  return {
    clone: () => transientResponse(status, retryAfter),
    headers: new Headers(retryAfter === undefined ? undefined : { 'Retry-After': retryAfter }),
    ok: false,
    status,
    statusText: 'Transient failure',
    text: async () => '{}',
  } as Response;
}

describe('public form HTTP client', () => {
  const originalFetch = global.fetch;
  const client = getPublicFormClient();

  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps anonymous requests free of authenticated app bootstrap state', async () => {
    const fetchMock = jest.fn().mockResolvedValue(successfulResponse());

    global.fetch = fetchMock as unknown as typeof fetch;
    await client.get('/api/workspace/public-form/test');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][1] as RequestInit;

    expect(new Headers(request.headers).get('Authorization')).toBeNull();
    expect(request.credentials).toBe('same-origin');
  });

  it('forwards an existing valid session without loading the authenticated client', async () => {
    const fetchMock = jest.fn().mockResolvedValue(successfulResponse());

    window.localStorage.setItem(
      TOKEN_STORAGE_KEY,
      JSON.stringify({
        access_token: 'valid-access-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'valid-refresh-token',
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.get('/api/workspace/public-form/test');

    const request = fetchMock.mock.calls[0][1] as RequestInit;

    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer valid-access-token');
  });

  it('reads only a validated local identity for the standalone Form route', () => {
    window.localStorage.setItem(
      TOKEN_STORAGE_KEY,
      JSON.stringify({
        access_token: 'valid-access-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'valid-refresh-token',
        user: { id: ' user-1 ', email: 'nathan@example.com' },
      })
    );

    expect(getPublicFormStoredUser()).toEqual({ id: ' user-1 ', email: 'nathan@example.com' });

    window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ user: { id: '', email: 'nathan@example.com' } }));
    expect(getPublicFormStoredUser()).toBeNull();
  });

  it('serializes POST bodies and caller-supplied idempotency headers', async () => {
    const fetchMock = jest.fn().mockResolvedValue(successfulResponse());

    global.fetch = fetchMock as unknown as typeof fetch;
    await client.post(
      '/api/workspace/public-form/test/submit',
      { answers: {} },
      { headers: { 'Idempotency-Key': 'submission-key' } }
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(request.headers);

    expect(request.method).toBe('POST');
    expect(request.body).toBe('{"answers":{}}');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Idempotency-Key')).toBe('submission-key');
  });

  it('preserves direct JSON errors and response headers for API normalization', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        errorResponse(429, { error: 'token_rate_limited', retry_after_seconds: 3 })
      ) as unknown as typeof fetch;

    await expect(client.post('/api/workspace/public-form/test/submit', { answers: {} })).rejects.toMatchObject({
      name: 'PublicFormHTTPError',
      response: {
        data: { error: 'token_rate_limited', retry_after_seconds: 3 },
        status: 429,
      },
    });
  });

  it('retries transient GET failures with exponential backoff', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(transientResponse(503))
      .mockResolvedValueOnce(successfulResponse());

    global.fetch = fetchMock as unknown as typeof fetch;
    const request = client.get('/api/workspace/public-form/test');

    await jest.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toEqual({ data: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a schema GET after a network failure', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValueOnce(successfulResponse());

    global.fetch = fetchMock as unknown as typeof fetch;
    const request = client.get('/api/workspace/public-form/test');

    await jest.advanceTimersByTimeAsync(1_000);
    await expect(request).resolves.toEqual({ data: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After when retrying a schema GET', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(transientResponse(429, '3'))
      .mockResolvedValueOnce(successfulResponse());

    global.fetch = fetchMock as unknown as typeof fetch;
    const request = client.get('/api/workspace/public-form/test');

    await jest.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toEqual({ data: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a schema GET when the form owner quota is exhausted', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(errorResponse(429, { error: 'user_rate_limited', retry_after_seconds: 3 }));

    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.get('/api/workspace/public-form/test')).rejects.toMatchObject({
      name: 'PublicFormHTTPError',
      response: {
        data: { error: 'user_rate_limited', retry_after_seconds: 3 },
        status: 429,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry mutation POSTs after a transient response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(transientResponse(503));

    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.post('/api/workspace/public-form/test/submit', { answers: {} })).rejects.toMatchObject({
      response: { status: 503 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses a concurrently rotated token after 401 without invalidating the new session', async () => {
    let resolveFirstRequest: ((response: Response) => void) | undefined;
    const firstRequest = new Promise<Response>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const fetchMock = jest.fn().mockReturnValueOnce(firstRequest).mockResolvedValueOnce(successfulResponse());

    window.localStorage.setItem(
      TOKEN_STORAGE_KEY,
      JSON.stringify({
        access_token: 'access-a',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-a',
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const request = client.get('/api/workspace/public-form/test');

    window.localStorage.setItem(
      TOKEN_STORAGE_KEY,
      JSON.stringify({
        access_token: 'access-b',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-b',
      })
    );
    resolveFirstRequest?.(errorResponse(401, { error: 'auth_required' }));

    await expect(request).resolves.toEqual({ data: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).get('Authorization')).toBe(
      'Bearer access-b'
    );
    expect(mockRefreshToken).not.toHaveBeenCalled();
    expect(mockInvalidToken).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '{}').access_token).toBe('access-b');
  });

  it('does not invalidate a new token when an expired-token refresh loses a rotation race', async () => {
    const nextToken = {
      access_token: 'access-b',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'refresh-b',
    };
    const fetchMock = jest.fn().mockResolvedValue(successfulResponse());

    window.localStorage.setItem(
      TOKEN_STORAGE_KEY,
      JSON.stringify({
        access_token: 'access-a',
        expires_at: Math.floor(Date.now() / 1000) - 1,
        refresh_token: 'refresh-a',
      })
    );
    mockRefreshToken.mockImplementationOnce(async () => {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(nextToken));
      throw new Error('refresh-a was already consumed');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.get('/api/workspace/public-form/test')).resolves.toEqual({ data: {} });

    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Authorization')).toBe(
      'Bearer access-b'
    );
    expect(mockInvalidToken).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '{}')).toEqual(nextToken);
  });
});
