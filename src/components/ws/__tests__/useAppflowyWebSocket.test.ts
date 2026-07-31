import { act, renderHook, waitFor } from '@testing-library/react';

import { getTokenParsed } from '@/application/session/token';

import { useAppflowyWebSocket, Options } from '../useAppflowyWebSocket';

// Stable return value: useWebSocket must hand back the same object/functions
// across renders, like the real library does for an unchanged connection.
const stableSendMessage = jest.fn();
const stableGetWebSocket = jest.fn(() => null);
let mockReadyState = 1;
const mockUseWebSocket = jest.fn(() => ({
  lastMessage: null,
  sendMessage: stableSendMessage,
  readyState: mockReadyState,
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

type SocketUrl = string | (() => string | Promise<string>);

const lastSocketInput = (): SocketUrl => {
  const calls = mockUseWebSocket.mock.calls as unknown as [SocketUrl][];

  return calls[calls.length - 1][0];
};

const resolveLastSocketUrl = async (): Promise<string> => {
  const input = lastSocketInput();

  return typeof input === 'function' ? input() : input;
};

const lastSocketOptions = () => {
  const calls = mockUseWebSocket.mock.calls as unknown as [
    string,
    {
      shouldReconnect?: (event: CloseEvent) => boolean;
      reconnectInterval?: (attemptNumber: number) => number;
    }
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
    mockReadyState = 1;
    setStoredToken('token-A');
  });

  it('connects with the session token in the socket URL', async () => {
    renderHook(() => useAppflowyWebSocket(baseOptions));

    expect(await resolveLastSocketUrl()).toContain('token=token-A');
    expect(await resolveLastSocketUrl()).toContain('/workspace-1/');
  });

  // A token rotation must not replace the URL callback during a live session,
  // but the next actual connection attempt must read the rotated token.
  it('keeps the socket input stable while resolving the freshest token', async () => {
    const { rerender } = renderHook(() => useAppflowyWebSocket(baseOptions));

    const initialInput = lastSocketInput();

    setStoredToken('token-B');
    rerender();

    expect(lastSocketInput()).toBe(initialInput);
    expect(await resolveLastSocketUrl()).toContain('token=token-B');
  });

  // Guards the load-bearing counterpart of the test above: an explicit
  // reconnect MUST pick up the freshest stored token, since the old one may
  // have been rotated or expired while the socket was down.
  it('uses the freshest stored token when a reconnect is triggered', async () => {
    mockReadyState = 3;
    const { result } = renderHook(() => useAppflowyWebSocket(baseOptions));

    setStoredToken('token-B');

    act(() => {
      result.current.reconnect();
    });

    await waitFor(async () => {
      expect(await resolveLastSocketUrl()).toContain('_rc=1');
    });

    expect(await resolveLastSocketUrl()).toContain('token=token-B');
  });

  it('uses the freshest stored token when react-use-websocket schedules an automatic retry', async () => {
    renderHook(() => useAppflowyWebSocket(baseOptions));
    const initialInput = lastSocketInput();

    setStoredToken('token-B');

    act(() => {
      expect(lastSocketOptions().shouldReconnect?.({ code: 1006, reason: 'abnormal close' } as CloseEvent)).toBe(true);
    });

    expect(lastSocketInput()).toBe(initialInput);
    expect(await resolveLastSocketUrl()).toContain('token=token-B');
    expect(await resolveLastSocketUrl()).not.toContain('_rc=');
  });

  it('does not start a nonce reconnect while an automatic retry is pending', async () => {
    mockReadyState = 3;
    const { result } = renderHook(() => useAppflowyWebSocket(baseOptions));
    const socketOptions = lastSocketOptions();

    act(() => {
      expect(socketOptions.shouldReconnect?.({ code: 1006, reason: 'abnormal close' } as CloseEvent)).toBe(true);
      socketOptions.reconnectInterval?.(0);
    });

    act(() => {
      result.current.reconnect();
    });

    expect(await resolveLastSocketUrl()).not.toContain('_rc=');
  });

  it('does not let browser recovery events bypass a scheduled retry', async () => {
    mockReadyState = 3;
    renderHook(() => useAppflowyWebSocket(baseOptions));
    const socketOptions = lastSocketOptions();

    act(() => {
      expect(socketOptions.shouldReconnect?.({ code: 1006, reason: 'abnormal close' } as CloseEvent)).toBe(true);
      socketOptions.reconnectInterval?.(0);
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(await resolveLastSocketUrl()).not.toContain('_rc=');
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

  it('does not open or buffer a websocket from a follower tab', () => {
    const { result } = renderHook(() => useAppflowyWebSocket({ ...baseOptions, connect: false }));

    act(() => {
      result.current.sendMessage({ collabMessage: {} }, true);
    });

    const calls = mockUseWebSocket.mock.calls as unknown as [SocketUrl, unknown, boolean][];

    expect(calls[calls.length - 1][2]).toBe(false);
    expect(stableSendMessage).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('keeps retained senders stable and adopts the latest leadership buffering policy', () => {
    const { result, rerender } = renderHook(
      ({ connect }) => useAppflowyWebSocket({ ...baseOptions, connect }),
      { initialProps: { connect: false } }
    );
    const retainedSendMessage = result.current.sendMessage;

    act(() => {
      retainedSendMessage({ collabMessage: {} }, true);
    });
    expect(stableSendMessage).toHaveBeenLastCalledWith(expect.anything(), false);

    stableSendMessage.mockClear();
    rerender({ connect: true });

    expect(result.current.sendMessage).toBe(retainedSendMessage);
    act(() => {
      retainedSendMessage({ collabMessage: {} }, true);
    });
    expect(stableSendMessage).toHaveBeenCalledWith(expect.anything(), true);
  });
});
