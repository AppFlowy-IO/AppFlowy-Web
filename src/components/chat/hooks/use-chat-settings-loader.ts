import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useChatContext } from '@/components/chat/chat/context';
import { ChatSettings } from '@/components/chat/types';

export function useChatSettingsLoader() {
  const [loading, setLoading] = useState(true);
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null);
  const {
    requestInstance,
    chatId,
  } = useChatContext();

  useEffect(() => {
    return () => {
      setLoading(true);
      setChatSettings(null);
    };
  }, [chatId]);

  const fetchChatSettings = useCallback(async() => {
    try {
      const data = await requestInstance.getChatSettings();

      setLoading(false);
      setChatSettings(data);
      return data;
      // eslint-disable-next-line
    } catch(e: any) {
      setLoading(false);
    }
  }, [requestInstance]);

  const updateChatSettings = useCallback(async(payload: Partial<ChatSettings>) => {
    // Optimistic update
    setChatSettings(current => {
      if (!current) return current;
      const updated = { ...current, ...payload };

      if (payload.metadata && current.metadata) {
        updated.metadata = { ...current.metadata, ...payload.metadata };
      }

      return updated;
    });

    try {
      await requestInstance.updateChatSettings(payload);
      // eslint-disable-next-line
    } catch(e: any) {
      // Rollback by re-fetching server state
      void fetchChatSettings();
      toast.error(e.message);
    }
  }, [requestInstance, fetchChatSettings]);

  return {
    loading,
    fetchChatSettings,
    updateChatSettings,
    chatSettings,
  };
}
