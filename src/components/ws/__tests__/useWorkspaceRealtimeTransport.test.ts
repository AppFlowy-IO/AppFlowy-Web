import { act, renderHook } from '@testing-library/react';

import { startDrainObject } from '@/application/sync-outbox';
import type { messages } from '@/proto/messages';

import { useAppflowyWebSocket, type AppflowyWebSocketType } from '../useAppflowyWebSocket';
import {
  useBroadcastChannel,
  type BroadcastChannelType,
  type WorkspaceTransportSignal,
} from '../useBroadcastChannel';
import { useWorkspaceRealtimeTransport } from '../useWorkspaceRealtimeTransport';
import { useWorkspaceWebSocketLeader } from '../useWorkspaceWebSocketLeader';

jest.mock('@/application/sync-outbox', () => ({
  startDrainObject: jest.fn(),
}));

jest.mock('../useAppflowyWebSocket', () => ({
  useAppflowyWebSocket: jest.fn(),
}));

jest.mock('../useBroadcastChannel', () => ({
  useBroadcastChannel: jest.fn(),
}));

jest.mock('../useWorkspaceWebSocketLeader', () => ({
  useWorkspaceWebSocketLeader: jest.fn(),
}));

const mockUseAppflowyWebSocket = useAppflowyWebSocket as jest.Mock;
const mockUseBroadcastChannel = useBroadcastChannel as jest.Mock;
const mockUseWorkspaceWebSocketLeader = useWorkspaceWebSocketLeader as jest.Mock;
const mockStartDrainObject = startDrainObject as jest.Mock;

const sendWebSocketMessage = jest.fn();
const reconnect = jest.fn();
const postMessage = jest.fn();
const postDurableMessage = jest.fn();
const subscribeProtocolMessages = jest.fn();
const postOutboxReady = jest.fn();
const subscribeOutboxReady = jest.fn();
const postTransportSignal = jest.fn();
const subscribeTransportSignals = jest.fn();

const createWebSocket = (lastMessage: messages.Message | null, readyState = WebSocket.OPEN): AppflowyWebSocketType => ({
  lastMessage,
  sendMessage: sendWebSocketMessage,
  readyState,
  options: { workspaceId: 'workspace-1' },
  reconnectAttempt: 0,
  reconnect,
});

const broadcastChannel: BroadcastChannelType = {
  lastBroadcastMessage: null,
  postMessage,
  postDurableMessage,
  subscribeProtocolMessages,
  postOutboxReady,
  subscribeOutboxReady,
  postTransportSignal,
  subscribeTransportSignals,
};

const renderTransport = () =>
  renderHook(() =>
    useWorkspaceRealtimeTransport({
      workspaceId: 'workspace-1',
      clientId: 7,
      deviceId: 'device-1',
    })
  );

describe('useWorkspaceRealtimeTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeProtocolMessages.mockReturnValue(jest.fn());
    subscribeOutboxReady.mockReturnValue(jest.fn());
    subscribeTransportSignals.mockReturnValue(jest.fn());
    mockUseBroadcastChannel.mockReturnValue(broadcastChannel);
    mockUseAppflowyWebSocket.mockReturnValue(createWebSocket(null));
  });

  it('routes follower traffic and server messages through the coordinated leader', () => {
    const serverMessage = { notification: { folderChanged: {} } } as messages.Message;
    const followerMessage = { collabMessage: { objectId: 'object-1' } } as messages.Message;
    const unsubscribeProtocol = jest.fn();
    const unsubscribeOutbox = jest.fn();
    const unsubscribeTransport = jest.fn();
    let forwardProtocolMessage: ((message: messages.Message) => void) | undefined;
    let notifyOutboxReady: ((workspaceId: string, objectId: string) => void) | undefined;
    let handleTransportSignal: ((signal: WorkspaceTransportSignal) => void) | undefined;

    mockUseWorkspaceWebSocketLeader.mockReturnValue({ isLeader: true, isCoordinated: true });
    mockUseAppflowyWebSocket.mockReturnValue(createWebSocket(serverMessage));
    subscribeProtocolMessages.mockImplementation((listener) => {
      forwardProtocolMessage = listener;
      return unsubscribeProtocol;
    });
    subscribeOutboxReady.mockImplementation((listener) => {
      notifyOutboxReady = listener;
      return unsubscribeOutbox;
    });
    subscribeTransportSignals.mockImplementation((listener) => {
      handleTransportSignal = listener;
      return unsubscribeTransport;
    });

    const { result, unmount } = renderTransport();

    expect(mockUseAppflowyWebSocket).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      clientId: 7,
      deviceId: 'device-1',
      connect: true,
      reconnectWhenHidden: true,
    });
    expect(result.current.canSendToServer).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(serverMessage);
    expect(postTransportSignal).toHaveBeenCalledWith({
      type: 'transport-status',
      workspaceId: 'workspace-1',
      readyState: WebSocket.OPEN,
    });

    act(() => {
      result.current.sendBestEffort(followerMessage);
      forwardProtocolMessage?.(followerMessage);
      notifyOutboxReady?.('other-workspace', 'ignored-object');
      notifyOutboxReady?.('workspace-1', 'object-1');
      handleTransportSignal?.({ type: 'transport-status-request', workspaceId: 'workspace-1' });
      handleTransportSignal?.({ type: 'transport-reconnect-request', workspaceId: 'workspace-1' });
    });

    expect(sendWebSocketMessage).toHaveBeenCalledTimes(2);
    expect(sendWebSocketMessage).toHaveBeenNthCalledWith(1, followerMessage, true);
    expect(sendWebSocketMessage).toHaveBeenNthCalledWith(2, followerMessage, true);
    expect(mockStartDrainObject).toHaveBeenCalledTimes(1);
    expect(mockStartDrainObject).toHaveBeenCalledWith('object-1');
    expect(postTransportSignal).toHaveBeenLastCalledWith({
      type: 'transport-status',
      workspaceId: 'workspace-1',
      readyState: WebSocket.OPEN,
    });
    expect(reconnect).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribeProtocol).toHaveBeenCalledTimes(1);
    expect(unsubscribeOutbox).toHaveBeenCalledTimes(1);
    expect(unsubscribeTransport).toHaveBeenCalledTimes(1);
  });

  it('uses the leader status and reconnect control path for a coordinated follower', () => {
    const serverMessage = { notification: { folderChanged: {} } } as messages.Message;
    let handleTransportSignal: ((signal: WorkspaceTransportSignal) => void) | undefined;

    mockUseWorkspaceWebSocketLeader.mockReturnValue({ isLeader: false, isCoordinated: true });
    mockUseAppflowyWebSocket.mockReturnValue(createWebSocket(serverMessage, -1));
    subscribeTransportSignals.mockImplementation((listener) => {
      handleTransportSignal = listener;
      return jest.fn();
    });

    const { result } = renderTransport();

    expect(mockUseAppflowyWebSocket).toHaveBeenCalledWith(
      expect.objectContaining({ connect: false, reconnectWhenHidden: true })
    );
    expect(result.current.canSendToServer).toBe(false);
    expect(result.current.webSocket.lastMessage).toBeNull();
    expect(result.current.webSocket.readyState).toBe(WebSocket.CONNECTING);
    expect(subscribeProtocolMessages).not.toHaveBeenCalled();
    expect(subscribeOutboxReady).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(postTransportSignal).toHaveBeenCalledWith({
      type: 'transport-status-request',
      workspaceId: 'workspace-1',
    });

    act(() => {
      handleTransportSignal?.({
        type: 'transport-status',
        workspaceId: 'workspace-1',
        readyState: WebSocket.OPEN,
      });
    });

    expect(result.current.webSocket.readyState).toBe(WebSocket.OPEN);

    const followerMessage = { collabMessage: { objectId: 'object-1' } } as messages.Message;

    act(() => {
      result.current.sendBestEffort(followerMessage);
      result.current.webSocket.reconnect();
    });

    expect(postMessage).toHaveBeenCalledWith(followerMessage);
    expect(postTransportSignal).toHaveBeenCalledWith({
      type: 'transport-reconnect-request',
      workspaceId: 'workspace-1',
    });
    expect(sendWebSocketMessage).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('uses an independent socket when browser lock coordination is unavailable', () => {
    mockUseWorkspaceWebSocketLeader.mockReturnValue({ isLeader: true, isCoordinated: false });

    const { result } = renderTransport();

    expect(mockUseAppflowyWebSocket).toHaveBeenCalledWith(
      expect.objectContaining({ connect: true, reconnectWhenHidden: false })
    );
    expect(result.current.canSendToServer).toBe(true);
    expect(subscribeProtocolMessages).not.toHaveBeenCalled();
    expect(subscribeOutboxReady).not.toHaveBeenCalled();
    expect(subscribeTransportSignals).not.toHaveBeenCalled();
    expect(postTransportSignal).not.toHaveBeenCalled();
  });
});
