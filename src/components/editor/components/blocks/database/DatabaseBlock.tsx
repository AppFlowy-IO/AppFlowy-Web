import CircularProgress from '@mui/material/CircularProgress';
import { forwardRef, memo, useCallback, useEffect, useRef, useState, type ForwardedRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Transforms } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import { DatabaseContextState } from '@/application/database-yjs';
import { ViewService } from '@/application/services/domains';
import { UIVariant, YjsEditorKey, YSharedRoot } from '@/application/types';
import { useEmbeddedVisibleViewIds } from '@/components/database/hooks';
import { DatabaseNode, EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Log } from '@/utils/log';

import { DatabaseContent } from './components/DatabaseContent';
import { useDocumentLoader } from './hooks/useDocumentLoader';
import { useResizePositioning } from './hooks/useResizePositioning';
import { useViewMeta } from './hooks/useViewMeta';
import { useViewSelection } from './hooks/useViewSelection';
import { addViewId, getViewIds, isDatabaseDuplicatePlaceholder, removeViewId } from './utils/databaseBlockUtils';

function DatabaseDuplicatePlaceholder() {
  const { t } = useTranslation();

  return (
    <div
      data-testid='database-duplicate-placeholder'
      className='flex min-h-12 w-full items-center gap-3 rounded border border-line-divider bg-background-primary px-3 text-sm font-medium text-text-secondary'
    >
      <CircularProgress size={16} />
      <span>{t('document.inlineDatabase.duplicating', 'Duplicating database...')}</span>
    </div>
  );
}

type DatabaseBlockBodyProps = EditorElementProps<DatabaseNode> & {
  editor: ReactEditor;
  forwardedRef: ForwardedRef<HTMLDivElement>;
  readOnly: boolean;
};

function DatabaseBlockBody({ node, children, editor, forwardedRef, readOnly, ...attributes }: DatabaseBlockBodyProps) {
  const viewIds = getViewIds(node.data);
  const viewId = viewIds.length > 0 ? viewIds[0] : '';
  const allowedViewIds = Array.isArray(node.data?.view_ids) ? node.data.view_ids : undefined;
  const databaseId = typeof node.data?.database_id === 'string' ? node.data.database_id : undefined;
  const context = useEditorContext();
  const workspaceId = context.workspaceId;

  const navigateToView = context?.navigateToView;
  const loadView = context?.loadView;
  const createRow = context?.createRow;
  const bindViewSync = context?.bindViewSync;

  const [hasDatabase, setHasDatabase] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<'none' | 'inTrash' | 'deleted' | null>(null);
  const effectiveDeletionStatus =
    context.variant === UIVariant.Publish && deletionStatus === null ? 'none' : deletionStatus;
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Compose focused hooks instead of one monolithic hook
  // 1. Document loading
  const { doc, notFound, setNotFound } = useDocumentLoader({
    viewId,
    databaseId,
    loadView,
    bindViewSync,
    eventEmitter: context.eventEmitter,
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

  // 5. Detect when the database page is deleted from (or restored to) the sidebar.
  //    When OUTLINE_LOADED fires (after any folder change), fetch the fresh trash list
  //    and check if our view is in it. This is reliable because:
  //    - The server API (ViewService.get) returns trashed views as if they still exist
  //    - The app's trashList state may not be updated yet due to async race conditions
  //    - Fetching trash directly from the API gives an authoritative answer
  const notFoundRef = useRef(notFound);

  notFoundRef.current = notFound;

  // Remember the database container (parent) id while the view is still reachable.
  // Once the container is moved to trash, ViewService.get(viewId) returns 404 and
  // viewMeta becomes null, so the response can no longer tell us the parent id. We
  // still need it to recognize the deletion as "in trash" rather than "permanently
  // deleted": the trash list only contains the container id, never the embedded
  // child view id. Keyed by viewId so a stale parent is ignored if the block swaps views.
  const lastKnownParentRef = useRef<{ viewId: string; parentId: string } | null>(null);

  useEffect(() => {
    const eventEmitter = context.eventEmitter;

    if (!eventEmitter || !viewId || !hasDatabase || !workspaceId) return;

    let cancelled = false;

    const checkView = async () => {
      try {
        // Invalidate the view cache to get an authoritative answer from the server.
        // Without this, the 5-second cache could return stale data for a permanently
        // deleted view, causing it to be misclassified as "restored".
        ViewService.invalidateCache(workspaceId, viewId);

        // Fetch view metadata and trash list in parallel (async-parallel rule).
        // Only treat 404-like failures (record not found) as permanent deletion.
        const [viewResult, trashResult] = await Promise.allSettled([
          ViewService.get(workspaceId, viewId),
          ViewService.getTrash(workspaceId),
        ]);

        const viewMeta = viewResult.status === 'fulfilled' ? viewResult.value : null;
        const viewGone = viewResult.status === 'rejected';
        const trashItems = trashResult.status === 'fulfilled' ? trashResult.value : null;

        // If both requests failed, optimistically allow rendering rather than
        // blocking the user with an infinite spinner.
        if (viewResult.status === 'rejected' && trashResult.status === 'rejected') {
          if (cancelled) return;
          setDeletionStatus('none');
          return;
        }

        // Cache the parent id whenever the view is reachable, so we can still resolve
        // the container after it is trashed (at which point viewMeta is null).
        if (viewMeta?.parent_view_id) {
          lastKnownParentRef.current = { viewId, parentId: viewMeta.parent_view_id };
        }

        // Build the set of IDs to check: the view itself and its parent (database
        // container). When a database container is trashed, only the container ID
        // appears in trash — not its child view IDs — so fall back to the last known
        // parent id when the trashed view no longer reports its metadata.
        const cachedParentId =
          lastKnownParentRef.current?.viewId === viewId ? lastKnownParentRef.current.parentId : null;
        const parentId = viewMeta?.parent_view_id ?? cachedParentId;
        const idsToCheck = new Set<string>([viewId]);

        if (parentId) {
          idsToCheck.add(parentId);
        }

        const isInTrash = trashItems?.some((item) => idsToCheck.has(item.view_id));

        if (cancelled) return;

        if (isInTrash) {
          // Database container is in the trash
          setDeletionStatus('inTrash');

          if (!notFoundRef.current) {
            setNotFound(true);
          }
        } else if (viewGone && !viewMeta) {
          // Not in trash AND API can't find the view — permanently deleted
          setDeletionStatus('deleted');

          if (!notFoundRef.current) {
            setNotFound(true);
          }
        } else if (viewMeta) {
          // View exists and is not in trash — confirmed alive (or restored)
          setDeletionStatus('none');

          if (notFoundRef.current) {
            setNotFound(false);
          }
        }
      } catch {
        // Network error — do nothing, keep current state
      }
    };

    // Check immediately on mount (covers navigating back to a page after deletion)
    void checkView();

    eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, checkView);
    return () => {
      cancelled = true;
      eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, checkView);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- node.data excluded to avoid re-subscribing on every block edit
  }, [context.eventEmitter, viewId, workspaceId, hasDatabase, setNotFound]);

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

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
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

        Transforms.setNodes(editor, { data: updatedData }, { at: path });
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
      <div ref={forwardedRef} className='absolute left-0 top-0 h-full w-full caret-transparent'>
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
          deletionStatus={effectiveDeletionStatus}
          paddingStart={paddingStart}
          paddingEnd={paddingEnd}
          width={width}
          doc={doc}
          workspaceId={workspaceId}
          createRow={createRow}
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
          // The missing fields (databaseDoc, databasePageId, activeViewId, rowMap) are
          // explicitly set by DatabaseContent via baseViewId, selectedViewId, and doc props
          context={context as unknown as DatabaseContextState}
        />
      </div>
    </div>
  );
}

