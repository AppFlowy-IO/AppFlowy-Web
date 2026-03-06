import { useCallback, useEffect, useRef, useState } from 'react';
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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setLoading(true);
      setChatSettings(null);
    };
  }, [chatId]);

  const fetchChatSettings = useCallback(async() => {
    try {
      const data = await requestInstance.getChatSettings();

      if (!mountedRef.current) return;
      setLoading(false);
      setChatSettings(data);
      return data;
      // eslint-disable-next-line
    } catch(e: any) {
      if (mountedRef.current) setLoading(false);
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
