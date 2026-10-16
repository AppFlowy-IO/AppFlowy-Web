import { useCallback, useEffect, useMemo, useState } from 'react';

import { startDrainObject } from '@/application/sync-outbox';
import type { messages } from '@/proto/messages';

import { useAppflowyWebSocket, type AppflowyWebSocketType } from './useAppflowyWebSocket';
import { useBroadcastChannel, type BroadcastChannelType } from './useBroadcastChannel';
import { useWorkspaceWebSocketLeader } from './useWorkspaceWebSocketLeader';

const WS_READY_STATE_CONNECTING = 0;

interface WorkspaceRealtimeTransportOptions {
  workspaceId: string;
  clientId: number;
  deviceId: string;
}

export interface WorkspaceRealtimeTransport {
  webSocket: AppflowyWebSocketType;
  broadcastChannel: BroadcastChannelType;
  canSendToServer: boolean;
  sendBestEffort: (message: messages.IMessage) => void;
}

interface RemoteTransportState {
  workspaceId: string;
  readyState: number;
}

/**
 * Owns the workspace's complete cross-tab realtime transport policy.
 *
 * With Web Locks support, one tab owns the WebSocket and relays protocol
 * traffic for its followers over BroadcastChannel. Without Web Locks, each
 * tab keeps its own socket so realtime sync remains available.
 */
export function useWorkspaceRealtimeTransport({
  workspaceId,
  clientId,
  deviceId,
}: WorkspaceRealtimeTransportOptions): WorkspaceRealtimeTransport {
  const leadership = useWorkspaceWebSocketLeader(workspaceId);
  const broadcastChannel = useBroadcastChannel(`workspace:${workspaceId}`);
  const localWebSocket = useAppflowyWebSocket({
    workspaceId,
    clientId,
    deviceId,
    connect: leadership.isLeader,
    // The elected owner may be hidden while serving visible follower tabs.
    reconnectWhenHidden: leadership.isCoordinated,
  });

  const isCoordinatedLeader = leadership.isCoordinated && leadership.isLeader;
  const canSendToServer = !leadership.isCoordinated || leadership.isLeader;
  const sendWebSocketMessage = localWebSocket.sendMessage;
  const lastWebSocketMessage = localWebSocket.lastMessage;
  const localReadyState = localWebSocket.readyState;
  const localReconnect = localWebSocket.reconnect;
  const postBroadcastMessage = broadcastChannel.postMessage;
  const subscribeProtocolMessages = broadcastChannel.subscribeProtocolMessages;
  const subscribeOutboxReady = broadcastChannel.subscribeOutboxReady;
  const postTransportSignal = broadcastChannel.postTransportSignal;
  const subscribeTransportSignals = broadcastChannel.subscribeTransportSignals;
  const [remoteTransportState, setRemoteTransportState] = useState<RemoteTransportState | null>(null);

  useEffect(() => {
    if (!leadership.isCoordinated) return;

    return subscribeTransportSignals((signal) => {
      if (signal.workspaceId !== workspaceId) return;

      if (signal.type === 'transport-status') {
        if (!isCoordinatedLeader) {
          setRemoteTransportState((current) => {
            if (current?.workspaceId === workspaceId && current.readyState === signal.readyState) {
              return current;
            }

            return { workspaceId, readyState: signal.readyState };
          });
        }

        return;
      }

      if (!isCoordinatedLeader) return;

      if (signal.type === 'transport-status-request') {
        postTransportSignal({
          type: 'transport-status',
          workspaceId,
          readyState: localReadyState,
        });
        return;
      }

      localReconnect();
    });
  }, [
    leadership.isCoordinated,
    isCoordinatedLeader,
    localReadyState,
    localReconnect,
    postTransportSignal,
    subscribeTransportSignals,
    workspaceId,
  ]);

  // Publish every leader state transition and answer late-joining followers'
  // status requests so a socketless tab never has to infer transport health
  // from react-use-websocket's local UNINSTANTIATED state.
  useEffect(() => {
    if (!isCoordinatedLeader) return;

    postTransportSignal({
      type: 'transport-status',
      workspaceId,
      readyState: localReadyState,
    });
  }, [isCoordinatedLeader, localReadyState, postTransportSignal, workspaceId]);

  useEffect(() => {
    if (!leadership.isCoordinated || leadership.isLeader) return;

    postTransportSignal({
      type: 'transport-status-request',
      workspaceId,
    });
  }, [leadership.isCoordinated, leadership.isLeader, postTransportSignal, workspaceId]);

  const requestLeaderReconnect = useCallback(() => {
    postTransportSignal({
      type: 'transport-reconnect-request',
      workspaceId,
    });
  }, [postTransportSignal, workspaceId]);

  const transportReadyState = canSendToServer
    ? localReadyState
    : remoteTransportState?.workspaceId === workspaceId
      ? remoteTransportState.readyState
      : WS_READY_STATE_CONNECTING;

  const webSocket = useMemo<AppflowyWebSocketType>(() => {
    if (canSendToServer) return localWebSocket;

    return {
      ...localWebSocket,
      // Followers consume server messages from BroadcastChannel only. Clearing
      // the local value also prevents a previous workspace's final socket
      // message from leaking through during a leadership/workspace transition.
      lastMessage: null,
      readyState: transportReadyState,
      reconnectAttempt: 0,
      reconnect: requestLeaderReconnect,
    };
  }, [canSendToServer, localWebSocket, requestLeaderReconnect, transportReadyState]);

  const sendBestEffort = useCallback(
    (message: messages.IMessage) => {
      if (canSendToServer) {
        sendWebSocketMessage(message, true);
      } else {
        // A coordinated follower has no socket. Raw protocol traffic is picked
        // up by the leader's subscription above and forwarded to the server.
        postBroadcastMessage(message);
      }
    },
    [canSendToServer, postBroadcastMessage, sendWebSocketMessage]
  );

  // Followers send ephemeral sync and awareness traffic through the leader.
  // keep=true preserves messages emitted while its socket is still connecting.
  useEffect(() => {
    if (!isCoordinatedLeader) return;

    return subscribeProtocolMessages((message) => {
      sendWebSocketMessage(message, true);
    });
  }, [isCoordinatedLeader, sendWebSocketMessage, subscribeProtocolMessages]);

  // Durable rows are announced only after IndexedDB commits. The leader can
  // then read the shared row and drain it through the sole workspace socket.
  useEffect(() => {
    if (!isCoordinatedLeader) return;

    return subscribeOutboxReady((signalWorkspaceId, objectId) => {
      if (signalWorkspaceId === workspaceId) {
        startDrainObject(objectId);
      }
    });
  }, [isCoordinatedLeader, subscribeOutboxReady, workspaceId]);

  // BroadcastChannel does not echo to its sender, so the leader processes the
  // WebSocket copy once while followers receive the relayed server message.
  useEffect(() => {
    if (!isCoordinatedLeader || !lastWebSocketMessage) return;

    postBroadcastMessage(lastWebSocketMessage);
  }, [isCoordinatedLeader, lastWebSocketMessage, postBroadcastMessage]);

  return { webSocket, broadcastChannel, canSendToServer, sendBestEffort };
}
