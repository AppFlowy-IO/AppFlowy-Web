const mockGrantClient = {
  defaults: {
    baseURL: '',
  },
  interceptors: {
    request: {
      use: jest.fn(),
    },
  },
  post: jest.fn(),
};

const mockAxiosCreate = jest.fn((config?: { baseURL?: string }) => {
  mockGrantClient.defaults.baseURL = config?.baseURL || '';
  return mockGrantClient;
});

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

const { signInWithUrl } = require('../auth-api') as typeof import('../auth-api');
const {
  initGrantService,
  signInDiscord,
  signInGithub,
  signInGoogle,
  signInOTP,
  signInWithPassword,
} = require('../gotrue') as typeof import('../gotrue');
const { verifyToken } = require('../cloud-auth') as { verifyToken: jest.Mock };
const { saveGoTrueAuth } = require('@/application/session/token') as { saveGoTrueAuth: jest.Mock };

type AuthVariant = 'password' | 'oauth' | 'otp';

describe('GoTrue login token completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGrantClient.post.mockReset();
    localStorage.clear();
    initGrantService('http://localhost/gotrue');
  });

  it('refreshes and saves the token after AppFlowy Cloud verifies the password login token', async () => {
    const loginToken = {
      access_token: 'login-access-token',
      expires_at: 123,
      refresh_token: 'login-refresh-token',
    };
    const refreshedToken = {
      access_token: 'refreshed-access-token',
      expires_at: 456,
      refresh_token: 'refreshed-refresh-token',
    };

    mockGrantClient.post
      .mockResolvedValueOnce({ data: loginToken })
      .mockResolvedValueOnce({ data: refreshedToken });
    (verifyToken as jest.Mock).mockResolvedValueOnce({ is_new: false });

    await signInWithPassword({
      email: 'admin@example.com',
      password: 'password',
      redirectTo: '/app',
    });

    expect(mockGrantClient.post).toHaveBeenNthCalledWith(1, '/token?grant_type=password', {
      email: 'admin@example.com',
      password: 'password',
    });
    expect(verifyToken).toHaveBeenCalledWith(loginToken.access_token);
    expect(mockGrantClient.post).toHaveBeenNthCalledWith(2, '/token?grant_type=refresh_token', {
      refresh_token: loginToken.refresh_token,
    });
    expect(saveGoTrueAuth).toHaveBeenCalledTimes(1);
    expect(saveGoTrueAuth).toHaveBeenCalledWith(JSON.stringify(refreshedToken));
  });

  it('uses the same verify-refresh-save flow for OAuth callback tokens', async () => {
    const refreshedToken = {
      access_token: 'oauth-refreshed-access-token',
      expires_at: 456,
      refresh_token: 'oauth-refreshed-refresh-token',
    };

    mockGrantClient.post.mockResolvedValueOnce({ data: refreshedToken });
    verifyToken.mockResolvedValueOnce({ is_new: false });

    await signInWithUrl('http://localhost/auth/callback#access_token=oauth-access-token&refresh_token=oauth-refresh-token');

    expect(verifyToken).toHaveBeenCalledWith('oauth-access-token');
    expect(mockGrantClient.post).toHaveBeenCalledWith('/token?grant_type=refresh_token', {
      refresh_token: 'oauth-refresh-token',
    });
    expect(saveGoTrueAuth).toHaveBeenCalledTimes(1);
    expect(saveGoTrueAuth).toHaveBeenCalledWith(JSON.stringify(refreshedToken));
  });

  it('uses the same verify-refresh-save flow for email OTP tokens', async () => {
    const otpToken = {
      access_token: 'otp-access-token',
      expires_at: 123,
      refresh_token: 'otp-refresh-token',
    };
    const refreshedToken = {
      access_token: 'otp-refreshed-access-token',
      expires_at: 456,
      refresh_token: 'otp-refreshed-refresh-token',
    };

    mockGrantClient.post
      .mockResolvedValueOnce({ data: otpToken })
      .mockResolvedValueOnce({ data: refreshedToken });
    verifyToken.mockResolvedValueOnce({ is_new: false });

    await signInOTP({
      email: 'admin@example.com',
      code: '123456',
    });

    expect(mockGrantClient.post).toHaveBeenNthCalledWith(1, '/verify', {
      email: 'admin@example.com',
      token: '123456',
      type: 'magiclink',
    });
    expect(verifyToken).toHaveBeenCalledWith(otpToken.access_token);
    expect(mockGrantClient.post).toHaveBeenNthCalledWith(2, '/token?grant_type=refresh_token', {
      refresh_token: otpToken.refresh_token,
    });
    expect(saveGoTrueAuth).toHaveBeenCalledTimes(1);
    expect(saveGoTrueAuth).toHaveBeenCalledWith(JSON.stringify(refreshedToken));
  });

  it.each<AuthVariant>(['password', 'oauth', 'otp'])(
    'rejects and skips refresh/save when AppFlowy Cloud verification fails for %s sign-in',
    async (variant) => {
      const initialToken = createToken(`${variant}-initial`);

      queueInitialSignInResponse(variant, initialToken);
      verifyToken.mockRejectedValueOnce({
        code: 401,
        message: 'Backend says no [request-id]',
      });

      await expect(runAuthVariant(variant, initialToken)).rejects.toEqual(expectedVerifyError(variant));
      expect(refreshTokenCalls()).toHaveLength(0);
      expect(saveGoTrueAuth).not.toHaveBeenCalled();
    }
  );

  it.each<AuthVariant>(['password', 'oauth', 'otp'])(
    'clears an existing token before verifying %s sign-in',
    async (variant) => {
      const initialToken = createToken(`${variant}-initial`);
      const refreshedToken = createToken(`${variant}-refreshed`);
      const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');

      localStorage.setItem('token', 'old-token');
      queueInitialSignInResponse(variant, initialToken);
      queueRefreshResponse(refreshedToken);
      verifyToken.mockResolvedValueOnce({ is_new: false });

      try {
        await runAuthVariant(variant, initialToken);

        const tokenRemoveCallIndex = removeItemSpy.mock.calls.findIndex(([key]) => key === 'token');

        expect(tokenRemoveCallIndex).toBeGreaterThanOrEqual(0);
        expect(removeItemSpy.mock.invocationCallOrder[tokenRemoveCallIndex])
          .toBeLessThan(verifyToken.mock.invocationCallOrder[0]);
      } finally {
        removeItemSpy.mockRestore();
      }
    }
  );
});

