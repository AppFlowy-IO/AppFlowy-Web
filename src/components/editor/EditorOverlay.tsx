import { EditorData } from '@appflowyinc/editor';
import { Portal } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Range, Text, Transforms } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { isEmbedBlockTypes } from '@/application/slate-yjs/command/const';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { getBlock, getText } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { insertDataAfterBlock } from '@/components/ai-chat/utils';
import { useAIEnabled } from '@/components/app/app.hooks';
import { AIAssistantProvider, ContextPlaceholder, PromptModalProvider } from '@/components/chat';
import { WriterRequest } from '@/components/chat/request/writer-request';
import { useWriterContext } from '@/components/chat/writer/context';
import { useEditorContext, useEditorLocalState } from '@/components/editor/EditorContext';
import { getScrollParent } from '@/components/global-comment/utils';


import Panels from './components/panels';
import Toolbars from './components/toolbar';

/**
 * The AI writer preview is portaled into the selected block, inside Slate's
 * contenteditable. Render it only while the writer is open, and never as
 * editable content: Slate cannot map a caret inside it (Firefox puts the caret
 * there on a click below an empty line), so the browser would insert typed text
 * into this node natively and it would never reach the document.
 */
function WriterPlaceholder({ container, offset }: { container: HTMLElement | null; offset: number }) {
  const { assistantType } = useWriterContext();

  if (!assistantType) return null;

  return (
    <Portal container={container}>
      <div
        contentEditable={false}
        style={offset ? { transform: `translateY(-${offset}px)` } : undefined}
        className={'flex w-full'}
      >
        <ContextPlaceholder />
      </div>
    </Portal>
  );
}

function EditorOverlay({ viewId, workspaceId }: { viewId: string; workspaceId: string }) {
  const { requestInstance, loadDatabasePrompts, testDatabasePromptConfig } = useEditorContext();
  const aiEnabled = useAIEnabled();
  const editor = useSlate() as YjsEditor;
  const selection = editor.selection;
  const isRange = selection ? Range.isExpanded(selection) : false;
  const start = useMemo(() => (selection ? editor.start(selection) : null), [editor, selection]);
  const end = useMemo(() => (selection ? editor.end(selection) : null), [editor, selection]);
  const startBlock = useMemo(() => {
    if (!start) return null;
    try {
      return getBlockEntry(editor, start);
    } catch (e) {
      return null;
    }
  }, [editor, start]);

  const endBlock = useMemo(() => {
    if (!end) return null;
    try {
      return getBlockEntry(editor, end);
    } catch (e) {
      return null;
    }
  }, [editor, end]);

  const writerRequest = useMemo(() => {
    return new WriterRequest(workspaceId, viewId, requestInstance || undefined);
  }, [workspaceId, viewId, requestInstance]);

  const handleInsertBelow = useCallback(
    (data: EditorData) => {
      if (!endBlock) return;
      try {
        const [node] = endBlock;

        if (!node) return;

        const blockId = insertDataAfterBlock(editor.sharedRoot, data, node.blockId as string);

        try {
          ReactEditor.focus(editor);
          const entry = findSlateEntryByBlockId(editor, blockId);

          if (!entry) return;

          const [, path] = entry;

          editor.select(editor.end(path));
        } catch (e) {
          //
        }
      } catch (e) {
        console.error(e);
      }
    },
    [editor, endBlock]
  );

  const handleReplaceSelection = useCallback(
    (data: EditorData) => {
      try {
        if (data.length === 1 && !isEmbedBlockTypes(data[0].type as unknown as BlockType)) {
          ReactEditor.focus(editor);
          if (Range.isExpanded(editor.selection as Range)) {
            CustomEditor.deleteBlockForward(editor);
          }

          const texts =
            data[0].delta?.map((op) => {
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
          ReactEditor.focus(editor);
          if (Range.isExpanded(editor.selection as Range)) {
            CustomEditor.deleteBlockForward(editor);
          }

          if (!startBlock) return;

          const [node] = startBlock;

          if (!node) return;

          const blockId = insertDataAfterBlock(editor.sharedRoot, data, node.blockId as string);
          const startYBlock = getBlock(node.blockId as string, editor.sharedRoot);
          const startYText = getText(startYBlock.get(YjsEditorKey.block_external_id), editor.sharedRoot);

          if (startYText && startYText.length === 0) {
            CustomEditor.deleteBlock(editor, node.blockId as string);
          }

          ReactEditor.focus(editor);
          const entry = findSlateEntryByBlockId(editor, blockId);

          if (!entry) return;

          const [, path] = entry;

          editor.select(editor.end(path));
        }
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [editor, startBlock]
  );
  const { removeDecorate } = useEditorLocalState();

  const handleExit = useCallback(() => {
    removeDecorate?.('ai-writer');
    if (!ReactEditor.isFocused(editor)) {
      ReactEditor.focus(editor);
    }
  }, [removeDecorate, editor]);

  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [scrollerContainer, setScrollerContainer] = useState<HTMLDivElement | null>(null);
  const [absoluteHeight, setAbsoluteHeight] = useState(0);

  useEffect(() => {
    if (endBlock) {
      const [node] = endBlock;

      try {
        const dom = ReactEditor.toDOMNode(editor, node);

        const firstChild = dom.firstChild as HTMLElement;

        if (firstChild && firstChild.innerText.trim() === '') {
          setAbsoluteHeight(firstChild.offsetHeight);
        } else {
          setAbsoluteHeight(0);
        }

        setContainer(dom as HTMLDivElement);

        const container = dom.closest('.appflowy-scroll-container') || getScrollParent(dom);

        setScrollerContainer(container as HTMLDivElement);
      } catch (e) {
        console.error(e);
      }
    }
  }, [editor, endBlock]);

  return (
    <ErrorBoundary fallbackRender={() => null}>
      <PromptModalProvider
        workspaceId={workspaceId}
        loadDatabasePrompts={loadDatabasePrompts}
        testDatabasePromptConfig={testDatabasePromptConfig}
      >
        <AIAssistantProvider
          isGlobalDocument={!isRange}
          onInsertBelow={handleInsertBelow}
          onReplace={handleReplaceSelection}
          request={writerRequest}
          viewId={viewId}
          onExit={handleExit}
          scrollContainer={scrollerContainer || undefined}
          enabled={aiEnabled}
        >
          <Toolbars />
          <Panels />
          <WriterPlaceholder container={container} offset={absoluteHeight} />
        </AIAssistantProvider>
      </PromptModalProvider>
    </ErrorBoundary>
  );
}

export default EditorOverlay;
