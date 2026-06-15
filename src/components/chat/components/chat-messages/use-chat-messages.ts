import { useCallback, useRef, useState } from 'react';

import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { useChatMessagesContext } from '@/components/chat/provider/messages-provider';

const DEFAULT_LIMIT = 20;

interface FetchMessagesParams {
  limit?: number;
  before?: number;
}

export function useChatMessages() {
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const lastMessageId = useRef<number | null>(null);
  const isInitialLoad = useRef(true);
  const loadingRef = useRef(false);

  const {
    messageIds,
  } = useChatMessagesContext();
  const {
    fetchMessages,
  } = useMessagesHandlerContext();

  const fetchMessagesWithParams = useCallback(async(params: FetchMessagesParams) => {
    if(loadingRef.current) return;

    try {
      setIsLoading(true);
      const data = await fetchMessages(params);

      if(data.messages.length > 0) {
        const messages = data.messages.map(message => message.message_id);

        lastMessageId.current = messages[messages.length - 1];
      }

      setHasMore(data.has_more);
      return data;
      // eslint-disable-next-line
    } catch(e: any) {
      // do nothing
    } finally {
      setIsLoading(false);
    }
  }, [fetchMessages]);

  const fetchInitialMessages = useCallback(async() => {
    isInitialLoad.current = true;
    const data = await fetchMessagesWithParams({ limit: DEFAULT_LIMIT });

    isInitialLoad.current = false;
    return data;
  }, [fetchMessagesWithParams]);

  const loadMoreMessages = useCallback(async() => {
    if(!lastMessageId.current) return;

    await fetchMessagesWithParams({
      limit: DEFAULT_LIMIT,
      before: lastMessageId.current,
    });
  }, [fetchMessagesWithParams]);

  return {
    messageIds,
    hasMore,
    isLoading,
    fetchInitialMessages,
    loadMoreMessages,
  };
}