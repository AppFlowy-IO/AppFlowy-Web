import { EditorData } from '@appflowyinc/editor';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

import { useChatContext } from '@/components/chat/chat/context';

/** What copy and "Add to page" need from a rendered answer. */
export interface MessageEditor {
  getData: () => EditorData;
}

interface EditorContextTypes {
  getEditor: (messageId: number) => MessageEditor | undefined;
  setEditor: (messageId: number, editor: MessageEditor) => void;
}

const EditorContext = createContext<EditorContextTypes | undefined>(undefined);

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const {
    chatId,
  } = useChatContext();
  const editorsRef = useRef<Map<number, MessageEditor>>(new Map());

  useEffect(() => {
    editorsRef.current.clear();
  }, [chatId]);

  const getEditor = useCallback((messageId: number) => {
    return editorsRef.current.get(messageId);
  }, [editorsRef]);

  const setEditor = useCallback((messageId: number, editor: MessageEditor) => {
    editorsRef.current.set(messageId, editor);
  }, [editorsRef]);
  const contextValue = useMemo(
    () => ({
      getEditor,
      setEditor,
    }),
    [getEditor, setEditor]
  );

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
};

export function useEditorContext() {
  const context = useContext(EditorContext);

  if(!context) {
    throw new Error('useEditorContext must be used within a EditorProvider');
  }

  return context;
}
