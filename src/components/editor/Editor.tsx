import { memo, useCallback, useState } from 'react';

import { YjsEditor } from '@/application/slate-yjs';
import { YDoc } from '@/application/types';
import CollaborativeEditor from '@/components/editor/CollaborativeEditor';
import { defaultLayoutStyle, EditorContextProvider, EditorContextState } from '@/components/editor/EditorContext';
import { EditorPreviewContextProvider } from '@/components/editor/EditorPreviewContext';
import './editor.scss';

export interface EditorProps extends EditorContextState {
  doc: YDoc;
  /** Isolate preview DOM identities and prevent nested Feed document previews. */
  preview?: boolean;
  onEditorConnected?: (editor: YjsEditor) => void;
  onSelectionChange?: (editor: YjsEditor) => void;
}

export const Editor = memo(
  ({
    doc,
    preview = false,
    onEditorConnected,
    onSelectionChange,
    layoutStyle = defaultLayoutStyle,
    ...props
  }: EditorProps) => {
    const [codeGrammars, setCodeGrammars] = useState<Record<string, string>>({});

    const handleAddCodeGrammars = useCallback((blockId: string, grammar: string) => {
      setCodeGrammars((prev) => ({ ...prev, [blockId]: grammar }));
    }, []);

    return (
      <EditorPreviewContextProvider enabled={preview}>
        <EditorContextProvider
          {...props}
          codeGrammars={codeGrammars}
          addCodeGrammars={handleAddCodeGrammars}
          layoutStyle={layoutStyle}
        >
          <CollaborativeEditor doc={doc} onEditorConnected={onEditorConnected} onSelectionChange={onSelectionChange} />
        </EditorContextProvider>
      </EditorPreviewContextProvider>
    );
  }
);

export default Editor;
