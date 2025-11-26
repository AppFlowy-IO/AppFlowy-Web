import { forwardRef, memo, useCallback, useEffect, useRef, useState } from 'react';
import { Element } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { DatabaseContextState } from '@/application/database-yjs';
import { YjsEditorKey, YSharedRoot } from '@/application/types';
import { DatabaseNode, EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';

import { DatabaseContent } from './components/DatabaseContent';
import { useDatabaseLoading } from './hooks/useDatabaseLoading';
import { useResizePositioning } from './hooks/useResizePositioning';

export const DatabaseBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<DatabaseNode>>(({ node, children, ...attributes }, ref) => {
    const viewId = node.data.view_id;
    const context = useEditorContext();
    const workspaceId = context.workspaceId;
    const navigateToView = context?.navigateToView;
    const loadView = context?.loadView;
    const createRowDoc = context?.createRowDoc;

    const [hasDatabase, setHasDatabase] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const editor = useSlateStatic();
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);

    const { notFound, doc, selectedViewId, visibleViewIds, iidName, onChangeView, loadViewMeta } = useDatabaseLoading({
      viewId,
      loadView,
      loadViewMeta: context?.loadViewMeta,
    });

    // Track latest valid scroll position to restore if layout shift resets it
    const latestScrollTop = useRef<number>(0);

    useEffect(() => {
      let scrollContainer: HTMLElement | null = null;
      
      try {
        const domNode = ReactEditor.toDOMNode(editor, editor);
        
        scrollContainer = domNode.closest('.appflowy-scroll-container');
      } catch {
        // ignore
      }

      if (!scrollContainer) {
        scrollContainer = document.querySelector('.appflowy-scroll-container');
      }

      if (!scrollContainer) return;

      // Initialize with current scroll position if already scrolled
      if (scrollContainer.scrollTop > 0) {
        latestScrollTop.current = scrollContainer.scrollTop;
      }

      const handleScroll = () => {
        if (scrollContainer && scrollContainer.scrollTop > 0) {
          latestScrollTop.current = scrollContainer.scrollTop;
        }
      };

      scrollContainer.addEventListener('scroll', handleScroll);
      return () => {
        scrollContainer?.removeEventListener('scroll', handleScroll);
      };
    }, [editor]);

    const handleRendered = useCallback(() => {
      const restore = () => {
        try {
          let scrollContainer: HTMLElement | null = null;
          
          try {
            const domNode = ReactEditor.toDOMNode(editor, editor);
            
            scrollContainer = domNode.closest('.appflowy-scroll-container');
          } catch {
            // fallback
          }

          if (!scrollContainer) {
            scrollContainer = document.querySelector('.appflowy-scroll-container');
          }
          
          // Only restore if scroll position was reset to 0 (or close to 0) and we had a previous scroll
          if (scrollContainer && scrollContainer.scrollTop < 10 && latestScrollTop.current > 50) {
            scrollContainer.scrollTop = latestScrollTop.current;
          }
        } catch {
          // Ignore
        }
      };

      restore();
      // Try next tick in case of layout shifts
      setTimeout(restore, 50);
      
      // Clear the ref only after attempts to allow future 0-scrolls if valid
      setTimeout(() => {
        latestScrollTop.current = 0;
      }, 1000);
    }, [editor]);

    const handleNavigateToRow = useCallback(
      async (rowId: string) => {
        if (!viewId) return;
        await navigateToView?.(viewId, rowId);
      },
      [navigateToView, viewId]
    );

    const { paddingStart, paddingEnd, width } = useResizePositioning({
      editor,
      node: node as unknown as Element,
    });

    useEffect(() => {
      const sharedRoot = doc?.getMap(YjsEditorKey.data_section) as YSharedRoot;

      if (!sharedRoot) return;

      const setStatus = () => {
        const hasDb = !!sharedRoot.get(YjsEditorKey.database);

        setHasDatabase(hasDb);
      };

      setStatus();
      sharedRoot.observe(setStatus);

      return () => {
        sharedRoot.unobserve(setStatus);
      };
    }, [doc, viewId]);

    return (
      <div {...attributes} contentEditable={readOnly ? false : undefined} className='relative w-full cursor-pointer'>
        <div ref={ref} className='absolute left-0 top-0 h-full w-full caret-transparent'>
          {children}
        </div>
        <div
          contentEditable={false}
          ref={containerRef}
          className='container-bg relative my-1 flex w-full select-none flex-col'
        >
          <DatabaseContent
            selectedViewId={selectedViewId}
            hasDatabase={hasDatabase}
            notFound={notFound}
            paddingStart={paddingStart}
            paddingEnd={paddingEnd}
            width={width}
            doc={doc}
            workspaceId={workspaceId}
            viewId={viewId}
            createRowDoc={createRowDoc}
            loadView={loadView}
            navigateToView={navigateToView}
            onOpenRowPage={handleNavigateToRow}
            loadViewMeta={loadViewMeta}
            iidName={iidName}
            visibleViewIds={visibleViewIds}
            onChangeView={onChangeView}
            onRendered={handleRendered}
            // eslint-disable-next-line
            context={context as DatabaseContextState}
          />
        </div>
      </div>
    );
  }),
  (prevProps, nextProps) => prevProps.node.data.view_id === nextProps.node.data.view_id
);

export default DatabaseBlock;
