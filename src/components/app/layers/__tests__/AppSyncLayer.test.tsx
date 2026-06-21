import { render } from '@testing-library/react';
import { memo, useEffect } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { AuthInternalContext, type AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { useSyncInternal } from '@/components/app/contexts/SyncInternalContext';
import { AppSyncLayer } from '@/components/app/layers/AppSyncLayer';
import { useAppflowyWebSocket, useBroadcastChannel, useSync } from '@/components/ws';
import type { AppflowyWebSocketType } from '@/components/ws/useAppflowyWebSocket';
import type { BroadcastChannelType } from '@/components/ws/useBroadcastChannel';
import type { messages } from '@/proto/messages';

jest.mock('@/components/ws', () => ({
  useAppflowyWebSocket: jest.fn(),
  useBroadcastChannel: jest.fn(),
  useSync: jest.fn(),
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

const mockUseAppflowyWebSocket = useAppflowyWebSocket as jest.Mock;
const mockUseBroadcastChannel = useBroadcastChannel as jest.Mock;
const mockUseSync = useSync as jest.Mock;

// Stable per-connection pieces, matching the real (memoized) hook behaviour:
// these keep their identity across messages — only the container object and
// lastMessage change when a message arrives.
const stableWsSendMessage = jest.fn();
const stableWsReconnect = jest.fn();
const stableBcValue: BroadcastChannelType = {
  lastBroadcastMessage: null,
  postMessage: jest.fn(),
};
const stableSyncValue = {
  registerSyncContext: jest.fn(),
  revertCollabVersion: jest.fn(),
  flushAllSync: jest.fn(),
  syncAllToServer: jest.fn(),
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
} as unknown as AuthInternalContextType;

let consumerRenderCount = 0;
let websocketStatusEmits = 0;

const ContextConsumer = memo(function ContextConsumer() {
  const { eventEmitter } = useSyncInternal();

  consumerRenderCount += 1;

  useEffect(() => {
    const handleStatus = () => {
      websocketStatusEmits += 1;
    };

    eventEmitter.on(APP_EVENTS.WEBSOCKET_STATUS, handleStatus);

    return () => {
      eventEmitter.off(APP_EVENTS.WEBSOCKET_STATUS, handleStatus);
    };
  }, [eventEmitter]);

  return <div data-testid='consumer' />;
});

const renderLayer = () =>
  render(
    <AuthInternalContext.Provider value={authContextValue}>
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
    mockUseBroadcastChannel.mockReturnValue(stableBcValue);
    mockUseSync.mockReturnValue(stableSyncValue);
    mockUseAppflowyWebSocket.mockReturnValue(createWsValue(null));
  });

  // Reproduces the fan-out bug: an incoming collab message produces a new
  // webSocket value (new lastMessage), which must NOT rebuild the sync context
  // value — otherwise every context consumer re-renders on every message.
  it('does not re-render context consumers when a websocket message arrives', () => {
    const { rerender } = renderLayer();

    const rendersAfterMount = consumerRenderCount;

    // Simulate a message arriving: same connection (stable functions and
    // readyState), new container identity with a new lastMessage.
    mockUseAppflowyWebSocket.mockReturnValue(createWsValue({ collabMessage: {} } as unknown as messages.Message));
    rerenderLayer(rerender);

    expect(consumerRenderCount).toBe(rendersAfterMount);
  });

  // Reproduces the spurious status broadcast: WEBSOCKET_STATUS must be emitted
  // on readyState transitions, not re-emitted for every incoming message.
  it('does not re-emit WEBSOCKET_STATUS when a message arrives without a readyState change', () => {
    const { rerender } = renderLayer();

    const emitsAfterMount = websocketStatusEmits;

    mockUseAppflowyWebSocket.mockReturnValue(createWsValue({ collabMessage: {} } as unknown as messages.Message));
    rerenderLayer(rerender);

    expect(websocketStatusEmits).toBe(emitsAfterMount);
  });

  it('emits WEBSOCKET_STATUS when the readyState actually changes', () => {
    const { rerender } = renderLayer();

    const emitsAfterMount = websocketStatusEmits;

    mockUseAppflowyWebSocket.mockReturnValue({ ...createWsValue(null), readyState: 3 });
    rerenderLayer(rerender);

    expect(websocketStatusEmits).toBe(emitsAfterMount + 1);
  });
});
