import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { Skeleton } from '@mui/material';
import React, { lazy, Suspense, useCallback, useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { BaseRange, Editor, Element as SlateElement, NodeEntry, Range, Text } from 'slate';
import { Editable, ReactEditor, RenderElementProps, useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { BlockPopoverProvider } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { useDecorate } from '@/components/editor/components/blocks/code/useDecorate';
import { Leaf } from '@/components/editor/components/leaf';
import HrefPopover from '@/components/editor/components/leaf/href/HrefPopover';
import { LeafContext } from '@/components/editor/components/leaf/leaf.hooks';
import { PanelProvider } from '@/components/editor/components/panels/PanelsContext';
import { RemoteSelectionsLayer } from '@/components/editor/components/remote-selections';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useShortcuts } from '@/components/editor/shortcut.hooks';
import { ElementFallbackRender } from '@/components/error/ElementFallbackRender';
import { getScrollParent } from '@/components/global-comment/utils';
import { cn } from '@/lib/utils';

import { Element } from './components/element';

const EditorOverlay = lazy(() => import('@/components/editor/EditorOverlay'));

const EditorEditable = () => {
  const { readOnly, decorateState, viewId, workspaceId, fullWidth } = useEditorContext();
  const editor = useSlate();

  const codeDecorate = useDecorate(editor);

  const decorate = useCallback(
    ([, path]: NodeEntry): BaseRange[] => {
      const highlightRanges: (Range & {
        class_name: string;
      })[] = [];

      if (!decorateState) return [];

      Object.values(decorateState).forEach((state) => {
        const intersection = Range.intersection(state.range, Editor.range(editor, path));

        if (intersection) {
          highlightRanges.push({
            ...intersection,
            class_name: state.class_name,
          });
        }
      });

      return highlightRanges;
    },
    [editor, decorateState]
  );
  const renderElement = useCallback((props: RenderElementProps) => {
    return (
      <Suspense fallback={<Skeleton width={'100%'} height={24} />}>
        <Element {...props} />
      </Suspense>
    );
  }, []);

  const { onKeyDown } = useShortcuts(editor);

  const onCompositionStart = useCallback(() => {
    const { selection } = editor;

    if (!selection) return;
    if (Range.isExpanded(selection)) {
      editor.delete();
    }
  }, [editor]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const currentTarget = e.currentTarget as HTMLElement;
      const bottomArea = currentTarget.getBoundingClientRect().bottom - 56 * 4;

      if (e.clientY > bottomArea && e.clientY < bottomArea + 56) {
        const lastBlock = editor.children[editor.children.length - 1] as SlateElement;
        const isEmptyLine = CustomEditor.getBlockTextContent(lastBlock) === '';
        const type = lastBlock.type;

        if (!lastBlock) return;
        if (isEmptyLine && type === BlockType.Paragraph) {
          editor.select(editor.end([editor.children.length - 1]));
          return;
        }

        CustomEditor.addBelowBlock(editor as YjsEditor, lastBlock.blockId as string, BlockType.Paragraph, {});
      }
    },
    [editor]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const detail = e.detail;

    if (detail >= 3) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  const [linkOpen, setLinkOpen] = React.useState<Text | undefined>(undefined);
  const handleOpenLinkPopover = useCallback((text: Text) => {
    setLinkOpen(text);
  }, []);

  const handleCloseLinkPopover = useCallback(() => {
    setLinkOpen(undefined);
  }, []);

  useEffect(() => {
    try {
      const editorDom = ReactEditor.toDOMNode(editor, editor);
      const scrollContainer = getScrollParent(editorDom);

      if (!scrollContainer) return;

      return autoScrollForElements({
        element: scrollContainer,
      });
    } catch (e) {
      console.error('Error initializing auto-scroll:', e);
    }
  }, [editor]);

  return (
    <PanelProvider editor={editor}>
      <BlockPopoverProvider editor={editor}>
        <LeafContext.Provider
          value={{
            linkOpen,
            openLinkPopover: handleOpenLinkPopover,
            closeLinkPopover: handleCloseLinkPopover,
          }}
        >
          <ErrorBoundary fallbackRender={ElementFallbackRender}>
            <Editable
              role={'textbox'}
              data-testid={'editor-content'}
              decorate={(entry: NodeEntry) => {
                const codeDecoration = codeDecorate?.(entry);
                const decoration = decorate(entry);

                return [...codeDecoration, ...decoration];
              }}
              id={`editor-${viewId}`}
              className={cn(
                'custom-caret min-w-0 max-w-full scroll-mb-[100px] scroll-mt-[300px] px-24 pb-56 outline-none focus:outline-none max-sm:px-6',
                fullWidth ? 'w-full' : 'w-[952px]'
              )}
              renderLeaf={Leaf}
              renderElement={renderElement}
              readOnly={readOnly}
              spellCheck={false}
              autoCorrect={'off'}
              autoComplete={'off'}
              onCompositionStart={onCompositionStart}
              onKeyDown={onKeyDown}
              onMouseDown={handleMouseDown}
              onClick={handleClick}
            />
          </ErrorBoundary>

          {!readOnly && (
            <Suspense>
              <EditorOverlay workspaceId={workspaceId} viewId={viewId} />
              <HrefPopover open={!!linkOpen} onClose={handleCloseLinkPopover} />
            </Suspense>
          )}

          <div className={cn('pointer-events-none absolute left-0 right-0 top-0 flex h-full justify-center')}>
            <div
              className={cn(fullWidth ? 'w-full' : 'w-[952px]', 'relative h-full min-w-0 max-w-full px-24 max-sm:px-6')}
            >
              <ErrorBoundary fallback={null}>
                <RemoteSelectionsLayer editor={editor} />
              </ErrorBoundary>
            </div>
          </div>
        </LeafContext.Provider>
      </BlockPopoverProvider>
    </PanelProvider>
  );
};

export default EditorEditable;
