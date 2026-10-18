/**
 * Simulates several browser tabs that share one `localStorage` token but have
 * separate JS module instances (so the per-tab in-flight refresh map cannot
 * deduplicate across them), talking to a GoTrue server with rotating refresh
 * tokens and the default reuse interval.
 */
type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string } };

type GrantError = Error & { isAxiosError: true; response?: { status: number; data: unknown } };

type PendingPost = { refreshToken: string; settle: () => void };

type ApiClient = {
  requestFulfilled: Array<(config: Record<string, unknown>) => Promise<Record<string, unknown>>>;
  responseRejected: Array<((error: unknown) => Promise<unknown>) | undefined>;
};

const mockApiClients: ApiClient[] = [];
const mockPendingPosts: PendingPost[] = [];
let mockGoTrueHandler: (refreshToken: string) => Session = () => {
  throw new Error('no GoTrue handler');
};
let mockNetworkDown = false;

function mockGrantError(status: number | undefined, description: string): GrantError {
  return Object.assign(new Error(status ? `Request failed with status code ${status}` : 'Network Error'), {
    isAxiosError: true as const,
    ...(status ? { response: { status, data: { error: 'invalid_grant', error_description: description } } } : {}),
  });
}

jest.mock('axios', () => {
  const create = (config: { baseURL?: string }) => {
    if (config.baseURL?.includes('gotrue')) {
      return {
        interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
        post: (_url: string, body: { refresh_token: string }) =>
          new Promise((resolve, reject) => {
            mockPendingPosts.push({
              refreshToken: body.refresh_token,
              // The server state is evaluated when the request reaches it.
              settle: () => {
                if (mockNetworkDown) {
                  reject(mockGrantError(undefined, 'offline'));
                  return;
                }

                try {
                  resolve({ data: mockGoTrueHandler(body.refresh_token) });
                } catch (error) {
                  reject(error);
                }
              },
            });
          }),
      };
    }

    const client: ApiClient = { requestFulfilled: [], responseRejected: [] };

    mockApiClients.push(client);
    return {
      interceptors: {
        request: { use: (fulfilled: ApiClient['requestFulfilled'][number]) => client.requestFulfilled.push(fulfilled) },
        response: { use: (_fulfilled: unknown, rejected?: ApiClient['responseRejected'][number]) => client.responseRejected.push(rejected) },
      },
    };
  };

  const isAxiosError = (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError);
  // Every API request is stamped with the tab's server restore generation, which needs its URL.
  const getUri = ({ baseURL = '', url = '' }: { baseURL?: string; url?: string }) =>
    /^https?:/.test(url) ? url : `${baseURL}${url}`;

  return {
    __esModule: true,
    default: { create, getUri, isAxiosError, isCancel: () => false },
    create,
    getUri,
    isAxiosError,
  };
});

