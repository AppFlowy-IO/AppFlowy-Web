const mockGrantClient = {
  interceptors: {
    response: { use: jest.fn() },
    request: { use: jest.fn() },
  },
  get: jest.fn(),
  post: jest.fn(),
};

const mockAxiosCreate = jest.fn(() => mockGrantClient);

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: mockAxiosCreate },
  create: mockAxiosCreate,
}));

jest.mock('@/application/session/token', () => ({
  captureTokenSession: jest.fn(() => ({ generation: 1, userId: null })),
  getTokenParsed: jest.fn(() => ({ access_token: 'access-token' })),
  invalidToken: jest.fn(),
  saveGoTrueAuth: jest.fn(() => true),
}));

jest.mock('../cloud-auth', () => ({ verifyToken: jest.fn() }));

jest.mock('@/utils/log', () => ({
  Log: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const { changePassword, getUserAuthInfo, initGrantService } = require('../gotrue') as typeof import('../gotrue');

const authHeaders = expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token' }) });

describe('GoTrue password requests', () => {
  beforeEach(() => {
    mockGrantClient.get.mockReset();
    mockGrantClient.post.mockReset().mockResolvedValue({ data: {} });
    initGrantService('http://localhost/gotrue');
  });

  it('does not send the new password as the current password', async () => {
    await changePassword({ password: 'New-password123!' });

    expect(mockGrantClient.post).toHaveBeenCalledWith(
      '/user/change-password',
      { password: 'New-password123!' },
      authHeaders
    );
  });

  it('sends the current password when one is given', async () => {
    await changePassword({ password: 'New-password123!', currentPassword: 'Old-password123!' });

    expect(mockGrantClient.post).toHaveBeenCalledWith(
      '/user/change-password',
      { password: 'New-password123!', current_password: 'Old-password123!' },
      authHeaders
    );
  });

  it('reads whether GoTrue requires the current password', async () => {
    const authInfo = { has_password: true, is_sso_user: false, is_non_default_password: true };

    mockGrantClient.get.mockResolvedValueOnce({ data: authInfo });

    await expect(getUserAuthInfo()).resolves.toEqual(authInfo);
    expect(mockGrantClient.get).toHaveBeenCalledWith('/user/auth-info', authHeaders);
  });

  it('keeps the GoTrue identity of an auth-info failure', async () => {
    mockGrantClient.get.mockRejectedValueOnce({
      isAxiosError: true,
      sourceDomain: 'gotrue',
      response: { status: 404, data: { code: 404, msg: 'Not found' } },
    });

    await expect(getUserAuthInfo()).rejects.toMatchObject({ sourceDomain: 'gotrue', httpStatus: 404 });
  });
});
