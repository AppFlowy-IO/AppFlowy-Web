import { removeSignedOutLocalData } from '@/application/db';
import { emit, EventType } from '@/application/session/event';
import { clearDrainConfig, setCurrentSession } from '@/application/sync-outbox';

import { getToken, getTokenParsed, invalidToken, isTokenValid, saveGoTrueAuth } from '../token';

jest.mock('@/application/session/event', () => ({
  emit: jest.fn(),
  EventType: {
    SESSION_REFRESH: 'session_refresh',
    SESSION_INVALID: 'session_invalid',
  },
}));

jest.mock('@/application/sync-outbox', () => ({
  clearDrainConfig: jest.fn(),
  setCurrentSession: jest.fn(),
}));

jest.mock('@/application/db', () => ({ removeSignedOutLocalData: jest.fn(async () => undefined) }));

const emitMock = jest.mocked(emit);

function encodeBase64Url(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createJWT(payload: Record<string, unknown>): string {
  return `${encodeBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${encodeBase64Url(
    JSON.stringify(payload)
  )}.signature`;
}

function createToken(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'opaque-access-token',
    refresh_token: 'refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', email: 'person@example.com' },
    ...overrides,
  };
}

describe('GoTrue token storage', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('saves and emits a structurally valid opaque token with stored user identity', () => {
    const token = createToken();

    expect(saveGoTrueAuth(JSON.stringify(token))).toBe(true);
    expect(getTokenParsed()).toEqual(token);
    expect(emitMock).toHaveBeenCalledWith(EventType.SESSION_REFRESH, JSON.stringify(token));
  });

  it('derives user identity from a base64url JWT payload', () => {
    const accessToken = createJWT({ sub: 'user-1', email: 'tést@example.com' });

    expect(saveGoTrueAuth(JSON.stringify(createToken({ access_token: accessToken, user: undefined })))).toBe(true);
    expect(getTokenParsed()?.user).toEqual({ id: 'user-1', email: 'tést@example.com' });
  });

  it('rejects an opaque token without a stable user identity', () => {
    const tokenWithoutUser = createToken({ user: undefined });

    expect(saveGoTrueAuth(JSON.stringify(tokenWithoutUser))).toBe(false);
    expect(getTokenParsed()).toBeNull();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('preserves valid stored user fields instead of trusting different JWT claims', () => {
    const accessToken = createJWT({ sub: 'jwt-user', email: 'jwt@example.com' });
    const user = { id: 'response-user', email: 'response@example.com', role: 'owner' };

    expect(saveGoTrueAuth(JSON.stringify(createToken({ access_token: accessToken, user })))).toBe(true);
    expect(getTokenParsed()?.user).toEqual(user);
  });

  it('omits malformed optional user fields from an otherwise valid identity', () => {
    localStorage.setItem('token', JSON.stringify(createToken({ user: { id: 'user-1', email: false } })));

    expect(getTokenParsed()?.user).toEqual({ id: 'user-1' });
    expect(isTokenValid()).toBe(true);
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['a non-object value', JSON.stringify(null)],
    ['a missing access token', JSON.stringify(createToken({ access_token: undefined }))],
    ['an empty refresh token', JSON.stringify(createToken({ refresh_token: '   ' }))],
    ['a non-numeric expiration', JSON.stringify(createToken({ expires_at: 'tomorrow' }))],
    ['a non-finite expiration', '{"access_token":"access","refresh_token":"refresh","expires_at":1e999}'],
  ])('rejects %s without overwriting a valid session', (_label, malformedToken) => {
    const existingToken = JSON.stringify(createToken({ access_token: 'existing-token' }));

    localStorage.setItem('token', existingToken);

    expect(saveGoTrueAuth(malformedToken)).toBe(false);
    expect(localStorage.getItem('token')).toBe(existingToken);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('treats corrupted stored JSON as unauthenticated and removes it', () => {
    localStorage.setItem('token', '{not-json');

    expect(getTokenParsed()).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(isTokenValid()).toBe(false);
  });

  it('removes a stored opaque token with malformed user identity', () => {
    localStorage.setItem('token', JSON.stringify(createToken({ user: { id: 42, email: false } })));

    expect(getTokenParsed()).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(isTokenValid()).toBe(false);
  });

  it('accepts expired tokens so the request layer can refresh them', () => {
    localStorage.setItem('token', JSON.stringify(createToken({ expires_at: 0 })));

    expect(isTokenValid()).toBe(true);
    expect(getTokenParsed()?.refresh_token).toBe('refresh-token');
  });

  it('returns null instead of throwing when storage reads are blocked', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });

    expect(getToken()).toBeNull();
    expect(getTokenParsed()).toBeNull();
    expect(isTokenValid()).toBe(false);

    getItem.mockRestore();
  });

  it('does not emit or throw when storage writes are blocked', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });

    expect(saveGoTrueAuth(JSON.stringify(createToken()))).toBe(false);
    expect(emitMock).not.toHaveBeenCalled();

    setItem.mockRestore();
  });

  it('ends the session without removing local copies unless the user asked for it', async () => {
    localStorage.setItem('token', JSON.stringify(createToken()));

    // Expired sessions, rejected refreshes and failed socket auth all land here.
    // The copies are how edits sent just before (but never applied) reach the
    // server once the same account signs in again.
    invalidToken();
    await Promise.resolve();

    expect(localStorage.getItem('token')).toBeNull();
    expect(setCurrentSession).toHaveBeenCalledWith(null);
    expect(clearDrainConfig).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(EventType.SESSION_INVALID);
    expect(removeSignedOutLocalData).not.toHaveBeenCalled();
  });

  it('signs out immediately and then removes the account’s copies when the user asks for it', async () => {
    localStorage.setItem('token', JSON.stringify(createToken()));

    invalidToken({ removeLocalData: true });
    await Promise.resolve();

    expect(localStorage.getItem('token')).toBeNull();
    expect(setCurrentSession).toHaveBeenCalledWith(null);
    expect(clearDrainConfig).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(EventType.SESSION_INVALID);
    expect(removeSignedOutLocalData).toHaveBeenCalledWith(
      { serverUrl: 'https://test.appflowy.cloud', userId: 'user-1' },
      expect.any(Function)
    );

    const isStillSignedOut = jest.mocked(removeSignedOutLocalData).mock.calls[0][1]!;

    expect(isStillSignedOut()).toBe(true);
    localStorage.setItem('token', JSON.stringify(createToken({ access_token: 'new-session' })));
    expect(isStillSignedOut()).toBe(false);
  });

  it('skips local data removal when no account was signed in', async () => {
    invalidToken({ removeLocalData: true });
    await Promise.resolve();

    expect(removeSignedOutLocalData).not.toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith(EventType.SESSION_INVALID);
  });
});

describe('captured token session lifetime', () => {
  it('preserves token rotation but invalidates a new login even for the same user', async () => {
    const { captureTokenSession, isTokenSessionCurrent } = await import('../token');

    saveGoTrueAuth(JSON.stringify(createToken()));
    const session = captureTokenSession();

    expect(saveGoTrueAuth(JSON.stringify(createToken({ access_token: 'rotated' })), session)).toBe(true);
    expect(isTokenSessionCurrent(session)).toBe(true);
    saveGoTrueAuth(JSON.stringify(createToken()));
    expect(isTokenSessionCurrent(session)).toBe(false);
  });

  it('cannot publish an old refresh into a different account or invalidate that account', async () => {
    const { captureTokenSession, invalidTokenForSession } = await import('../token');

    saveGoTrueAuth(JSON.stringify(createToken()));
    const session = captureTokenSession();

    saveGoTrueAuth(JSON.stringify(createToken({ user: { id: 'other-user' } })));
    expect(saveGoTrueAuth(JSON.stringify(createToken({ access_token: 'late' })), session)).toBe(false);
    invalidTokenForSession(session);
    expect(getTokenParsed()?.user.id).toBe('other-user');
  });
});