jest.mock('@/application/sync-outbox', () => ({ clearDrainConfig: jest.fn(), setCurrentSession: jest.fn() }));
jest.mock('@/application/db', () => ({ removeSignedOutLocalData: jest.fn(async () => undefined) }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

type Tab = {
  request: (url?: string) => Promise<Record<string, unknown>>;
  unauthorized: (error: unknown) => Promise<unknown>;
  signedOut: jest.Mock;
  token: typeof import('@/application/session/token');
  gotrue: typeof import('../gotrue');
  events: typeof import('@/application/session/event');
};

function openTab(): Tab {
  let tab: Tab | undefined;

  jest.isolateModules(() => {
    // Each tab owns separate module state, as separate browser JS contexts do.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require('../core') as typeof import('../core');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const token = require('@/application/session/token') as typeof import('@/application/session/token');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const events = require('@/application/session/event') as typeof import('@/application/session/event');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const gotrue = require('../gotrue') as typeof import('../gotrue');
    const signedOut = jest.fn();

    events.on(events.EventType.SESSION_INVALID, signedOut);
    core.initAPIService({ baseURL: 'https://api.test', gotrueURL: 'https://gotrue.test', wsURL: 'wss://ws.test' });
    const client = mockApiClients[mockApiClients.length - 1];
    const handleUnauthorized = client.responseRejected[0];

    tab = {
      request: (url = '/api/workspace') => client.requestFulfilled[0]({ url, headers: {} }),
      unauthorized: (error) => handleUnauthorized!(error),
      signedOut,
      token,
      gotrue,
      events,
    };
  });

  return tab!;
}

/** GoTrue refresh-token rotation with the default 10 second reuse interval. */
function createGoTrue() {
  let sequence = 0;
  let now = 0;
  const tokens = new Map<string, { userId: string; usedAt?: number; child?: string }>();
  const issue = (userId: string, refreshToken = `refresh-${++sequence}`): Session => {
    tokens.set(refreshToken, tokens.get(refreshToken) ?? { userId });
    return {
      access_token: `access-${++sequence}`,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: userId },
    };
  };

  mockGoTrueHandler = (refreshToken) => {
    const token = tokens.get(refreshToken);

    if (!token) throw mockGrantError(400, 'Invalid Refresh Token: Refresh Token Not Found');
    if (token.usedAt !== undefined) {
      if (now - token.usedAt <= 10_000 && token.child) return issue(token.userId, token.child);
      throw mockGrantError(400, 'Invalid Refresh Token: Already Used');
    }

    const next = issue(token.userId);

    token.usedAt = now;
    token.child = next.refresh_token;
    return next;
  };

  return {
    issue,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function storeExpired(session: Session) {
  localStorage.setItem('token', JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }));
}

function storedToken(): Session | null {
  const raw = localStorage.getItem('token');

  return raw ? (JSON.parse(raw) as Session) : null;
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function settlePost(index = 0) {
  const [post] = mockPendingPosts.splice(index, 1);

  post.settle();
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  mockApiClients.length = 0;
  mockPendingPosts.length = 0;
  mockNetworkDown = false;
});

describe('token refresh across browser tabs', () => {
  it('keeps every tab signed in when a sibling tab already rotated the shared token', async () => {
    const server = createGoTrue();
    const original = server.issue('user-1');
    const tabA = openTab();
    const tabB = openTab();

    storeExpired(original);
    // The laptop wakes: both tabs see the expired token and refresh it at once.
    const requestA = tabA.request();
    const requestB = tabB.request();

    await flush();
    expect(mockPendingPosts.map((post) => post.refreshToken)).toEqual([original.refresh_token, original.refresh_token]);
    await settlePost();
    await settlePost();
    const [configA, configB] = await Promise.all([requestA, requestB]);
    const stored = storedToken();

    expect(stored?.user.id).toBe('user-1');
    expect(stored?.refresh_token).not.toBe(original.refresh_token);
    expect(tabA.signedOut).not.toHaveBeenCalled();
    expect(tabB.signedOut).not.toHaveBeenCalled();
    expect(configA.headers).toEqual({ Authorization: `Bearer ${stored?.access_token}` });
    expect(configB.headers).toEqual({ Authorization: `Bearer ${stored?.access_token}` });
  });

  it('adopts the sibling rotation when the stale refresh is rejected as already used', async () => {
    const server = createGoTrue();
    const original = server.issue('user-1');
    const tabA = openTab();
    const tabB = openTab();

    storeExpired(original);
    const requestA = tabA.request();
    const requestB = tabB.request();

    await flush();
    await settlePost();
    const rotated = storedToken();

    // Tab B's request reaches GoTrue only after the reuse interval.
    server.advance(11_000);
    await settlePost();
    const configB = await requestB;

    await requestA;
    expect(tabB.signedOut).not.toHaveBeenCalled();
    expect(tabA.signedOut).not.toHaveBeenCalled();
    expect(storedToken()).toEqual(rotated);
    expect(configB.headers).toEqual({ Authorization: `Bearer ${rotated?.access_token}` });
  });

  it('neither overwrites nor signs out an account that signed in while a refresh was in flight', async () => {
    const server = createGoTrue();
    const original = server.issue('user-1');
    const otherAccount = server.issue('user-2');
    const tabA = openTab();
    const tabB = openTab();

    storeExpired(original);
    const requestA = tabA.request();

    await flush();
    expect(tabB.token.saveGoTrueAuth(JSON.stringify(otherAccount))).toBe(true);
    await settlePost();

    await expect(requestA).rejects.toThrow('authentication context changed');
    expect(storedToken()).toEqual(otherAccount);
    expect(tabA.signedOut).not.toHaveBeenCalled();
  });

  it('refuses a request when another account signs in right after its refresh, signing nobody out', async () => {
    const server = createGoTrue();
    const original = server.issue('user-1');
    const otherAccount = server.issue('user-2');
    const tabA = openTab();
    const tabB = openTab();

    storeExpired(original);
    // Tab B's sign-in lands just after tab A stored its refreshed token, before tab A's request
    // continues: only the request's own account check can still stop it.
    tabA.events.on(tabA.events.EventType.SESSION_REFRESH, () => {
      expect(tabB.token.saveGoTrueAuth(JSON.stringify(otherAccount))).toBe(true);
    });
    const requestA = tabA.request();

    await flush();
    await settlePost();

    await expect(requestA).rejects.toThrow('Request session changed');
    expect(storedToken()).toEqual(otherAccount);
    expect(tabA.signedOut).not.toHaveBeenCalled();
    expect(tabB.signedOut).not.toHaveBeenCalled();
  });

  it('refuses to refresh a token that was already replaced, without asking GoTrue or signing out', async () => {
    const server = createGoTrue();
    const original = server.issue('user-1');
    const rotated = server.issue('user-1');
    const tab = openTab();

    localStorage.setItem('token', JSON.stringify(rotated));
    // A caller that read the token before it rotated (such as the realtime socket) refreshes it late.
    const outcome = tab.gotrue.refreshToken(original.refresh_token).then(() => 'refreshed', (error: unknown) => error);

    await flush();
    expect(mockPendingPosts).toHaveLength(0);
    const error = await outcome;

    // A changed session, not a rejected refresh: no caller may end the current login for it.
    expect(tab.gotrue.isAuthSessionChangedError(error)).toBe(true);
    expect(tab.gotrue.isDefinitiveRefreshFailure(error)).toBe(false);
    expect(storedToken()).toEqual(rotated);
    expect(tab.signedOut).not.toHaveBeenCalled();
  });

  it('does not restore a session that was signed out while its refresh was in flight', async () => {
    const server = createGoTrue();
    const original = server.issue('user-1');
    const tabA = openTab();
    const tabB = openTab();

    storeExpired(original);
    const requestA = tabA.request();

    await flush();
    tabB.token.invalidToken();
    await settlePost();

    await expect(requestA).rejects.toThrow('authentication context changed');
    expect(storedToken()).toBeNull();
  });

  it('keeps the session when the refresh fails because the network is unavailable', async () => {
    const server = createGoTrue();
    const original = server.issue('user-1');
    const tab = openTab();

    storeExpired(original);
    mockNetworkDown = true;
    const request = tab.request();

    await flush();
    await settlePost();
    await expect(request).rejects.toThrow('Network Error');
    expect(tab.signedOut).not.toHaveBeenCalled();
    expect(storedToken()?.refresh_token).toBe(original.refresh_token);

    // The next request after the network returns refreshes normally.
    mockNetworkDown = false;
    const retry = tab.request();

    await flush();
    await settlePost();
    expect((await retry).headers).toEqual({ Authorization: `Bearer ${storedToken()?.access_token}` });
    expect(storedToken()?.refresh_token).not.toBe(original.refresh_token);
  });

  it('keeps the session when a 401 retry hits a transient refresh failure', async () => {
    const server = createGoTrue();
    const original = server.issue('user-1');
    const tab = openTab();
    const unauthorized = Object.assign(new Error('401'), { isAxiosError: true, response: { status: 401 } });

    localStorage.setItem('token', JSON.stringify(original));
    mockNetworkDown = true;
    const handled = tab.unauthorized(unauthorized);

    await flush();
    await settlePost();
    await expect(handled).rejects.toBe(unauthorized);
    expect(tab.signedOut).not.toHaveBeenCalled();
    expect(storedToken()).toEqual(original);
  });

  it('still signs out when GoTrue rejects the only stored refresh token', async () => {
    createGoTrue();
    const tab = openTab();

    storeExpired({ access_token: 'unknown', refresh_token: 'revoked', expires_at: 0, user: { id: 'user-1' } });
    const request = tab.request();

    await flush();
    await settlePost();
    // The ended login's request is not sent at all (main's contract), and the session ends.
    await expect(request).rejects.toThrow('Request failed with status code 400');
    expect(tab.signedOut).toHaveBeenCalledTimes(1);
    expect(storedToken()).toBeNull();
  });
});