export const DatabaseBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<DatabaseNode>>(({ node, children, ...attributes }, ref) => {
    const isDuplicatePlaceholder = isDatabaseDuplicatePlaceholder(node.data);
    const editor = useSlateStatic();
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);

    if (isDuplicatePlaceholder) {
      return (
        <div {...attributes} contentEditable={readOnly ? false : undefined} className='relative w-full cursor-pointer'>
          <div ref={ref} className='absolute left-0 top-0 h-full w-full caret-transparent'>
            {children}
          </div>
          <div contentEditable={false} className='container-bg relative my-1 flex w-full select-none flex-col'>
            <DatabaseDuplicatePlaceholder />
          </div>
        </div>
      );
    }

    return (
      <DatabaseBlockBody {...attributes} node={node} editor={editor} forwardedRef={ref} readOnly={readOnly}>
        {children}
      </DatabaseBlockBody>
    );
  }),
  (prevProps, nextProps) => {
    const prevViewIds = getViewIds(prevProps.node.data);
    const nextViewIds = getViewIds(nextProps.node.data);
    const prevDatabaseId = prevProps.node.data.database_id;
    const nextDatabaseId = nextProps.node.data.database_id;
    const prevIsDuplicatePlaceholder = isDatabaseDuplicatePlaceholder(prevProps.node.data);
    const nextIsDuplicatePlaceholder = isDatabaseDuplicatePlaceholder(nextProps.node.data);

    return (
      prevDatabaseId === nextDatabaseId &&
      prevIsDuplicatePlaceholder === nextIsDuplicatePlaceholder &&
      prevViewIds.length === nextViewIds.length &&
      prevViewIds.every((id, index) => id === nextViewIds[index])
    );
  }
);

export default DatabaseBlock;
