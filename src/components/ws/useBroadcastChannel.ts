import { useCallback, useEffect, useRef, useState } from 'react';

import { messages } from '@/proto/messages';
import { Log } from '@/utils/log';

export type BroadcastChannelType = {
  lastBroadcastMessage: messages.Message | null;
  postMessage: (msg: messages.IMessage, keep?: boolean) => void;
  postDurableMessage: (msg: messages.IMessage) => void;
  subscribeProtocolMessages: (listener: (message: messages.Message) => void) => () => void;
  postOutboxReady: (workspaceId: string, objectId: string) => void;
  subscribeOutboxReady: (listener: (workspaceId: string, objectId: string) => void) => () => void;
  postTransportSignal: (signal: WorkspaceTransportSignal) => void;
  subscribeTransportSignals: (listener: (signal: WorkspaceTransportSignal) => void) => () => void;
};

export type WorkspaceTransportSignal =
  | {
      type: 'transport-status';
      workspaceId: string;
      readyState: number;
    }
  | {
      type: 'transport-status-request' | 'transport-reconnect-request';
      workspaceId: string;
    };

interface DurableMessageSignal {
  type: 'durable-message';
  payload: ArrayBufferView;
}

interface OutboxReadySignal {
  type: 'outbox-ready';
  workspaceId: string;
  objectId: string;
}

interface ChannelMessageState {
  channelName: string;
  message: messages.Message;
}

const WS_READY_STATE_CONNECTING = 0;
const WS_READY_STATE_CLOSED = 3;

const isOutboxReadySignal = (value: unknown): value is OutboxReadySignal => {
  if (!value || typeof value !== 'object') return false;

  const signal = value as Partial<OutboxReadySignal>;

  return signal.type === 'outbox-ready' && typeof signal.workspaceId === 'string' && typeof signal.objectId === 'string';
};

const isDurableMessageSignal = (value: unknown): value is DurableMessageSignal => {
  if (!value || typeof value !== 'object') return false;

  const signal = value as Partial<DurableMessageSignal>;

  return (
    signal.type === 'durable-message' && (signal.payload instanceof Uint8Array || ArrayBuffer.isView(signal.payload))
  );
};

const isWorkspaceTransportSignal = (value: unknown): value is WorkspaceTransportSignal => {
  if (!value || typeof value !== 'object') return false;

  const signal = value as {
    type?: unknown;
    workspaceId?: unknown;
    readyState?: unknown;
  };

  if (typeof signal.workspaceId !== 'string') return false;

  if (signal.type === 'transport-status') {
    return (
      typeof signal.readyState === 'number' &&
      Number.isInteger(signal.readyState) &&
      signal.readyState >= WS_READY_STATE_CONNECTING &&
      signal.readyState <= WS_READY_STATE_CLOSED
    );
  }

  return signal.type === 'transport-status-request' || signal.type === 'transport-reconnect-request';
};

const postOutboxReadyOnTemporaryChannel = (channelName: string, signal: OutboxReadySignal) => {
  let temporaryChannel: BroadcastChannel | null = null;

  try {
    temporaryChannel = new BroadcastChannel(channelName);
    temporaryChannel.postMessage(signal);
  } catch (error) {
    Log.warn('Failed to notify the WebSocket leader about a durable outbox update', {
      workspaceId: signal.workspaceId,
      objectId: signal.objectId,
      error,
    });
  } finally {
    temporaryChannel?.close();
  }
};

const toUint8Array = (value: ArrayBuffer | ArrayBufferView): Uint8Array => {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
};

/**
 * Hook for cross-tab synchronization using BroadcastChannel API
 *
 * Purpose: Enables communication between multiple browser tabs of the same workspace
 * to ensure consistent real-time updates across all tabs.
 *
 * Multi-tab Architecture:
 * - Only one tab per workspace maintains the WebSocket connection
 * - That leader tab receives server notifications directly
 * - The leader broadcasts messages to other tabs via BroadcastChannel
 * - Other tabs receive and process broadcasted messages identically
 *
 * Example: User profile change notification
 * 1. Server → WebSocket → Tab A (leader)
 * 2. Tab A processes notification + updates its UI
 * 3. Tab A broadcasts message to BroadcastChannel
 * 4. Tab B & C receive broadcast + update their UI
 * 5. Result: All tabs show updated profile simultaneously
 *
 * @param channelName - Unique channel identifier (typically workspace-scoped)
 * The channel also multiplexes durable-update readiness and transport status
 * without exposing that control traffic to the Yjs message handler.
 */
