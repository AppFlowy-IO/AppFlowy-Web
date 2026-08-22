import CircularProgress from '@mui/material/CircularProgress';
import { forwardRef, memo, useCallback, useEffect, useRef, useState, type ForwardedRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Transforms } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { DatabaseContextState } from '@/application/database-yjs';
import { UIVariant, YjsEditorKey, YSharedRoot } from '@/application/types';
import { useEmbeddedVisibleViewIds } from '@/components/database/hooks';
import { resolveEmbeddedDatabaseViewId } from '@/components/editor/database-block-lifecycle';
import { DatabaseNode, EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Log } from '@/utils/log';

import { DatabaseContent } from './components/DatabaseContent';
import { useDatabaseDeletionStatus } from './hooks/useDatabaseDeletionStatus';
import { useDocumentLoader } from './hooks/useDocumentLoader';
import { useResizePositioning } from './hooks/useResizePositioning';
import { useViewMeta } from './hooks/useViewMeta';
import { useViewSelection } from './hooks/useViewSelection';
import { getViewIds, isDatabaseDuplicatePlaceholder, replaceViewIds } from './utils/databaseBlockUtils';

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
  const persistedViewIds = getViewIds(node.data);
  const persistedViewId = persistedViewIds[0] ?? '';
  const parentViewId = typeof node.data?.parent_id === 'string' ? node.data.parent_id : '';
  const databaseId = typeof node.data?.database_id === 'string' ? node.data.database_id : undefined;
  const context = useEditorContext();
  const workspaceId = context.workspaceId;
  const recoveryKey = parentViewId && databaseId ? `${parentViewId}:${databaseId}` : '';
  const [recoveredView, setRecoveredView] = useState<{ key: string; viewId: string } | null>(null);
  const recoveredViewId = recoveredView?.key === recoveryKey ? recoveredView.viewId : '';
  const persistedRecoveryKeyRef = useRef('');
  const viewId = persistedViewId || recoveredViewId;
  const allowedViewIds = persistedViewIds.length > 0 ? persistedViewIds : recoveredViewId ? [recoveredViewId] : [];

  const navigateToView = context?.navigateToView;
  const loadView = context?.loadView;
  const createRow = context?.createRow;
  const bindViewSync = context?.bindViewSync;

  const [hasDatabase, setHasDatabase] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Compose focused hooks instead of one monolithic hook
  // 1. Document loading
  const { doc, notFound, noAccess, setNotFound } = useDocumentLoader({
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

  // 5. Detect when the database page is deleted from (or restored to) trash.
  const deletionStatus = useDatabaseDeletionStatus({
    workspaceId,
    viewId,
    databaseId,
    hasDatabase,
    eventEmitter: context.eventEmitter,
    notFound,
    setNotFound,
  });
  const effectiveDeletionStatus =
    context.variant === UIVariant.Publish && deletionStatus === null ? 'none' : deletionStatus;

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
      const updatedData = replaceViewIds(node.data, currentViewIds);
      const nextViewIds = getViewIds(updatedData);

      // Find new view IDs (additions)
      const addedViewIds = nextViewIds.filter((id) => !existingViewIds.includes(id));

      // Find removed view IDs (deletions)
      const removedViewIds = existingViewIds.filter((id) => !nextViewIds.includes(id));
      const orderChanged =
        existingViewIds.length !== nextViewIds.length ||
        existingViewIds.some((viewId, index) => viewId !== nextViewIds[index]);

      if (!orderChanged) return;

      Log.debug('[DatabaseBlock] View IDs changed', {
        addedViewIds,
        removedViewIds,
        existingViewIds,
        currentViewIds: nextViewIds,
      });

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

  useEffect(() => {
    const loadViewMeta = context.loadViewMeta;

    if (persistedViewId || recoveredViewId || !recoveryKey || !databaseId || !loadViewMeta) return;

    let cancelled = false;

    void resolveEmbeddedDatabaseViewId(parentViewId, databaseId, loadViewMeta)
      .then((resolvedViewId) => {
        if (cancelled || !resolvedViewId) return;

        setRecoveredView({ key: recoveryKey, viewId: resolvedViewId });
      })
      .catch((error) => {
        if (cancelled) return;
        Log.warn('[DatabaseBlock] Failed to recover linked database view id', {
          parentViewId,
          databaseId,
          error,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [context.loadViewMeta, databaseId, parentViewId, persistedViewId, recoveredViewId, recoveryKey]);

  useEffect(() => {
    // Read-only members render from recovered local state. Editors repair the
    // shared block once so subsequent clients do not need recovery.
    if (readOnly || persistedViewId || !recoveredViewId || persistedRecoveryKeyRef.current === recoveryKey) return;

    persistedRecoveryKeyRef.current = recoveryKey;
    handleViewIdsChanged([recoveredViewId]);
  }, [handleViewIdsChanged, persistedViewId, readOnly, recoveredViewId, recoveryKey]);

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
          noAccess={noAccess}
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
    const prevParentViewId = prevProps.node.data.parent_id;
    const nextParentViewId = nextProps.node.data.parent_id;
    const prevIsDuplicatePlaceholder = isDatabaseDuplicatePlaceholder(prevProps.node.data);
    const nextIsDuplicatePlaceholder = isDatabaseDuplicatePlaceholder(nextProps.node.data);

    return (
      prevDatabaseId === nextDatabaseId &&
      prevParentViewId === nextParentViewId &&
      prevIsDuplicatePlaceholder === nextIsDuplicatePlaceholder &&
      prevViewIds.length === nextViewIds.length &&
      prevViewIds.every((id, index) => id === nextViewIds[index])
    );
  }
);

export default DatabaseBlock;
