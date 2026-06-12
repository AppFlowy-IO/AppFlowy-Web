import { act, renderHook, waitFor } from '@testing-library/react';

import { getTokenParsed } from '@/application/session/token';

import { useAppflowyWebSocket, Options } from '../useAppflowyWebSocket';

// Stable return value: useWebSocket must hand back the same object/functions
// across renders, like the real library does for an unchanged connection.
const stableSendMessage = jest.fn();
const stableGetWebSocket = jest.fn(() => null);
const mockUseWebSocket = jest.fn(() => ({
  lastMessage: null,
  sendMessage: stableSendMessage,
  readyState: 1,
  getWebSocket: stableGetWebSocket,
}));

jest.mock('react-use-websocket', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseWebSocket(...(args as [])),
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
  invalidToken: jest.fn(),
}));

jest.mock('@/application/services/js-services/http/gotrue', () => ({
  refreshToken: jest.fn(),
}));

const mockGetTokenParsed = getTokenParsed as jest.Mock;

const futureExpiry = () => Math.floor(Date.now() / 1000) + 3600;

const setStoredToken = (accessToken: string) => {
  mockGetTokenParsed.mockReturnValue({
    access_token: accessToken,
    refresh_token: 'refresh-token',
    expires_at: futureExpiry(),
  });
};

const lastSocketUrl = (): string => {
  const calls = mockUseWebSocket.mock.calls as unknown as [string][];

  return calls[calls.length - 1][0];
};

const lastSocketOptions = () => {
  const calls = mockUseWebSocket.mock.calls as unknown as [
    string,
    { shouldReconnect?: (event: CloseEvent) => boolean }
  ][];

  return calls[calls.length - 1][1];
};

const baseOptions: Options = {
  workspaceId: 'workspace-1',
  clientId: 7,
  deviceId: 'device-1',
};

describe('useAppflowyWebSocket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setStoredToken('token-A');
  });

  it('connects with the session token in the socket URL', () => {
    renderHook(() => useAppflowyWebSocket(baseOptions));

    expect(lastSocketUrl()).toContain('token=token-A');
    expect(lastSocketUrl()).toContain('/workspace-1/');
  });

  // Reproduces the silent-reconnect bug: the HTTP layer refreshing the stored
  // token must NOT change the socket URL on the next render — a URL change
  // makes react-use-websocket tear down and reopen the connection, bypassing
  // the throttled nonce reconnect path entirely.
  it('keeps the socket URL stable when the stored token is refreshed mid-session', () => {
    const { rerender } = renderHook(() => useAppflowyWebSocket(baseOptions));

    const initialUrl = lastSocketUrl();

    setStoredToken('token-B');
    rerender();

    expect(lastSocketUrl()).toBe(initialUrl);
  });

  // Guards the load-bearing counterpart of the test above: an explicit
  // reconnect MUST pick up the freshest stored token, since the old one may
  // have been rotated or expired while the socket was down.
  it('uses the freshest stored token when a reconnect is triggered', async () => {
    const { result } = renderHook(() => useAppflowyWebSocket(baseOptions));

    setStoredToken('token-B');

    act(() => {
      result.current.reconnect();
    });

    await waitFor(() => {
      expect(lastSocketUrl()).toContain('_rc=1');
    });

    expect(lastSocketUrl()).toContain('token=token-B');
  });

  it('uses the freshest stored token when react-use-websocket schedules an automatic retry', async () => {
    renderHook(() => useAppflowyWebSocket(baseOptions));

    setStoredToken('token-B');

    act(() => {
      expect(lastSocketOptions().shouldReconnect?.({ code: 1006, reason: 'abnormal close' } as CloseEvent)).toBe(true);
    });

    await waitFor(() => {
      expect(lastSocketUrl()).toContain('token=token-B');
    });

    expect(lastSocketUrl()).not.toContain('_rc=');
  });

  // Reproduces the per-message fan-out amplifier: the hook returned a fresh
  // object literal every render, so every consumer of the hook value (and the
  // SyncInternalContext built from it) re-rendered even when nothing changed.
  it('returns a referentially stable value across re-renders with equivalent options', () => {
    const { result, rerender } = renderHook(({ options }) => useAppflowyWebSocket(options), {
      initialProps: { options: { ...baseOptions } },
    });

    const first = result.current;

    // New options object with identical values, as produced by an inline
    // object literal in the calling component.
    rerender({ options: { ...baseOptions } });

    expect(result.current).toBe(first);
  });

  it('keeps sendMessage and reconnect referentially stable across re-renders', () => {
    const { result, rerender } = renderHook(({ options }) => useAppflowyWebSocket(options), {
      initialProps: { options: { ...baseOptions } },
    });

    const { sendMessage, reconnect } = result.current;

    rerender({ options: { ...baseOptions } });

    expect(result.current.sendMessage).toBe(sendMessage);
    expect(result.current.reconnect).toBe(reconnect);
  });
});
