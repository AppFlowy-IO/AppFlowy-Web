import { createContext, ReactNode, useContext, useId } from 'react';

// Each preview has its own DOM namespace, while document editors keep their
// normal block identities. Nested editors explicitly reset the preview state.
const EditorPreviewContext = createContext<string | undefined>(undefined);

export function EditorPreviewContextProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const id = useId();

  return (
    <EditorPreviewContext.Provider value={enabled ? `preview-${id}-` : undefined}>
      {children}
    </EditorPreviewContext.Provider>
  );
}

export function useEditorPreviewId() {
  return useContext(EditorPreviewContext);
}
