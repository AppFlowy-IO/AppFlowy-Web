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

const { signInWithUrl } = require('../auth-api') as typeof import('../auth-api');
const { initGrantService, signInOTP, signInWithPassword } = require('../gotrue') as typeof import('../gotrue');
const { verifyToken } = require('../cloud-auth') as { verifyToken: jest.Mock };
const { saveGoTrueAuth } = require('@/application/session/token') as { saveGoTrueAuth: jest.Mock };

describe('GoTrue login token completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
