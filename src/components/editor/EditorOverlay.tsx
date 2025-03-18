import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import '@appflowyinc/ai-chat/style';
import { insertDataAfterBlock } from '@/components/ai-chat/utils';
import { useEditorContext } from '@/components/editor/EditorContext';
import { AIAssistantProvider, WriterRequest, ContextPlaceholder } from '@appflowyinc/ai-chat';
import { EditorData } from '@appflowyinc/editor';
import { Portal } from '@mui/material';
import React, {
  useCallback,
  useMemo,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ReactEditor, useSlate } from 'slate-react';
import Toolbars from './components/toolbar';
import Panels from './components/panels';
import BlockPopover from './components/block-popover';
import { Element, NodeEntry, Path, Transforms, Text, Range } from 'slate';

function EditorOverlay({
  viewId,
  workspaceId,
}: {
  viewId: string;
  workspaceId: string;
}) {

  const editor = useSlate() as YjsEditor;
  const selection = editor.selection;
  const isRange = selection ? Range.isExpanded(selection) : false;
  const start = useMemo(() => selection ? editor.start(selection) : null, [editor, selection]);
  const end = useMemo(() => selection ? editor.end(selection) : null, [editor, selection]);

  const startBlock = useMemo(() => {
    if(!start) return null;
    try {
      return getBlockEntry(editor, start);
    } catch(e) {
      return null;
    }
  }, [editor, start]);

  const endBlock = useMemo(() => {
    if(!end) return null;
    try {
      return getBlockEntry(editor, end);
    } catch(e) {
      return null;
    }
  }, [editor, end]);

  const writerRequest = useMemo(() => {
    return new WriterRequest(workspaceId, viewId);
  }, [workspaceId, viewId]);

  const handleInsertBelow = useCallback((data: EditorData) => {
    if(!endBlock) return;
    const [node, path] = endBlock as NodeEntry<Element>;

    if(!node) return;

    insertDataAfterBlock(editor.sharedRoot, data, node.blockId as string);

    try {
      const nextPath = Path.next(path);

      ReactEditor.focus(editor);
      editor.select(editor.start(nextPath));
    } catch(e) {
      //
    }

  }, [editor, endBlock]);

  const handleReplaceSelection = useCallback((data: EditorData) => {
    if(data.length === 1) {
      ReactEditor.focus(editor);
      editor.delete();
      const texts = data[0].delta?.map(op => {
        return {
          text: op.insert,
          ...op.attributes,
        };
      }) || [];

      Transforms.insertNodes(editor, texts as Text[], {
        select: true,
        voids: false,
      });

      return;
    } else {
      CustomEditor.insertBreak(editor);
      if(!startBlock) return;
      const [node] = startBlock as NodeEntry<Element>;

      if(!node) return;

      const blockId = insertDataAfterBlock(editor.sharedRoot, data, node.blockId as string);

      ReactEditor.focus(editor);
      const [, path] = findSlateEntryByBlockId(editor, blockId);

      editor.select(editor.end(path));

    }
  }, [editor, startBlock]);
  const {
    removeDecorate,
  } = useEditorContext();

  const handleExit = useCallback(() => {
    removeDecorate?.('ai-writer');
  }, [removeDecorate]);

  return (
    <ErrorBoundary fallbackRender={() => null}>

      <AIAssistantProvider
        isGlobalDocument={!isRange}
        onInsertBelow={handleInsertBelow}
        onReplace={handleReplaceSelection}
        request={writerRequest}
        viewId={viewId}
        onExit={handleExit}
      >
        <Toolbars />
        <Panels />
        <BlockPopover />
        <Portal
          container={() => {
            if(!endBlock) return null;
            const [node] = endBlock;

            return ReactEditor.toDOMNode(editor, node);
          }}
        >
          <ContextPlaceholder />
        </Portal>

      </AIAssistantProvider>
    </ErrorBoundary>

  );
}

export default EditorOverlay;