import { emit, EventType } from '@/application/session/event';

import { getToken, getTokenParsed, isTokenValid, saveGoTrueAuth } from '../token';

jest.mock('@/application/session/event', () => ({
  emit: jest.fn(),
  EventType: {
    SESSION_REFRESH: 'session_refresh',
    SESSION_INVALID: 'session_invalid',
  },
}));

jest.mock('@/application/sync-outbox', () => ({
  purgeAllOutbox: jest.fn(() => Promise.resolve()),
}));

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
    emitMock.mockClear();
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
});
