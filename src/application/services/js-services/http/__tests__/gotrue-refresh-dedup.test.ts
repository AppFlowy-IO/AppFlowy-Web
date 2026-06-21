const mockGrantClient = {
  interceptors: {
    request: {
      use: jest.fn(),
    },
  },
  post: jest.fn(),
};

const mockAxiosCreate = jest.fn(() => mockGrantClient);

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: mockAxiosCreate,
  },
  create: mockAxiosCreate,
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
  saveGoTrueAuth: jest.fn(),
}));

jest.mock('../cloud-auth', () => ({
  verifyToken: jest.fn(),
}));

jest.mock('@/utils/log', () => ({
  Log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const { initGrantService, refreshToken } = require('../gotrue') as typeof import('../gotrue');
const { saveGoTrueAuth } = require('@/application/session/token') as { saveGoTrueAuth: jest.Mock };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

const refreshedToken = {
  access_token: 'refreshed-access-token',
  expires_at: 456,
  refresh_token: 'refreshed-refresh-token',
};

describe('refreshToken concurrent deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGrantClient.post.mockReset();
    initGrantService('http://localhost/gotrue');
  });

  // Reproduces the refresh stampede: when the access token expires, every
  // concurrent in-flight API request independently triggers a refresh. With a
  // token-rotating server, the second POST sends an already-consumed refresh
  // token and gets rejected, forcing a logout. All concurrent callers must
  // share a single network request.
  it('shares one network request among concurrent calls with the same refresh token', async () => {
    const deferred = createDeferred<{ data: typeof refreshedToken }>();

    mockGrantClient.post.mockReturnValue(deferred.promise);

    const first = refreshToken('stored-refresh-token');
    const second = refreshToken('stored-refresh-token');

    deferred.resolve({ data: refreshedToken });

    const [firstToken, secondToken] = await Promise.all([first, second]);

    expect(mockGrantClient.post).toHaveBeenCalledTimes(1);
    expect(firstToken).toEqual(refreshedToken);
    expect(secondToken).toEqual(refreshedToken);
    expect(saveGoTrueAuth).toHaveBeenCalledTimes(1);
  });

  it('issues a new request once the previous refresh has settled', async () => {
    mockGrantClient.post.mockResolvedValue({ data: refreshedToken });

    await refreshToken('stored-refresh-token');
    await refreshToken('stored-refresh-token');

    expect(mockGrantClient.post).toHaveBeenCalledTimes(2);
  });

  it('does not dedupe calls made with different refresh tokens', async () => {
    mockGrantClient.post.mockResolvedValue({ data: refreshedToken });

    await Promise.all([refreshToken('token-A'), refreshToken('token-B')]);

    expect(mockGrantClient.post).toHaveBeenCalledTimes(2);
  });

  it('keeps dedupe entries for earlier tokens when a different token refresh interleaves', async () => {
    const deferredA = createDeferred<{ data: typeof refreshedToken }>();
    const deferredB = createDeferred<{ data: typeof refreshedToken }>();
    const tokenARefresh = {
      ...refreshedToken,
      access_token: 'token-A-access-token',
      refresh_token: 'token-A-next-refresh-token',
    };
    const tokenBRefresh = {
      ...refreshedToken,
      access_token: 'token-B-access-token',
      refresh_token: 'token-B-next-refresh-token',
    };

    mockGrantClient.post.mockImplementation((_url: string, body: { refresh_token: string }) => {
      if (body.refresh_token === 'token-A') return deferredA.promise;
      if (body.refresh_token === 'token-B') return deferredB.promise;
      return Promise.reject(new Error(`unexpected refresh token: ${body.refresh_token}`));
    });

    const firstA = refreshToken('token-A');
    const firstB = refreshToken('token-B');
    const secondA = refreshToken('token-A');

    expect(mockGrantClient.post).toHaveBeenCalledTimes(2);
    expect(mockGrantClient.post).toHaveBeenNthCalledWith(1, '/token?grant_type=refresh_token', {
      refresh_token: 'token-A',
    });
    expect(mockGrantClient.post).toHaveBeenNthCalledWith(2, '/token?grant_type=refresh_token', {
      refresh_token: 'token-B',
    });

    deferredA.resolve({ data: tokenARefresh });
    deferredB.resolve({ data: tokenBRefresh });

    await expect(firstA).resolves.toEqual(tokenARefresh);
    await expect(secondA).resolves.toEqual(tokenARefresh);
    await expect(firstB).resolves.toEqual(tokenBRefresh);
    expect(saveGoTrueAuth).toHaveBeenCalledTimes(2);
  });

  it('propagates a shared failure to all concurrent callers and allows a retry', async () => {
    const deferred = createDeferred<never>();

    mockGrantClient.post.mockReturnValueOnce(deferred.promise);

    const first = refreshToken('stored-refresh-token');
    const second = refreshToken('stored-refresh-token');

    const failure = new Error('refresh failed');

    deferred.reject(failure);

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(mockGrantClient.post).toHaveBeenCalledTimes(1);

    // The failed in-flight entry must be cleared so a later call can retry.
    mockGrantClient.post.mockResolvedValueOnce({ data: refreshedToken });
    await expect(refreshToken('stored-refresh-token')).resolves.toEqual(refreshedToken);
    expect(mockGrantClient.post).toHaveBeenCalledTimes(2);
  });
});
