import { render } from '@testing-library/react';
import { memo, useEffect } from 'react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { collabFullSyncBatch } from '@/application/services/js-services/http/collab-api';
import { AuthInternalContext, type AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { useSyncInternal } from '@/components/app/contexts/SyncInternalContext';
import { AppSyncLayer } from '@/components/app/layers/AppSyncLayer';
import { useSync, useWorkspaceRealtimeTransport } from '@/components/ws';
import type { AppflowyWebSocketType } from '@/components/ws/useAppflowyWebSocket';
import type { BroadcastChannelType } from '@/components/ws/useBroadcastChannel';
import type { messages } from '@/proto/messages';

jest.mock('@/components/ws', () => ({
  useSync: jest.fn(),
  useWorkspaceRealtimeTransport: jest.fn(),
}));

jest.mock('@/application/services/domains', () => ({
  CollabService: {
    getClientId: jest.fn(() => 7),
    getDeviceId: jest.fn(() => 'device-1'),
  },
  UserService: {
    getWorkspaceMemberProfile: jest.fn(),
  },
}));

jest.mock('@/application/services/js-services/http/collab-api', () => ({
  collabFullSyncBatch: jest.fn(),
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(() => ({ user: { id: 'user-1' } })),
}));

jest.mock('@/application/sync-outbox', () => ({
  clearDrainConfig: jest.fn(),
  configureDrain: jest.fn(),
  setCurrentSession: jest.fn(),
  startDrainAll: jest.fn(),
}));

jest.mock('@/application/db', () => ({
  db: {
    users: { get: jest.fn(), put: jest.fn() },
    workspace_member_profiles: { put: jest.fn() },
  },
}));

const mockUseSync = useSync as jest.Mock;
const mockUseWorkspaceRealtimeTransport = useWorkspaceRealtimeTransport as jest.Mock;
const mockCollabFullSyncBatch = collabFullSyncBatch as jest.MockedFunction<typeof collabFullSyncBatch>;

// Stable per-connection pieces, matching the real (memoized) hook behaviour:
// these keep their identity across messages — only the container object and
// lastMessage change when a message arrives.
const stableWsSendMessage = jest.fn();
const stableWsReconnect = jest.fn();
const stableSendBestEffort = jest.fn();
const stableBcValue: BroadcastChannelType = {
  lastBroadcastMessage: null,
  postMessage: jest.fn(),
  postDurableMessage: jest.fn(),
  subscribeProtocolMessages: jest.fn(),
  postOutboxReady: jest.fn(),
  subscribeOutboxReady: jest.fn(),
  postTransportSignal: jest.fn(),
  subscribeTransportSignals: jest.fn(),
};
const stableSyncValue = {
  registerSyncContext: jest.fn(),
  revertCollabVersion: jest.fn(),
  flushAllSync: jest.fn(),
  syncAllToServer: jest.fn(),
  applyHttpFullSyncResult: jest.fn(async () => undefined),
  scheduleDeferredCleanup: jest.fn(),
};

const createWsValue = (lastMessage: messages.Message | null): AppflowyWebSocketType =>
  ({
    lastMessage,
    sendMessage: stableWsSendMessage,
    readyState: 1,
    options: { workspaceId: 'workspace-1' },
    reconnectAttempt: 0,
    reconnect: stableWsReconnect,
  } as AppflowyWebSocketType);

const authContextValue = {
  currentWorkspaceId: 'workspace-1',
  isAuthenticated: true,
  maxUpdateBytes: 4 * 1024 * 1024,
  maxSlowSyncUpdateBytes: 64 * 1024 * 1024,
  syncLimitsLoaded: true,
} as unknown as AuthInternalContextType;

let consumerRenderCount = 0;
let websocketStatusEmits = 0;
let latestWebSocketReadyState: number | undefined;

const ContextConsumer = memo(function ContextConsumer() {
  const { eventEmitter } = useSyncInternal();

  consumerRenderCount += 1;

  useEffect(() => {
    const handleStatus = () => {
      websocketStatusEmits += 1;
    };

    latestWebSocketReadyState = eventEmitter.webSocketReadyState;
    eventEmitter.on(APP_EVENTS.WEBSOCKET_STATUS, handleStatus);

    return () => {
      eventEmitter.off(APP_EVENTS.WEBSOCKET_STATUS, handleStatus);
    };
  }, [eventEmitter]);

  return <div data-testid='consumer' />;
});

const renderLayer = (authValue: AuthInternalContextType = authContextValue) =>
  render(
    <AuthInternalContext.Provider value={authValue}>
      <AppSyncLayer>
        <ContextConsumer />
      </AppSyncLayer>
    </AuthInternalContext.Provider>
  );

const rerenderLayer = (rerender: ReturnType<typeof render>['rerender']) =>
  rerender(
    <AuthInternalContext.Provider value={authContextValue}>
      <AppSyncLayer>
        <ContextConsumer />
      </AppSyncLayer>
    </AuthInternalContext.Provider>
  );

describe('AppSyncLayer per-message churn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consumerRenderCount = 0;
    websocketStatusEmits = 0;
    latestWebSocketReadyState = undefined;
    mockUseSync.mockReturnValue(stableSyncValue);
    mockCollabFullSyncBatch.mockResolvedValue([
      {
        objectId: 'object-1',
        collabType: 0,
        missingUpdate: new Uint8Array(),
        serverStateVector: new Uint8Array(),
        messageId: { timestamp: 1, counter: 0 },
      },
    ]);
    mockUseWorkspaceRealtimeTransport.mockReturnValue({
      webSocket: createWsValue(null),
      broadcastChannel: stableBcValue,
      canSendToServer: true,
      sendBestEffort: stableSendBestEffort,
    });
  });

  // Reproduces the fan-out bug: an incoming collab message produces a new
  // webSocket value (new lastMessage), which must NOT rebuild the sync context
  // value — otherwise every context consumer re-renders on every message.
  it('does not re-render context consumers when a websocket message arrives', () => {
    const { rerender } = renderLayer();

    const rendersAfterMount = consumerRenderCount;

    // Simulate a message arriving: same connection (stable functions and
    // readyState), new container identity with a new lastMessage.
    mockUseWorkspaceRealtimeTransport.mockReturnValue({
      webSocket: createWsValue({ collabMessage: {} } as unknown as messages.Message),
      broadcastChannel: stableBcValue,
      canSendToServer: true,
      sendBestEffort: stableSendBestEffort,
    });
    rerenderLayer(rerender);

    expect(consumerRenderCount).toBe(rendersAfterMount);
  });

  // Reproduces the spurious status broadcast: WEBSOCKET_STATUS must be emitted
  // on readyState transitions, not re-emitted for every incoming message.
  it('does not re-emit WEBSOCKET_STATUS when a message arrives without a readyState change', () => {
    const { rerender } = renderLayer();

    const emitsAfterMount = websocketStatusEmits;

    mockUseWorkspaceRealtimeTransport.mockReturnValue({
      webSocket: createWsValue({ collabMessage: {} } as unknown as messages.Message),
      broadcastChannel: stableBcValue,
      canSendToServer: true,
      sendBestEffort: stableSendBestEffort,
    });
    rerenderLayer(rerender);

    expect(websocketStatusEmits).toBe(emitsAfterMount);
  });

  it('emits WEBSOCKET_STATUS when the readyState actually changes', () => {
    const { rerender } = renderLayer();

    const emitsAfterMount = websocketStatusEmits;

    mockUseWorkspaceRealtimeTransport.mockReturnValue({
      webSocket: { ...createWsValue(null), readyState: 3 },
      broadcastChannel: stableBcValue,
      canSendToServer: true,
      sendBestEffort: stableSendBestEffort,
    });
    rerenderLayer(rerender);

    expect(websocketStatusEmits).toBe(emitsAfterMount + 1);
  });

  it('stores the latest readyState for consumers that subscribe after the status event', () => {
    renderLayer();

    expect(latestWebSocketReadyState).toBe(1);
  });

  it('does not rebuild the drain configuration for websocket readyState changes', () => {
    const outboxMock = jest.requireMock('@/application/sync-outbox');
    const { rerender } = renderLayer();
    const configureCallsAfterMount = outboxMock.configureDrain.mock.calls.length;

    mockUseWorkspaceRealtimeTransport.mockReturnValue({
      webSocket: { ...createWsValue(null), readyState: 3 },
      broadcastChannel: stableBcValue,
      canSendToServer: true,
      sendBestEffort: stableSendBestEffort,
    });
    rerenderLayer(rerender);

    expect(outboxMock.configureDrain).toHaveBeenCalledTimes(configureCallsAfterMount);
    expect(outboxMock.startDrainAll.mock.calls.length).toBeGreaterThan(1);
  });

  it('starts the leader drain while the websocket is closed so oversized records can use HTTP', () => {
    const outboxMock = jest.requireMock('@/application/sync-outbox');

    mockUseWorkspaceRealtimeTransport.mockReturnValue({
      webSocket: { ...createWsValue(null), readyState: 3 },
      broadcastChannel: stableBcValue,
      canSendToServer: true,
      sendBestEffort: stableSendBestEffort,
    });

    renderLayer();

    expect(outboxMock.startDrainAll).toHaveBeenCalledTimes(1);
    const leaderConfig = outboxMock.configureDrain.mock.calls.at(-1)?.[0];

    expect(leaderConfig.isReady()).toBe(false);
    expect(leaderConfig.slowSync).toEqual(expect.any(Function));
  });

  it('keeps the conservative realtime drain active while server-info is unresolved', () => {
    const outboxMock = jest.requireMock('@/application/sync-outbox');

    renderLayer({
      ...authContextValue,
      maxUpdateBytes: undefined,
      maxSlowSyncUpdateBytes: undefined,
      syncLimitsLoaded: false,
    });

    const config = outboxMock.configureDrain.mock.calls.at(-1)?.[0];

    expect(config.isReady()).toBe(true);
    expect(config.maxUpdateBytes).toBeUndefined();
    expect(config.slowSync).toBeUndefined();
    expect(outboxMock.startDrainAll).toHaveBeenCalledTimes(1);
  });

  it('configures the HTTP slow lane only on the elected transport owner', async () => {
    const outboxMock = jest.requireMock('@/application/sync-outbox');
    const { rerender } = renderLayer();
    const leaderConfig = outboxMock.configureDrain.mock.calls.at(-1)?.[0];
    const desiredDoc = new Y.Doc();

    desiredDoc.getMap('root').set('value', 'desired');
    const desiredStateVector = Y.encodeStateVector(desiredDoc);

    expect(leaderConfig.maxUpdateBytes).toBe(4 * 1024 * 1024);
    expect(leaderConfig.maxSlowSyncUpdateBytes).toBe(64 * 1024 * 1024);
    expect(leaderConfig.slowSync).toEqual(expect.any(Function));

    await expect(
      leaderConfig.slowSync({
        objectId: 'object-1',
        collabType: 0,
        version: 'version-1',
        stateVector: desiredStateVector,
        docState: new Uint8Array([2]),
      })
    ).resolves.toMatchObject({ outcome: 'confirmed', messageId: { timestamp: 1, counter: 0 } });
    expect(mockCollabFullSyncBatch).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      [
        expect.objectContaining({
          objectId: 'object-1',
          collabVersion: 'version-1',
          docState: new Uint8Array(),
        }),
      ],
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mockCollabFullSyncBatch.mock.calls[0][2]?.syncLane).toBeUndefined();
    expect(mockCollabFullSyncBatch).toHaveBeenNthCalledWith(
      2,
      'workspace-1',
      [
        expect.objectContaining({
          objectId: 'object-1',
          collabVersion: 'version-1',
          docState: new Uint8Array([2]),
        }),
      ],
      expect.objectContaining({ syncLane: 'slow', signal: expect.any(AbortSignal) })
    );
    expect(stableSyncValue.applyHttpFullSyncResult).toHaveBeenCalledTimes(2);

    mockCollabFullSyncBatch.mockResolvedValueOnce([
      {
        objectId: 'object-1',
        collabType: 0,
        missingUpdate: new Uint8Array(),
        serverStateVector: new Uint8Array(),
        messageId: { timestamp: 2, counter: 0 },
      },
      {
        objectId: 'unexpected-object',
        collabType: 0,
        missingUpdate: new Uint8Array(),
        serverStateVector: new Uint8Array(),
        messageId: { timestamp: 3, counter: 0 },
      },
    ]);
    await expect(
      leaderConfig.slowSync({
        objectId: 'object-1',
        collabType: 0,
        version: 'version-1',
        stateVector: desiredStateVector,
        docState: new Uint8Array([2]),
      })
    ).rejects.toThrow('did not exactly match');

    const noRidResult = [
      {
        objectId: 'object-1',
        collabType: 0,
        missingUpdate: new Uint8Array(),
        serverStateVector: new Uint8Array(),
      },
    ];

    mockCollabFullSyncBatch.mockResolvedValueOnce(noRidResult).mockResolvedValueOnce(noRidResult);
    await expect(
      leaderConfig.slowSync({
        objectId: 'object-1',
        collabType: 0,
        version: 'version-1',
        stateVector: desiredStateVector,
        docState: new Uint8Array([2]),
      })
    ).rejects.toThrow('did not include a durable message id');

    mockUseWorkspaceRealtimeTransport.mockReturnValue({
      webSocket: createWsValue(null),
      broadcastChannel: stableBcValue,
      canSendToServer: false,
      sendBestEffort: stableSendBestEffort,
    });
    rerenderLayer(rerender);

    const followerConfig = outboxMock.configureDrain.mock.calls.at(-1)?.[0];

    expect(followerConfig.slowSync).toBeUndefined();
  });

  it('uploads after a coverage-equivalent probe because Yjs deletes do not advance state vectors', async () => {
    const outboxMock = jest.requireMock('@/application/sync-outbox');
    const desiredDoc = new Y.Doc();

    desiredDoc.getMap('root').set('value', 'already durable');
    const desiredStateVector = Y.encodeStateVector(desiredDoc);

    mockCollabFullSyncBatch
      .mockResolvedValueOnce([
        {
          objectId: 'object-1',
          collabType: 0,
          missingUpdate: new Uint8Array(),
          serverStateVector: desiredStateVector,
        },
      ])
      .mockResolvedValueOnce([
        {
          objectId: 'object-1',
          collabType: 0,
          missingUpdate: new Uint8Array(),
          serverStateVector: desiredStateVector,
          messageId: { timestamp: 5, counter: 0 },
        },
      ]);
    renderLayer();
    const leaderConfig = outboxMock.configureDrain.mock.calls.at(-1)?.[0];

    await expect(
      leaderConfig.slowSync({
        objectId: 'object-1',
        collabType: 0,
        version: 'version-1',
        stateVector: desiredStateVector,
        docState: new Uint8Array([9, 9]),
      })
    ).resolves.toEqual({ outcome: 'confirmed', messageId: { timestamp: 5, counter: 0 } });

    expect(mockCollabFullSyncBatch).toHaveBeenCalledTimes(2);
    expect(mockCollabFullSyncBatch.mock.calls[0][2]?.syncLane).toBeUndefined();
    expect(mockCollabFullSyncBatch.mock.calls[1][2]).toMatchObject({ syncLane: 'slow' });
    expect(stableSyncValue.applyHttpFullSyncResult).toHaveBeenCalledTimes(2);
  });

  it('treats a different authoritative server version without a RID as confirmed supersession', async () => {
    const outboxMock = jest.requireMock('@/application/sync-outbox');

    mockCollabFullSyncBatch.mockResolvedValueOnce([
      {
        objectId: 'object-1',
        collabType: 0,
        missingUpdate: new Uint8Array(),
        serverStateVector: new Uint8Array(),
        collabVersion: 'version-2',
      },
    ]);
    renderLayer();
    const leaderConfig = outboxMock.configureDrain.mock.calls.at(-1)?.[0];

    await expect(
      leaderConfig.slowSync({
        objectId: 'object-1',
        collabType: 0,
        version: 'version-1',
        stateVector: new Uint8Array([0]),
        docState: new Uint8Array([9]),
      })
    ).resolves.toEqual({ outcome: 'confirmed', messageId: undefined });

    expect(mockCollabFullSyncBatch).toHaveBeenCalledTimes(1);
    expect(stableSyncValue.applyHttpFullSyncResult).toHaveBeenCalledWith(
      expect.objectContaining({ collabVersion: 'version-2' }),
      'version-1'
    );
  });

  it('returns terminal server errors as blocked without applying the result', async () => {
    const outboxMock = jest.requireMock('@/application/sync-outbox');

    mockCollabFullSyncBatch.mockResolvedValueOnce([
      {
        objectId: 'object-1',
        collabType: 0,
        missingUpdate: new Uint8Array(),
        serverStateVector: new Uint8Array(),
        error: 'permission_denied',
      },
    ]);
    renderLayer();
    const leaderConfig = outboxMock.configureDrain.mock.calls.at(-1)?.[0];

    await expect(
      leaderConfig.slowSync({
        objectId: 'object-1',
        collabType: 0,
        version: 'version-1',
        stateVector: new Uint8Array([0]),
        docState: new Uint8Array([9]),
      })
    ).resolves.toEqual({ outcome: 'blocked', reason: 'permission_denied' });

    expect(stableSyncValue.applyHttpFullSyncResult).not.toHaveBeenCalled();
  });
});
