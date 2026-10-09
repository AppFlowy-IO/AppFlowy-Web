import { act, renderHook, waitFor } from '@testing-library/react';

import { getTokenParsed } from '@/application/session/token';
import type { RepairRequest, RepairUpdate } from '@/application/collab-repair/types';
import { messages } from '@/proto/messages';

import { useAppflowyWebSocket, Options } from '../useAppflowyWebSocket';

// Stable return value: useWebSocket must hand back the same object/functions
// across renders, like the real library does for an unchanged connection.
const stableSendMessage = jest.fn();
const stableGetWebSocket = jest.fn<WebSocket | null, []>(() => null);
let mockReadyState = 1;
let mockLastMessage: MessageEvent | null = null;
const mockUseWebSocket = jest.fn(() => ({
  lastMessage: mockLastMessage,
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
      onMessage?: (event: MessageEvent) => void;
      onOpen?: () => void;
      onClose?: (event: CloseEvent) => void;
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

beforeEach(() => {
  jest.clearAllMocks();
  mockReadyState = 1;
  mockLastMessage = null;
  stableGetWebSocket.mockReturnValue(null);
  setStoredToken('token-A');
});

afterEach(() => jest.restoreAllMocks());

describe('useAppflowyWebSocket', () => {
  it('connects with the session token in the socket URL', async () => {
    renderHook(() => useAppflowyWebSocket(baseOptions));

    expect(await resolveLastSocketUrl()).toContain('token=token-A');
    expect(await resolveLastSocketUrl()).toContain('background_repair=1');
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
    const { result, rerender } = renderHook(({ connect }) => useAppflowyWebSocket({ ...baseOptions, connect }), {
      initialProps: { connect: false },
    });
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

test('delivers every repair frame directly without relying on React lastMessage coalescing', () => {
  const { result } = renderHook(() => useAppflowyWebSocket(baseOptions));
  const listener = jest.fn();
  const unsubscribe = result.current.subscribeRepairRequests!(listener);
  const frame = messages.Message.encode({
    collabMessage: {
      objectId: '11111111-1111-1111-1111-111111111111',
      collabType: 0,
      repairRequest: {
        requestId: '22222222-2222-2222-2222-222222222222',
        stateVector: new Uint8Array([0]),
        maxUpdateBytes: 1024,
      },
    },
  }).finish();

  act(() => {
    lastSocketOptions().onMessage?.({ data: frame } as unknown as MessageEvent);
    lastSocketOptions().onMessage?.({ data: frame } as unknown as MessageEvent);
  });
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  act(() => {
    lastSocketOptions().onMessage?.({ data: frame } as unknown as MessageEvent);
  });
  expect(listener).toHaveBeenCalledTimes(2);
});

test('buffers bounded notices before React commits OPEN and clears them across connection ownership', () => {
  mockReadyState = 0;
  const { result, rerender } = renderHook(
    ({ connect, workspaceId }) => useAppflowyWebSocket({ ...baseOptions, connect, workspaceId }),
    {
      initialProps: { connect: true, workspaceId: 'workspace-1' },
    }
  );
  const frame = messages.Message.encode({
    collabMessage: {
      objectId: '11111111-1111-1111-1111-111111111111',
      collabType: 0,
      repairRequest: {
        requestId: '22222222-2222-2222-2222-222222222222',
        stateVector: new Uint8Array([0]),
        maxUpdateBytes: 1024,
      },
    },
  }).finish();

  act(() => {
    for (let index = 0; index < 20; index++) lastSocketOptions().onMessage?.({ data: frame } as unknown as MessageEvent);
  });
  mockReadyState = 1;
  rerender({ connect: true, workspaceId: 'workspace-1' });
  const listener = jest.fn();
  const unsubscribe = result.current.subscribeRepairRequests!(listener);

  expect(listener).toHaveBeenCalledTimes(16);
  unsubscribe();
  act(() => {
    lastSocketOptions().onMessage?.({ data: frame } as unknown as MessageEvent);
  });
  rerender({ connect: false, workspaceId: 'workspace-1' });
  const follower = jest.fn();
  const unsubscribeFollower = result.current.subscribeRepairRequests!(follower);

  expect(follower).not.toHaveBeenCalled();
  unsubscribeFollower();
  rerender({ connect: true, workspaceId: 'workspace-1' });
  act(() => {
    lastSocketOptions().onMessage?.({ data: frame } as unknown as MessageEvent);
  });
  rerender({ connect: true, workspaceId: 'workspace-2' });
  expect(result.current.subscribeRepairRequests!(listener)).toBeDefined();
  expect(listener).toHaveBeenCalledTimes(16);
});

test('decodes an ordinary frame once for both native delivery and React lastMessage', () => {
  const { result, rerender } = renderHook(() => useAppflowyWebSocket(baseOptions));
  const decode = jest.spyOn(messages.Message, 'decode');
  const event = {
    data: messages.Message.encode({
      collabMessage: { objectId: 'ordinary', collabType: 0, update: { payload: new Uint8Array([0, 0]) } },
    }).finish(),
  } as MessageEvent;

  act(() => {
    lastSocketOptions().onMessage?.(event);
  });
  mockLastMessage = event;
  rerender();
  expect(decode).toHaveBeenCalledTimes(1);
  expect(result.current.lastMessage?.collabMessage?.objectId).toBe('ordinary');
  rerender();
  expect(decode).toHaveBeenCalledTimes(1);
});

test('mixed bursts decode each native event once and preserve repair order before the final React frame', () => {
  const { result, rerender } = renderHook(() => useAppflowyWebSocket(baseOptions));
  const decode = jest.spyOn(messages.Message, 'decode');
  const listener = jest.fn();
  const unsubscribe = result.current.subscribeRepairRequests!(listener);
  const objectId = '11111111-1111-1111-1111-111111111111';
  const first = '22222222-2222-2222-2222-222222222222';
  const second = '33333333-3333-3333-3333-333333333333';
  const frame = (requestId?: string) =>
    ({
      data: messages.Message.encode({
        collabMessage: {
          objectId,
          collabType: 0,
          ...(requestId
            ? { repairRequest: { requestId, stateVector: new Uint8Array([0]), maxUpdateBytes: 1024 } }
            : { update: { payload: new Uint8Array([0, 0]) } }),
        },
      }).finish(),
    } as MessageEvent);
  const events = [frame(), frame(first), frame(), frame(second)];

  act(() => {
    events.forEach((event) => lastSocketOptions().onMessage?.(event));
  });
  mockLastMessage = events[3];
  rerender();
  expect(decode).toHaveBeenCalledTimes(4);
  expect(listener.mock.calls.map(([message]) => message.repairRequest.requestId)).toEqual([first, second]);
  expect(result.current.lastMessage).toBeNull();
  unsubscribe();
});

const repairRequest: RepairRequest = {
  requestId: '22222222-2222-2222-2222-222222222222',
  objectId: '11111111-1111-1111-1111-111111111111',
  collabType: 0,
  stateVector: new Uint8Array([0]),
  version: undefined,
  databaseId: undefined,
  databaseRestoreId: undefined,
  maxUpdateBytes: 1024,
};
const repairUpdate: RepairUpdate = {
  objectId: repairRequest.objectId,
  collabType: 0,
  payload: new Uint8Array([1, 2, 3]),
  version: undefined,
  databaseRestoreId: undefined,
  beforeStateVector: new Uint8Array([0]),
};

test('captured repair sender emits the correlated variant without socket buffering', () => {
  stableGetWebSocket.mockReturnValue({ readyState: 1 } as WebSocket);
  const { result } = renderHook(() => useAppflowyWebSocket(baseOptions));
  const send = result.current.captureRepairSender!()!;

  expect(send(repairRequest, repairUpdate)).toBe(true);
  expect(stableSendMessage).toHaveBeenCalledTimes(1);
  const [frame, keep] = stableSendMessage.mock.calls[0];
  const message = messages.Message.decode(frame).collabMessage!;

  expect(keep).toBe(false);
  expect(message.update).toBeNull();
  expect(message.repairUpdate?.requestId).toBe(repairRequest.requestId);
  expect(new Uint8Array(message.repairUpdate!.update!.payload!)).toEqual(repairUpdate.payload);
  expect(new Uint8Array(message.repairUpdate!.update!.beforeStateVector!)).toEqual(repairRequest.stateVector);
});

test.each(['replacement', 'close', 'reopen', 'leadership', 'workspace', 'token'])('repair send is fenced on %s', (change) => {
  stableGetWebSocket.mockReturnValue({ readyState: 1 } as WebSocket);
  const { result, rerender } = renderHook((options) => useAppflowyWebSocket(options), { initialProps: baseOptions });
  const send = result.current.captureRepairSender!()!;

  act(() => {
    if (change === 'replacement') stableGetWebSocket.mockReturnValue({ readyState: 1 } as WebSocket);
    if (change === 'close') lastSocketOptions().onClose?.({ code: 1000 } as CloseEvent);
    if (change === 'reopen') lastSocketOptions().onOpen?.();
    if (change === 'leadership') rerender({ ...baseOptions, connect: false });
    if (change === 'workspace') rerender({ ...baseOptions, workspaceId: 'next-workspace' });
    if (change === 'token') rerender({ ...baseOptions, token: 'replacement' });
  });
  expect(send(repairRequest, repairUpdate)).toBe(false);
  expect(stableSendMessage).not.toHaveBeenCalled();
});

test('repair send rejects changed identity, provenance and response limits', () => {
  stableGetWebSocket.mockReturnValue({ readyState: 1 } as WebSocket);
  const { result } = renderHook(() => useAppflowyWebSocket(baseOptions));
  const send = result.current.captureRepairSender!()!;

  for (const patch of [
    { objectId: 'different-object' }, { collabType: 1 }, { version: 'different-version' },
    { databaseRestoreId: 'different-generation' }, { payload: new Uint8Array(1025) }, { payload: new Uint8Array() },
  ]) expect(send(repairRequest, { ...repairUpdate, ...patch })).toBe(false);
  expect(stableSendMessage).not.toHaveBeenCalled();
});

test('repair ACKs never enter ordinary collab handling or request listeners', () => {
  const { result, rerender } = renderHook(() => useAppflowyWebSocket(baseOptions));
  const listener = jest.fn();
  const unsubscribe = result.current.subscribeRepairRequests!(listener);
  const event = { data: messages.Message.encode({ collabMessage: {
    objectId: repairRequest.objectId, collabType: 0,
    repairAck: { requestId: repairRequest.requestId, messageId: { timestamp: 42, counter: 1 } },
  } }).finish() } as MessageEvent;

  act(() => lastSocketOptions().onMessage?.(event));
  mockLastMessage = event;
  rerender();
  expect(result.current.lastMessage).toBeNull();
  expect(listener).not.toHaveBeenCalled();
  expect(stableSendMessage).not.toHaveBeenCalled();
  unsubscribe();
});