describe('GoTrue provider redirects', () => {
  const assign = jest.fn();
  const originalLocation = window.location;

  beforeAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        assign,
      },
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    initGrantService('http://localhost/gotrue');
  });

  it('navigates Google OAuth in the current tab', () => {
    signInGoogle('http://localhost/auth/callback');

    expect(assign).toHaveBeenCalledWith(
      'http://localhost/gotrue/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%2Fauth%2Fcallback'
    );
  });

  it('navigates other OAuth providers in the current tab', () => {
    signInGithub('http://localhost/auth/callback');
    signInDiscord('http://localhost/auth/callback');

    expect(assign).toHaveBeenNthCalledWith(
      1,
      'http://localhost/gotrue/authorize?provider=github&redirect_to=http%3A%2F%2Flocalhost%2Fauth%2Fcallback'
    );
    expect(assign).toHaveBeenNthCalledWith(
      2,
      'http://localhost/gotrue/authorize?provider=discord&redirect_to=http%3A%2F%2Flocalhost%2Fauth%2Fcallback'
    );
  });
});

function createToken(prefix: string) {
  return {
    access_token: `${prefix}-access-token`,
    expires_at: 123,
    refresh_token: `${prefix}-refresh-token`,
  };
}

function queueInitialSignInResponse(variant: AuthVariant, token: ReturnType<typeof createToken>) {
  if (variant !== 'oauth') {
    mockGrantClient.post.mockResolvedValueOnce({ data: token });
  }
}

function queueRefreshResponse(token: ReturnType<typeof createToken>) {
  mockGrantClient.post.mockResolvedValueOnce({ data: token });
}

function refreshTokenCalls() {
  return mockGrantClient.post.mock.calls.filter(([url]) => url === '/token?grant_type=refresh_token');
}

function expectedVerifyError(variant: AuthVariant) {
  switch (variant) {
    case 'password':
      return { code: 401, message: 'Backend says no' };
    case 'oauth':
      return { code: 401, message: 'Verify token failed' };
    case 'otp':
      return { code: 401, message: 'Failed to create user account' };
  }
}

function runAuthVariant(variant: AuthVariant, token: ReturnType<typeof createToken>) {
  switch (variant) {
    case 'password':
      return signInWithPassword({
        email: 'admin@example.com',
        password: 'password',
        redirectTo: '/app',
      });
    case 'oauth':
      return signInWithUrl(
        `http://localhost/auth/callback#access_token=${token.access_token}&refresh_token=${token.refresh_token}`
      );
    case 'otp':
      return signInOTP({
        email: 'admin@example.com',
        code: '123456',
      });
  }
}