export const useBroadcastChannel = (channelName: string): BroadcastChannelType => {
  // The live channel for the current channelName. Closed-ness is tracked per
  // channel instance (not React state) so a workspace switch can never leak a
  // stale "closed" flag into the replacement channel and silently drop sends.
  const channelRef = useRef<BroadcastChannel | null>(null);
  const activeChannelNameRef = useRef<string | null>(null);
  // Protocol messages can be emitted by child layout effects before this hook's
  // passive channel-creation effect runs. Queue only during that initial gap;
  // sends after cleanup remain intentionally dropped.
  const pendingInitialPostsRef = useRef<unknown[] | null>([]);
  const protocolMessageListenersRef = useRef(new Set<(message: messages.Message) => void>());
  const outboxReadyListenersRef = useRef(new Set<(workspaceId: string, objectId: string) => void>());
  const transportSignalListenersRef = useRef(new Set<(signal: WorkspaceTransportSignal) => void>());
  const [lastMessageState, setLastMessageState] = useState<ChannelMessageState | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(channelName);

    channelRef.current = channel;
    activeChannelNameRef.current = channelName;
    const pendingInitialPosts = pendingInitialPostsRef.current ?? [];

    pendingInitialPostsRef.current = null;
    pendingInitialPosts.forEach((data) => {
      try {
        channel.postMessage(data);
      } catch (error) {
        Log.warn('Failed to flush an initial BroadcastChannel message', error);
      }
    });

    const handleMessage = (event: MessageEvent) => {
      if (isOutboxReadySignal(event.data)) {
        outboxReadyListenersRef.current.forEach((listener) => listener(event.data.workspaceId, event.data.objectId));
        return;
      }

      if (isWorkspaceTransportSignal(event.data)) {
        transportSignalListenersRef.current.forEach((listener) => listener(event.data));
        return;
      }

      const isDurableMessage = isDurableMessageSignal(event.data);
      const isBinaryMessage = event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data);

      if (!isDurableMessage && !isBinaryMessage) {
        Log.warn('Ignored an unknown workspace BroadcastChannel message');
        return;
      }

      let message: messages.Message;

      try {
        const payload = toUint8Array(isDurableMessage ? event.data.payload : event.data);

        message = messages.Message.decode(payload);
      } catch (error) {
        Log.warn('Failed to decode a workspace BroadcastChannel message', error);
        return;
      }

      setLastMessageState({ channelName, message });
      if (!isDurableMessage) {
        protocolMessageListenersRef.current.forEach((listener) => listener(message));
      }
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      channel.removeEventListener('message', handleMessage);

      if (channelRef.current === channel) {
        channelRef.current = null;
        activeChannelNameRef.current = null;
      }

      channel.close();
    };
  }, [channelName]);

  const sendMessage = useCallback((msg: messages.IMessage) => {
    const channel = channelRef.current;
    const payload = messages.Message.encode(msg).finish();

    if (!channel) {
      if (pendingInitialPostsRef.current) {
        pendingInitialPostsRef.current.push(payload);
        return;
      }

      // Fail silently instead of showing warning - this is normal during cleanup
      Log.debug('BroadcastChannel closed, skipping message send');
      return;
    }

    try {
      channel.postMessage(payload);
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidStateError') {
        if (channelRef.current === channel) {
          channelRef.current = null;
        }

        Log.debug('BroadcastChannel closed during send operation');
      } else {
        console.error('Failed to send message to BroadcastChannel:', error);
      }
    }
  }, []);

  const postDurableMessage = useCallback((msg: messages.IMessage) => {
    const channel = channelRef.current;

    const signal: DurableMessageSignal = {
      type: 'durable-message',
      payload: messages.Message.encode(msg).finish(),
    };

    if (!channel) {
      pendingInitialPostsRef.current?.push(signal);
      return;
    }

    try {
      channel.postMessage(signal);
    } catch (error) {
      Log.warn('Failed to broadcast a durable collab update', error);
    }
  }, []);

  const subscribeProtocolMessages = useCallback((listener: (message: messages.Message) => void) => {
    protocolMessageListenersRef.current.add(listener);

    return () => {
      protocolMessageListenersRef.current.delete(listener);
    };
  }, []);

  const postOutboxReady = useCallback((workspaceId: string, objectId: string) => {
    const signal: OutboxReadySignal = {
      type: 'outbox-ready',
      workspaceId,
      objectId,
    };

    const channel = channelRef.current;

    if (!channel) {
      if (pendingInitialPostsRef.current) {
        pendingInitialPostsRef.current.push(signal);
        return;
      }

      // `enqueueOutboxUpdate` invokes this callback after IndexedDB commits.
      // If its workspace switched while the add was in flight, the bound
      // channel may no longer be mounted. A short-lived sender still targets
      // the workspace that originated the durable row.
      postOutboxReadyOnTemporaryChannel(channelName, signal);

      return;
    }

    if (activeChannelNameRef.current !== channelName) {
      postOutboxReadyOnTemporaryChannel(channelName, signal);

      return;
    }

    try {
      channel.postMessage(signal);
    } catch (error) {
      if (error instanceof Error && error.name === 'InvalidStateError') {
        if (channelRef.current === channel) {
          channelRef.current = null;
          activeChannelNameRef.current = null;
        }

        postOutboxReadyOnTemporaryChannel(channelName, signal);
        return;
      }

      Log.warn('Failed to notify the WebSocket leader about a durable outbox update', {
        workspaceId,
        objectId,
        error,
      });
    }
  }, [channelName]);

  const subscribeOutboxReady = useCallback((listener: (workspaceId: string, objectId: string) => void) => {
    outboxReadyListenersRef.current.add(listener);

    return () => {
      outboxReadyListenersRef.current.delete(listener);
    };
  }, []);

  const postTransportSignal = useCallback((signal: WorkspaceTransportSignal) => {
    const channel = channelRef.current;

    if (!channel) {
      pendingInitialPostsRef.current?.push(signal);
      return;
    }

    try {
      channel.postMessage(signal);
    } catch (error) {
      Log.warn('Failed to post a workspace transport control signal', {
        signal,
        error,
      });
    }
  }, []);

  const subscribeTransportSignals = useCallback((listener: (signal: WorkspaceTransportSignal) => void) => {
    transportSignalListenersRef.current.add(listener);

    return () => {
      transportSignalListenersRef.current.delete(listener);
    };
  }, []);

  const lastBroadcastMessage = lastMessageState?.channelName === channelName ? lastMessageState.message : null;

  return {
    lastBroadcastMessage,
    postMessage: sendMessage,
    postDurableMessage,
    subscribeProtocolMessages,
    postOutboxReady,
    subscribeOutboxReady,
    postTransportSignal,
    subscribeTransportSignals,
  };
};
