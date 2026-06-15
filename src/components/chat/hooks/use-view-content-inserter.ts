import { EditorData } from '@appflowyinc/editor';
import { useCallback } from 'react';

import { useChatContext } from '@/components/chat/chat/context';

export function useViewContentInserter() {
  const { requestInstance } = useChatContext();

  const insertContentToView = useCallback(
    async (viewId: string, data: EditorData) => {
      try {
        await requestInstance.insertContentToView(viewId, data);
        // eslint-disable-next-line
      } catch (e: any) {
        return Promise.reject(e);
      }
    },
    [requestInstance],
  );

  const createViewWithContent = useCallback(
    async (parentViewId: string, name: string, data: EditorData) => {
      try {
        await requestInstance.createViewWithContent(parentViewId, name, data);
        // eslint-disable-next-line
      } catch (e: any) {
        return Promise.reject(e);
      }
    },
    [requestInstance],
  );

  return {
    insertContentToView,
    createViewWithContent,
  };
}
