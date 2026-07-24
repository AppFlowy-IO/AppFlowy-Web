import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { RAG_SOURCE_OWNERS_METADATA_KEY } from '@/components/ai-chat/rag-scope';
import { useChatContext } from '@/components/chat/chat/context';
import { ChatSettings } from '@/components/chat/types';

const SUBMISSION_CRITICAL_SETTINGS_KEYS = new Set([
  'rag_ids',
  'full_workspace',
  `metadata.${RAG_SOURCE_OWNERS_METADATA_KEY}`,
]);

export function useChatSettingsLoader() {
  const { requestInstance, chatId } = useChatContext();
  const [state, setState] = useState<{
    chatId: string;
    requestInstance: typeof requestInstance;
    loading: boolean;
    chatSettings: ChatSettings | null;
  }>(() => ({ chatId, requestInstance, loading: true, chatSettings: null }));
  const mountedRef = useRef(true);
  const currentOwnerRef = useRef({ chatId, requestInstance });
  const writeQueue = useMemo(
    () => ({
      chatId,
      requestInstance,
      tail: Promise.resolve(),
      failedKeys: new Set<string>(),
      unverifiedKeys: new Set<string>(),
    }),
    [chatId, requestInstance]
  );

  currentOwnerRef.current = { chatId, requestInstance };
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ownsCurrentChat = state.chatId === chatId && state.requestInstance === requestInstance;
  const loading = ownsCurrentChat ? state.loading : true;
  const chatSettings = ownsCurrentChat ? state.chatSettings : null;

  const fetchChatSettingsFromServer = useCallback(async () => {
    const owner = { chatId, requestInstance };

    try {
      const data = await requestInstance.getChatSettings();

      if (
        !mountedRef.current ||
        currentOwnerRef.current.chatId !== owner.chatId ||
        currentOwnerRef.current.requestInstance !== owner.requestInstance
      ) {
        return;
      }

      setState({ ...owner, loading: false, chatSettings: data });
      return data;
      // eslint-disable-next-line
    } catch (e: any) {
      if (
        mountedRef.current &&
        currentOwnerRef.current.chatId === owner.chatId &&
        currentOwnerRef.current.requestInstance === owner.requestInstance
      ) {
        setState({ ...owner, loading: false, chatSettings: null });
      }
    }
  }, [chatId, requestInstance]);

  const fetchChatSettings = useCallback(() => {
    // Reads participate in the queue so a refresh cannot overwrite a newer
    // optimistic value with a response captured before its POST completed.
    const read = writeQueue.tail.then(async () => {
      const data = await fetchChatSettingsFromServer();

      if (data) {
        // A successful authoritative read makes any earlier ambiguous write
        // safe to reason about again. Scope validation still runs before send.
        writeQueue.failedKeys.clear();
        writeQueue.unverifiedKeys.clear();
      }

      return data;
    });

    writeQueue.tail = read.then(() => undefined);
    return read;
  }, [fetchChatSettingsFromServer, writeQueue]);

  const persistChatSettings = useCallback(
    (payload: Partial<ChatSettings>) => {
      const owner = { chatId, requestInstance };
      const payloadKeys = [
        ...Object.keys(payload).filter((key) => key !== 'metadata'),
        ...Object.keys(payload.metadata || {}).map((key) => `metadata.${key}`),
      ];
      const criticalPayloadKeys = payloadKeys.filter((key) => SUBMISSION_CRITICAL_SETTINGS_KEYS.has(key));
      const operation = writeQueue.tail.then(async () => {
        // Apply updates in the same order as their server writes. This prevents
        // model, web-search, and RAG metadata patches from racing each other.
        setState((current) => {
          if (
            current.chatId !== owner.chatId ||
            current.requestInstance !== owner.requestInstance ||
            !current.chatSettings
          ) {
            return current;
          }

          const updated = { ...current.chatSettings, ...payload };

          if (payload.metadata && current.chatSettings.metadata) {
            updated.metadata = { ...current.chatSettings.metadata, ...payload.metadata };
          }

          return { ...current, chatSettings: updated };
        });

        try {
          await requestInstance.updateChatSettings(payload);
          payloadKeys.forEach((key) => {
            writeQueue.failedKeys.delete(key);
            writeQueue.unverifiedKeys.delete(key);
          });
          // eslint-disable-next-line
        } catch (e: any) {
          criticalPayloadKeys.forEach((key) => writeQueue.failedKeys.add(key));
          // Roll back by re-fetching server state before the next queued write.
          // This read is already inside the queued operation. Calling the public
          // queued reader here would wait on itself and deadlock.
          const rollbackSettings = await fetchChatSettingsFromServer();

          if (!rollbackSettings) {
            criticalPayloadKeys.forEach((key) => writeQueue.unverifiedKeys.add(key));
          }

          if (
            mountedRef.current &&
            currentOwnerRef.current.chatId === owner.chatId &&
            currentOwnerRef.current.requestInstance === owner.requestInstance
          ) {
            toast.error(e.message);
          }

          throw e;
        }
      });

      // The queue tail represents settlement and always resolves; callers still
      // receive the rejecting operation so they can handle their own write.
      writeQueue.tail = operation.catch(() => undefined);
      return operation;
    },
    [chatId, requestInstance, fetchChatSettingsFromServer, writeQueue]
  );

  const waitForPendingChatSettings = useCallback(async () => {
    const waitForTail = async (pending: Promise<void>): Promise<boolean> => {
      await pending;

      if (writeQueue.tail === pending) {
        const ready = writeQueue.failedKeys.size === 0;

        // One send attempt reports the lost source change. After rollback the
        // server state is authoritative again, so a deliberate retry can use it.
        if (!ready) {
          writeQueue.failedKeys.forEach((key) => {
            if (!writeQueue.unverifiedKeys.has(key)) writeQueue.failedKeys.delete(key);
          });
        }

        return ready;
      }

      return waitForTail(writeQueue.tail);
    };

    return waitForTail(writeQueue.tail);
  }, [writeQueue]);

  const updateChatSettings = useCallback(
    async (payload: Partial<ChatSettings>) => {
      try {
        await persistChatSettings(payload);
      } catch {
        // Errors are already rolled back and surfaced by persistChatSettings.
      }
    },
    [persistChatSettings]
  );

  return {
    loading,
    fetchChatSettings,
    persistChatSettings,
    waitForPendingChatSettings,
    updateChatSettings,
    chatSettings,
  };
}
