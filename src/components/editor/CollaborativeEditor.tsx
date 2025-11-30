import { debounce } from 'lodash-es';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createEditor, Descendant } from 'slate';
import { Slate, withReact } from 'slate-react';
import * as Y from 'yjs';

import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs, YjsEditor } from '@/application/slate-yjs/plugins/withYjs';
import { CollabOrigin } from '@/application/types';
import EditorEditable from '@/components/editor/Editable';
import { useEditorContext } from '@/components/editor/EditorContext';
import { withPlugins } from '@/components/editor/plugins';
import { clipboardFormatKey } from '@/components/editor/plugins/withCopy';
import { getTextCount } from '@/utils/word';

const defaultInitialValue: Descendant[] = [];

function CollaborativeEditor({
  doc,
  onEditorConnected,
  onSelectionChange,
}: {
  doc: Y.Doc;
  onEditorConnected?: (editor: YjsEditor) => void;
  onSelectionChange?: (editor: YjsEditor) => void;
}) {
  const context = useEditorContext();
  const readSummary = context.readSummary;
  const onRendered = context.onRendered;
  const uploadFile = context.uploadFile;
  const readOnly = context.readOnly;
  const viewId = context.viewId;
  const onWordCountChange = context.onWordCountChange;
  const [, setClock] = useState(0);
  const onContentChange = useCallback(
    (content: Descendant[]) => {
      const wordCount = getTextCount(content);

      onWordCountChange?.(viewId, wordCount);
      setClock((prev) => prev + 1);
      onRendered?.();
    },
    [onWordCountChange, viewId, onRendered]
  );

  const debounceCalculateWordCount = useMemo(() => {
    return debounce((editor) => {
      const wordCount = getTextCount(editor.children);

      onWordCountChange?.(viewId, wordCount);
    }, 300);
  }, [onWordCountChange, viewId]);

  const handleSelectionChange = useCallback(
    (editor: YjsEditor) => {
      onSelectionChange?.(editor);

      debounceCalculateWordCount(editor);
    },
    [onSelectionChange, debounceCalculateWordCount]
  );

  const editor = useMemo(
    () =>
      doc &&
      (withPlugins(
        withReact(
          withYHistory(
            withYjs(createEditor(), doc, {
              readOnly,
              localOrigin: CollabOrigin.Local,
              readSummary,
              onContentChange,
              uploadFile,
              id: viewId,
              onSelectionChange: handleSelectionChange,
            })
          ),
          clipboardFormatKey
        )
      ) as YjsEditor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewId, doc]
  );
  const [, setIsConnected] = useState(false);

  useEffect(() => {
    if (!editor) return;

    editor.connect();
    setIsConnected(true);
    onEditorConnected?.(editor);

    // Expose editor and doc for E2E testing in development/test mode
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
      const testWindow = window as Window & {
        __TEST_EDITOR__?: YjsEditor;
        __TEST_DOC__?: Y.Doc;
        Y?: typeof Y;
      };

      testWindow.__TEST_EDITOR__ = editor;
      testWindow.__TEST_DOC__ = doc;
      testWindow.Y = Y; // Expose Yjs module for creating test blocks
    }

    return () => {
      console.debug('disconnect');
      editor.disconnect();
      // Clean up test references
      if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
        const testWindow = window as Window & {
          __TEST_EDITOR__?: YjsEditor;
          __TEST_DOC__?: Y.Doc;
          Y?: typeof Y;
        };

        delete testWindow.__TEST_EDITOR__;
        delete testWindow.__TEST_DOC__;
        // Keep Y exposed as it might be needed for other editors
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <Slate editor={editor} initialValue={defaultInitialValue}>
      <EditorEditable />
    </Slate>
  );
}

export default memo(CollaborativeEditor);
