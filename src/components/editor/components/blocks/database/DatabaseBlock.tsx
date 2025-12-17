import { forwardRef, memo, useCallback, useEffect, useRef, useState } from 'react';
import { Element, Transforms } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { Log } from '@/utils/log';
import { DatabaseContextState } from '@/application/database-yjs';
import { YjsEditorKey, YSharedRoot } from '@/application/types';
import { useEmbeddedVisibleViewIds } from '@/components/database/hooks';
import { DatabaseNode, EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';

import { DatabaseContent } from './components/DatabaseContent';
import { useDocumentLoader } from './hooks/useDocumentLoader';
import { useResizePositioning } from './hooks/useResizePositioning';
import { useViewMeta } from './hooks/useViewMeta';
import { useViewSelection } from './hooks/useViewSelection';
import { addViewId, getViewIds, removeViewId } from './utils/databaseBlockUtils';

export const DatabaseBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<DatabaseNode>>(({ node, children, ...attributes }, ref) => {
    const viewIds = getViewIds(node.data);
    const viewId = viewIds.length > 0 ? viewIds[0] : '';
    const allowedViewIds = Array.isArray(node.data?.view_ids) ? node.data.view_ids : undefined;
    const context = useEditorContext();
    const workspaceId = context.workspaceId;
    const navigateToView = context?.navigateToView;
    const loadView = context?.loadView;
    const createRowDoc = context?.createRowDoc;

    const [hasDatabase, setHasDatabase] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const editor = useSlateStatic();
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);

    // Compose focused hooks instead of one monolithic hook
    // 1. Document loading
    const { doc, notFound, setNotFound } = useDocumentLoader({
      viewId,
      loadView,
    });

    // 2. Visible view IDs from block data
    const { visibleViewIds, onViewAdded: onVisibleViewAdded } = useEmbeddedVisibleViewIds({
      allowedViewIds,
    });

    // 3. View selection management
    const { selectedViewId, onChangeView, onViewAddedSelection } = useViewSelection({
      viewId,
      visibleViewIds,
    });

    // 4. View metadata loading
    const { databaseName, loadViewMeta } = useViewMeta({
      viewId,
      loadViewMeta: context?.loadViewMeta,
      ignoreMetaErrors: true, // Embedded databases don't require meta
      onNotFound: () => setNotFound(true),
    });

    // Combined callback when a view is added
    const onViewAdded = useCallback(
      (newViewId: string) => {
        onVisibleViewAdded(newViewId);
        onViewAddedSelection(newViewId);
      },
      [onVisibleViewAdded, onViewAddedSelection]
    );

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

    /**
     * Callback to update view_ids in the block data when views are added or removed.
     * Similar to Flutter's onViewIdsChanged callback in database_view_widget.dart.
     */
    const handleViewIdsChanged = useCallback(
      (currentViewIds: string[]) => {
        if (readOnly) return;

        const existingViewIds = getViewIds(node.data);

        // Find new view IDs (additions)
        const addedViewIds = currentViewIds.filter((id) => !existingViewIds.includes(id));

        // Find removed view IDs (deletions)
        const removedViewIds = existingViewIds.filter((id) => !currentViewIds.includes(id));

        if (addedViewIds.length === 0 && removedViewIds.length === 0) return;

        Log.debug('[DatabaseBlock] View IDs changed', {
          addedViewIds,
          removedViewIds,
          existingViewIds,
          currentViewIds,
        });

        // Build the new data object
        let updatedData = { ...node.data };

        for (const id of addedViewIds) {
          updatedData = addViewId(updatedData, id);
        }

        for (const id of removedViewIds) {
          updatedData = removeViewId(updatedData, id);
        }

        // Update the Slate node
        try {
          const path = ReactEditor.findPath(editor, node as unknown as Element);

          Transforms.setNodes(
            editor,
            { data: updatedData },
            { at: path }
          );
        } catch (e) {
          console.error('[DatabaseBlock] Error updating view_ids:', e);
        }
      },
      [editor, node, readOnly]
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
            baseViewId={viewId}
            selectedViewId={selectedViewId}
            hasDatabase={hasDatabase}
            notFound={notFound}
            paddingStart={paddingStart}
            paddingEnd={paddingEnd}
            width={width}
            doc={doc}
            workspaceId={workspaceId}
            createRowDoc={createRowDoc}
            loadView={loadView}
            navigateToView={navigateToView}
            onOpenRowPage={handleNavigateToRow}
            loadViewMeta={loadViewMeta}
            databaseName={databaseName}
            visibleViewIds={visibleViewIds}
            onChangeView={onChangeView}
            onViewAdded={onViewAdded}
            onRendered={handleRendered}
            onViewIdsChanged={handleViewIdsChanged}
            // EditorContextState shares common fields with DatabaseContextState but not all
            // The missing fields (databaseDoc, databasePageId, activeViewId, rowDocMap) are
            // explicitly set by DatabaseContent via baseViewId, selectedViewId, and doc props
            context={context as unknown as DatabaseContextState}
          />
        </div>
      </div>
    );
  }),
  (prevProps, nextProps) => {
    const prevViewIds = getViewIds(prevProps.node.data);
    const nextViewIds = getViewIds(nextProps.node.data);

    return (
      prevViewIds.length === nextViewIds.length &&
      prevViewIds.every((id, index) => id === nextViewIds[index])
    );
  }
);

export default DatabaseBlock;
