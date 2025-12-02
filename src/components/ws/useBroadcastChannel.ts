import { useCallback, useEffect, useMemo, useState } from 'react';

import { messages } from '@/proto/messages';
import { Log } from '@/utils/log';

export type BroadcastChannelType = {
  lastBroadcastMessage: messages.Message | null;
  postMessage: (msg: messages.IMessage, keep?: boolean) => void;
};

/**
 * Hook for cross-tab synchronization using BroadcastChannel API
 * 
 * Purpose: Enables communication between multiple browser tabs of the same workspace
 * to ensure consistent real-time updates across all tabs.
 * 
 * Multi-tab Architecture:
 * - Only one tab per workspace maintains active WebSocket connection
 * - That "active" tab receives server notifications directly
 * - Active tab broadcasts messages to other tabs via BroadcastChannel
 * - Other tabs receive and process broadcasted messages identically
 * 
 * Example: User profile change notification
 * 1. Server → WebSocket → Tab A (active)
 * 2. Tab A processes notification + updates its UI
 * 3. Tab A broadcasts message to BroadcastChannel
 * 4. Tab B & C receive broadcast + update their UI
 * 5. Result: All tabs show updated profile simultaneously
 * 
 * @param channelName - Unique channel identifier (typically workspace-scoped)
 * @returns Object with lastBroadcastMessage and postMessage function
 */
export const useBroadcastChannel = (channelName: string): BroadcastChannelType => {
  const channel = useMemo(() => new BroadcastChannel(channelName), [channelName]);
  const [lastMessage, setLastMessage] = useState<messages.Message | null>(null);
  const [isChannelClosed, setIsChannelClosed] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = messages.Message.decode(new Uint8Array(event.data));

      setLastMessage(message);
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      channel.removeEventListener('message', handleMessage);
      setIsChannelClosed(true);
      channel.close();
    };
  }, [channel]);

  const sendMessage = useCallback(
    (msg: messages.IMessage) => {
      if (isChannelClosed) {
        // Fail silently instead of showing warning - this is normal during cleanup
        Log.debug('BroadcastChannel closed, skipping message send');
        return;
      }

      try {
        channel.postMessage(messages.Message.encode(msg).finish());
      } catch (error) {
        if (error instanceof Error && error.name === 'InvalidStateError') {
          setIsChannelClosed(true);
          Log.debug('BroadcastChannel closed during send operation');
        } else {
          console.error('Failed to send message to BroadcastChannel:', error);
        }
      }
    },
    [channel, isChannelClosed]
  );

  return { lastBroadcastMessage: lastMessage, postMessage: sendMessage };
};
