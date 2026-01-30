import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  clearDatabaseRowDocSeedCache,
  prefetchDatabaseBlobDiff,
  takeDatabaseRowDocSeed,
} from '@/application/database-blob';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { createRowFast } from '@/application/services/js-services/cache';
import {
  AppendBreadcrumb,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreateRow,
  LoadView,
  LoadViewMeta,
  RowId,
  UIVariant,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { DatabaseRow } from '@/components/database/DatabaseRow';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import DatabaseViews from '@/components/database/DatabaseViews';
import { CalendarViewType } from '@/components/database/fullcalendar/types';

import { DatabaseContextProvider } from './DatabaseContext';

const PRIORITY_ROW_SEED_LIMIT = 200;

export interface Database2Props {
  workspaceId: string;
  doc: YDoc;
  readOnly?: boolean;
  createRow?: CreateRow;
  loadView?: LoadView;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  navigateToView?: (viewId: string, blockId?: string) => Promise<void>;
  loadViewMeta?: LoadViewMeta;
  /**
   * The currently active/selected view tab ID (Grid, Board, or Calendar).
   * Changes when the user switches between different view tabs.
   */
  activeViewId: string;
  databaseName: string;
  rowId?: string;
  modalRowId?: string;
  appendBreadcrumb?: AppendBreadcrumb;
  onChangeView: (viewId: string) => void;
  onViewAdded?: (viewId: string) => void;
  onOpenRowPage?: (rowId: string) => void;
  /**
   * For embedded databases: restricts which views are shown (from block data).
   * For standalone databases: should be undefined to show all non-embedded views.
   */
  visibleViewIds?: string[];
  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  databasePageId: string;
  variant?: UIVariant;
  onRendered?: () => void;
  isDocumentBlock?: boolean;
  paddingStart?: number;
  paddingEnd?: number;
  showActions?: boolean;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  embeddedHeight?: number;
  /**
   * Callback when view IDs change (views added or removed).
   * Used to update the block data in embedded database blocks.
   */
  onViewIdsChanged?: (viewIds: string[]) => void;
}

function Database(props: Database2Props) {
  const {
    doc,
    createRow,
    activeViewId,
    databasePageId,
    databaseName,
    visibleViewIds,
    rowId,
    onChangeView,
    onViewAdded,
    onOpenRowPage,
    appendBreadcrumb,
    readOnly = true,
    loadView,
    bindViewSync,
    checkIfRowDocumentExists,
    navigateToView,
    modalRowId,
    isDocumentBlock: _isDocumentBlock,
    embeddedHeight,
    onViewIdsChanged,
    workspaceId,
  } = props;

  const [rowMap, setRowMap] = useState<Record<RowId, YDoc>>({});
  const rowMapRef = useRef(rowMap);
  const pendingRowDocsRef = useRef<Map<RowId, Promise<YDoc | undefined>>>(new Map());
  const prefetchPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const blobPrefetchPromiseRef = useRef<Promise<void> | null>(null);
  const localCachePrimedRef = useRef(false);
  const syncedRowKeysRef = useRef<Set<string>>(new Set());
  const [blobPrefetchComplete, setBlobPrefetchComplete] = useState(false);

  useEffect(() => {
    rowMapRef.current = rowMap;
  }, [rowMap]);

  // Get the actual database ID from the Yjs doc, falling back to doc.guid
  // This is critical because doc.guid might be the view ID instead of the database ID
  const getDatabaseId = useCallback(() => {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
    const databaseId = database?.get(YjsDatabaseKey.id);

    return databaseId || doc.guid;
  }, [doc]);

  const getPriorityRowIds = useCallback(() => {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
    const view = database?.get(YjsDatabaseKey.views)?.get(activeViewId);
    const rowOrders = view?.get(YjsDatabaseKey.row_orders);

    if (!rowOrders || rowOrders.length === 0) return [];

    const limit = Math.min(rowOrders.length, PRIORITY_ROW_SEED_LIMIT);
    const ids: string[] = [];

    for (let index = 0; index < limit; index += 1) {
      const row = rowOrders.get(index) as { id?: string } | undefined;
      const rowId = row?.id;

      if (rowId) {
        ids.push(rowId);
      }
    }

    return ids;
  }, [doc, activeViewId]);

  const registerRowSync = useCallback(
    (rowKey: string) => {
      if (!createRow) return;
      if (syncedRowKeysRef.current.has(rowKey)) return;

      syncedRowKeysRef.current.add(rowKey);
      void createRow(rowKey);
    },
    [createRow]
  );

  const bindRowSync = useCallback(
    (rowId: string) => {
      if (!createRow || !rowId) return;
      const databaseId = getDatabaseId();
      const rowKey = getRowKey(databaseId, rowId);

      registerRowSync(rowKey);
    },
    [createRow, getDatabaseId, registerRowSync]
  );

  const populateRowFromCache = useCallback(
    async (rowId: string): Promise<YDoc | undefined> => {
      if (!rowId) return undefined;
      const existing = rowMapRef.current[rowId];

      if (existing) return existing;

      const pending = pendingRowDocsRef.current.get(rowId);

      if (pending) return pending;

      const databaseId = getDatabaseId();
      const rowKey = getRowKey(databaseId, rowId);
      const seed = takeDatabaseRowDocSeed(rowKey);

      if (!seed) return undefined;

      const promise = (async () => {
        const rowDoc = await createRowFast(rowKey, seed);

        return rowDoc;
      })();

      pendingRowDocsRef.current.set(rowId, promise);

      try {
        const rowDoc = await promise;

        if (rowDoc) {
          setRowMap((prev) => {
            if (prev[rowId]) return prev;
            return { ...prev, [rowId]: rowDoc };
          });
        }

        return rowDoc;
      } finally {
        pendingRowDocsRef.current.delete(rowId);
      }
    },
    [getDatabaseId]
  );

  const ensureBlobPrefetch = useCallback(() => {
    const databaseId = getDatabaseId();

    if (!workspaceId || !databaseId) return null;

    const existingPromise = prefetchPromisesRef.current.get(databaseId);

    if (existingPromise) {
      blobPrefetchPromiseRef.current = existingPromise;
      return existingPromise;
    }

    const priorityRowIds = getPriorityRowIds();
    const promise = prefetchDatabaseBlobDiff(workspaceId, databaseId, { priorityRowIds })
      .then(() => {
        setBlobPrefetchComplete(true);
      })
      .catch(() => {
        prefetchPromisesRef.current.delete(databaseId);
        setBlobPrefetchComplete(true);
      });

    prefetchPromisesRef.current.set(databaseId, promise);
    blobPrefetchPromiseRef.current = promise;
    return promise;
  }, [workspaceId, getDatabaseId, getPriorityRowIds]);

  useEffect(() => {
    const databaseId = getDatabaseId();

    return () => {
      clearDatabaseRowDocSeedCache(databaseId);
    };
  }, [getDatabaseId]);

  const createNewRow = useCallback(
    async (rowKey: string) => {
      if (!createRow) {
        throw new Error('createRow function is not provided');
      }

      const [rowKeyDatabaseId, rowId] = rowKey.split('_rows_');
      const currentDatabaseId = getDatabaseId();

      const rowDoc = await createRow(rowKey);

      // Add the new row doc to rowMap so grouping logic can see it immediately
      if (rowId && rowDoc) {
        setRowMap((prev) => {
          if (prev[rowId]) return prev;
          return { ...prev, [rowId]: rowDoc };
        });
      }

      if (rowKeyDatabaseId && rowKeyDatabaseId === currentDatabaseId && !localCachePrimedRef.current) {
        localCachePrimedRef.current = true;
        void ensureBlobPrefetch();
      }

      return rowDoc;
    },
    [createRow, getDatabaseId, ensureBlobPrefetch]
  );

  const ensureRow = useCallback(
    async (rowId: string) => {
      if (!createRow || !rowId) return;
      const existing = rowMapRef.current[rowId];

      if (existing) {
        return existing;
      }

      const pending = pendingRowDocsRef.current.get(rowId);

      if (pending) {
        return pending;
      }

      const promise = (async () => {
        const databaseId = getDatabaseId();
        const rowKey = getRowKey(databaseId, rowId);
        const seed = takeDatabaseRowDocSeed(rowKey);

        try {
          const rowDoc = await createRowFast(rowKey, seed ?? undefined);

          // Bind sync for this row - only visible rows call ensureRow
          // Non-visible rows rely on blob diff cached data
          registerRowSync(rowKey);

          if (!localCachePrimedRef.current) {
            localCachePrimedRef.current = true;
            void ensureBlobPrefetch();
          }

          return rowDoc;
        } catch {
          if (!localCachePrimedRef.current) {
            localCachePrimedRef.current = true;
            void ensureBlobPrefetch();
          }

          return undefined;
        }
      })();

      pendingRowDocsRef.current.set(rowId, promise);

      try {
        const rowDoc = await promise;

        if (rowDoc) {
          setRowMap((prev) => {
            if (prev[rowId]) return prev;
            return { ...prev, [rowId]: rowDoc };
          });
        }

        return rowDoc;
      } finally {
        pendingRowDocsRef.current.delete(rowId);
      }
    },
    [createRow, getDatabaseId, ensureBlobPrefetch, registerRowSync]
  );

  useEffect(() => {
    rowMapRef.current = {};
    pendingRowDocsRef.current.clear();
    blobPrefetchPromiseRef.current = null;
    localCachePrimedRef.current = false;
    syncedRowKeysRef.current.clear();
    setRowMap({});
    setBlobPrefetchComplete(false);
  }, [doc.guid]);

  // Trigger blob prefetch when database opens
  useEffect(() => {
    const databaseId = getDatabaseId();

    if (workspaceId && databaseId) {
      ensureBlobPrefetch()?.catch((error: unknown) => {
        console.error('[Database] Failed to prefetch blob:', error);
      });
    }
  }, [workspaceId, getDatabaseId, ensureBlobPrefetch]);

  // Combined modal state to avoid multiple re-renders when updating related values
  const [modalState, setModalState] = useState<{
    rowId: string | null;
    viewId: string | null;
    databaseDoc: YDoc | null;
    rowMap: Record<RowId, YDoc> | null;
  }>(() => ({
    rowId: modalRowId || null,
    viewId: modalRowId ? activeViewId : null,
    databaseDoc: null,
    rowMap: null,
  }));

  // Calendar view type map state
  const [calendarViewTypeMap, setCalendarViewTypeMap] = useState<Map<string, CalendarViewType>>(() => new Map());

  const setCalendarViewType = useCallback((viewId: string, viewType: CalendarViewType) => {
    setCalendarViewTypeMap((prev) => {
      const newMap = new Map(prev);

      newMap.set(viewId, viewType);
      return newMap;
    });
  }, []);

  const handleOpenRow = useCallback(
    async (rowId: string, viewId?: string) => {
      if (readOnly) {
        if (viewId) {
          void navigateToView?.(viewId, rowId);
          return;
        }

        onOpenRowPage?.(rowId);
        return;
      }

      if (viewId) {
        try {
          const viewDoc = await loadView?.(viewId);

          if (!viewDoc) {
            void navigateToView?.(viewId);
            return;
          }

          const rowDoc = await createNewRow(getRowKey(viewDoc.guid, rowId));

          if (!rowDoc) {
            throw new Error('Row document not found');
          }

          // Update all modal state in a single setState call
          setModalState({
            rowId,
            viewId,
            databaseDoc: viewDoc,
            rowMap: { [rowId]: rowDoc },
          });
          return;
        } catch (e) {
          console.error(e);
        }
      }

      setModalState((prev) => ({ ...prev, rowId }));
    },
    [createNewRow, loadView, navigateToView, onOpenRowPage, readOnly]
  );

  const handleCloseRowModal = useCallback(() => {
    setModalState({
      rowId: null,
      viewId: null,
      databaseDoc: null,
      rowMap: null,
    });
  }, []);

  // Memoized callback for modal open change to avoid inline function in JSX
  const handleModalOpenChange = useCallback(
    (status: boolean) => {
      if (!status) {
        handleCloseRowModal();
      }
    },
    [handleCloseRowModal]
  );

  // Shared context properties - extracted to reduce duplication between main and modal contexts
  const sharedContextProps = useMemo(
    () => ({
      readOnly,
      ensureRow,
      populateRowFromCache,
      bindRowSync,
      blobPrefetchComplete,
      paddingStart: props.paddingStart,
      paddingEnd: props.paddingEnd,
      isDocumentBlock: _isDocumentBlock,
      navigateToRow: handleOpenRow,
      loadView,
      bindViewSync,
      createRow: createNewRow,
      checkIfRowDocumentExists,
      loadViewMeta: props.loadViewMeta,
      navigateToView,
      onRendered: props.onRendered,
      showActions: props.showActions,
      workspaceId,
      createDatabaseView: props.createDatabaseView,
      getViewIdFromDatabaseId: props.getViewIdFromDatabaseId,
      variant: props.variant,
      calendarViewTypeMap,
      setCalendarViewType,
    }),
    [
      readOnly,
      ensureRow,
      populateRowFromCache,
      bindRowSync,
      blobPrefetchComplete,
      props.paddingStart,
      props.paddingEnd,
      _isDocumentBlock,
      handleOpenRow,
      loadView,
      bindViewSync,
      createNewRow,
      checkIfRowDocumentExists,
      props.loadViewMeta,
      navigateToView,
      props.onRendered,
      props.showActions,
      workspaceId,
      props.createDatabaseView,
      props.getViewIdFromDatabaseId,
      props.variant,
      calendarViewTypeMap,
      setCalendarViewType,
    ]
  );

  // Memoize context value to prevent unnecessary re-renders of consumers
  const mainContextValue = useMemo(() => {
    return {
      ...sharedContextProps,
      databaseDoc: doc,
      databasePageId,
      activeViewId,
      rowMap,
      isDatabaseRowPage: !!rowId,
    };
  }, [sharedContextProps, doc, databasePageId, activeViewId, rowMap, rowId]);

  // Memoize modal context value separately - only compute when modal is open
  const modalContextValue = useMemo(
    () =>
      modalState.rowId
        ? {
            ...sharedContextProps,
            databaseDoc: modalState.databaseDoc || doc,
            databasePageId: modalState.viewId || databasePageId,
            activeViewId: modalState.viewId || activeViewId,
            rowMap: modalState.rowMap || rowMap,
            isDatabaseRowPage: false,
            closeRowDetailModal: handleCloseRowModal,
          }
        : null,
    [
      modalState.rowId,
      modalState.databaseDoc,
      modalState.viewId,
      modalState.rowMap,
      sharedContextProps,
      doc,
      databasePageId,
      activeViewId,
      rowMap,
      handleCloseRowModal,
    ]
  );

  if (!activeViewId) {
    return <div className={'min-h-[120px] w-full'} />;
  }

  return (
    <div className={'flex w-full flex-1 justify-center'}>
      <DatabaseContextProvider value={mainContextValue}>
        {rowId ? (
          <DatabaseRow appendBreadcrumb={appendBreadcrumb} rowId={rowId} />
        ) : (
          <div className='appflowy-database relative flex w-full flex-1 select-text flex-col overflow-hidden'>
            <DatabaseViews
              visibleViewIds={visibleViewIds}
              databasePageId={databasePageId}
              viewName={databaseName}
              onChangeView={onChangeView}
              onViewAdded={onViewAdded}
              activeViewId={activeViewId}
              fixedHeight={embeddedHeight}
              onViewIdsChanged={onViewIdsChanged}
            />
          </div>
        )}
      </DatabaseContextProvider>
      {modalState.rowId && modalContextValue && (
        <DatabaseContextProvider value={modalContextValue}>
          <DatabaseRowModal
            rowId={modalState.rowId}
            open={Boolean(modalState.rowId)}
            openPage={onOpenRowPage}
            onOpenChange={handleModalOpenChange}
          />
        </DatabaseContextProvider>
      )}
    </div>
  );
}

export default Database;
