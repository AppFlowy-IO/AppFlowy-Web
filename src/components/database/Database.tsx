import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearDatabaseRowDocSeedCache,
  prefetchDatabaseBlobDiff,
  takeDatabaseRowDocSeed,
} from '@/application/database-blob';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { createRowDocFast } from '@/application/services/js-services/cache';
import {
  AppendBreadcrumb,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreateRowDoc,
  LoadView,
  LoadViewMeta,
  RowId,
  UIVariant,
  YDoc,
  YjsEditorKey,
} from '@/application/types';
import { DatabaseRow } from '@/components/database/DatabaseRow';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import DatabaseViews from '@/components/database/DatabaseViews';
import { CalendarViewType } from '@/components/database/fullcalendar/types';
import { Log } from '@/utils/log';

import { DatabaseContextProvider } from './DatabaseContext';

export interface Database2Props {
  workspaceId: string;
  doc: YDoc;
  readOnly?: boolean;
  createRowDoc?: CreateRowDoc;
  loadView?: LoadView;
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
    createRowDoc,
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
    navigateToView,
    modalRowId,
    isDocumentBlock: _isDocumentBlock,
    embeddedHeight,
    onViewIdsChanged,
    workspaceId,
  } = props;

  const [rowDocMap, setRowDocMap] = useState<Record<RowId, YDoc>>({});
  const rowDocMapRef = useRef(rowDocMap);
  const pendingRowDocsRef = useRef<Map<RowId, Promise<YDoc | undefined>>>(new Map());
  const prefetchPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const blobPrefetchPromiseRef = useRef<Promise<void> | null>(null);
  const blobPrefetchDoneRef = useRef(false);
  const pendingRowSyncRef = useRef<Set<string>>(new Set());
  const syncedRowKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    rowDocMapRef.current = rowDocMap;
  }, [rowDocMap]);

  const registerRowSync = useCallback(
    (rowKey: string) => {
      if (!createRowDoc) return;

      if (syncedRowKeysRef.current.has(rowKey)) {
        return;
      }

      Log.debug('[Database] register row sync', {
        rowKey,
        databaseId: doc.guid,
      });

      syncedRowKeysRef.current.add(rowKey);
      void createRowDoc(rowKey);
    },
    [createRowDoc, doc.guid]
  );

  const flushPendingRowSync = useCallback(() => {
    if (!blobPrefetchDoneRef.current) return;

    const pending = Array.from(pendingRowSyncRef.current);

    if (!pending.length) return;

    Log.debug('[Database] flush pending row sync', {
      databaseId: doc.guid,
      pendingCount: pending.length,
    });

    pendingRowSyncRef.current.clear();
    pending.forEach((rowKey) => registerRowSync(rowKey));
  }, [registerRowSync, doc.guid]);

  const markPrefetchDone = useCallback(() => {
    if (blobPrefetchDoneRef.current) return;
    blobPrefetchDoneRef.current = true;
    Log.debug('[Database] blob prefetch completed', { databaseId: doc.guid });
    flushPendingRowSync();
  }, [flushPendingRowSync, doc.guid]);

  const ensureBlobPrefetch = useCallback(() => {
    const databaseId = doc.guid;

    if (!workspaceId || !databaseId) return null;

    const existingPromise = prefetchPromisesRef.current.get(databaseId);

    if (existingPromise) {
      blobPrefetchPromiseRef.current = existingPromise;
      void existingPromise.finally(markPrefetchDone);
      Log.debug('[Database] reuse blob prefetch promise', { databaseId });
      return existingPromise;
    }

    Log.debug('[Database] start blob prefetch', { databaseId, workspaceId });

    const promise = prefetchDatabaseBlobDiff(workspaceId, databaseId)
      .catch((error) => {
        Log.warn('[Database] database blob diff prefetch failed', {
          databaseId,
          error,
        });
        prefetchPromisesRef.current.delete(databaseId);
      })
      .then(() => undefined)
      .finally(markPrefetchDone);

    prefetchPromisesRef.current.set(databaseId, promise);
    blobPrefetchPromiseRef.current = promise;
    return promise;
  }, [workspaceId, doc.guid, markPrefetchDone]);

  useEffect(() => {
    void ensureBlobPrefetch();
  }, [ensureBlobPrefetch]);

  useEffect(() => {
    const databaseId = doc.guid;

    return () => {
      clearDatabaseRowDocSeedCache(databaseId);
    };
  }, [doc.guid]);

  const createNewRowDoc = useCallback(
    async (rowKey: string) => {
      if (!createRowDoc) {
        throw new Error('createRowDoc function is not provided');
      }

      const [databaseId] = rowKey.split('_rows_');

      if (databaseId && databaseId === doc.guid) {
        Log.debug('[Database] create row doc waiting for blob prefetch', {
          rowKey,
          databaseId,
        });
        const prefetchPromise = ensureBlobPrefetch();

        if (prefetchPromise) {
          await prefetchPromise;
        }
      }

      return createRowDoc(rowKey);
    },
    [createRowDoc, doc.guid, ensureBlobPrefetch]
  );

  const queueRowSync = useCallback(
    (rowKey: string, rowId: string) => {
      if (blobPrefetchDoneRef.current) {
        registerRowSync(rowKey);
        return;
      }

      Log.debug('[Database] queue row sync', {
        rowId,
        rowKey,
        databaseId: doc.guid,
      });

      pendingRowSyncRef.current.add(rowKey);

      if (blobPrefetchDoneRef.current) {
        pendingRowSyncRef.current.delete(rowKey);
        registerRowSync(rowKey);
      }
    },
    [registerRowSync, doc.guid]
  );

  const ensureRowDoc = useCallback(
    async (rowId: string) => {
      if (!createRowDoc || !rowId) return;
      const existing = rowDocMapRef.current[rowId];

      if (existing) {
        return existing;
      }

      const pending = pendingRowDocsRef.current.get(rowId);

      if (pending) {
        return pending;
      }

      const promise = (async () => {
        const rowKey = getRowKey(doc.guid, rowId);

        void ensureBlobPrefetch();

        const loadStartedAt = performance.now();
        const seed = takeDatabaseRowDocSeed(rowKey);

        Log.debug('[Database] ensure row doc start', {
          rowId,
          rowKey,
          databaseId: doc.guid,
          hasSeed: Boolean(seed),
          prefetchDone: blobPrefetchDoneRef.current,
        });

        try {
          const rowDoc = await createRowDocFast(rowKey, seed ?? undefined);
          const loadDurationMs = Math.round(performance.now() - loadStartedAt);
          const rowSharedRoot = rowDoc?.getMap(YjsEditorKey.data_section);
          const hasRowData = Boolean(rowSharedRoot?.get(YjsEditorKey.database_row));

          Log.debug('[Database] ensure row doc loaded', {
            rowId,
            rowKey,
            databaseId: doc.guid,
            hasSeed: Boolean(seed),
            prefetchDone: blobPrefetchDoneRef.current,
            loadDurationMs,
            hasRowData,
          });

          queueRowSync(rowKey, rowId);

          return rowDoc;
        } catch (error) {
          Log.warn('[Database] row doc load failed', {
            rowId,
            rowKey,
            databaseId: doc.guid,
            error,
          });
          return undefined;
        }
      })();

      pendingRowDocsRef.current.set(rowId, promise);

      try {
        const rowDoc = await promise;

        if (rowDoc) {
          setRowDocMap((prev) => {
            if (prev[rowId]) return prev;
            return { ...prev, [rowId]: rowDoc };
          });
        }

        return rowDoc;
      } finally {
        pendingRowDocsRef.current.delete(rowId);
      }
    },
    [createRowDoc, doc.guid, ensureBlobPrefetch, queueRowSync]
  );

  useEffect(() => {
    rowDocMapRef.current = {};
    pendingRowDocsRef.current.clear();
    blobPrefetchPromiseRef.current = null;
    blobPrefetchDoneRef.current = false;
    pendingRowSyncRef.current.clear();
    syncedRowKeysRef.current.clear();
    setRowDocMap({});
  }, [doc.guid]);

  const [openModalRowId, setOpenModalRowId] = useState<string | null>(() => modalRowId || null);
  const [openModalViewId, setOpenModalViewId] = useState<string | null>(() => (modalRowId ? activeViewId : null));
  const [openModalRowDatabaseDoc, setOpenModalRowDatabaseDoc] = useState<YDoc | null>(null);
  const [openModalRowDocMap, setOpenModalRowDocMap] = useState<Record<RowId, YDoc> | null>(null);

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

          setOpenModalViewId(viewId);
          setOpenModalRowDatabaseDoc(viewDoc);

          const rowDoc = await createNewRowDoc(getRowKey(viewDoc.guid, rowId));

          if (!rowDoc) {
            throw new Error('Row document not found');
          }

          setOpenModalRowDocMap({ [rowId]: rowDoc });
        } catch (e) {
          console.error(e);
        }
      }

      setOpenModalRowId(rowId);
    },
    [createNewRowDoc, loadView, navigateToView, onOpenRowPage, readOnly]
  );

  const handleCloseRowModal = useCallback(() => {
    setOpenModalRowId(null);
    setOpenModalRowDocMap(null);
    setOpenModalRowDatabaseDoc(null);
    setOpenModalViewId(null);
  }, []);

  if (!activeViewId) {
    return <div className={'min-h-[120px] w-full'} />;
  }

  return (
    <div className={'flex w-full flex-1 justify-center'}>
      <DatabaseContextProvider
        {...props}
        isDatabaseRowPage={!!rowId}
        navigateToRow={handleOpenRow}
        databaseDoc={doc}
        rowDocMap={rowDocMap}
        readOnly={readOnly}
        createRowDoc={createNewRowDoc}
        ensureRowDoc={ensureRowDoc}
        calendarViewTypeMap={calendarViewTypeMap}
        setCalendarViewType={setCalendarViewType}
      >
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
      {openModalRowId && (
        <DatabaseContextProvider
          {...props}
          activeViewId={openModalViewId || activeViewId}
          databasePageId={openModalViewId || databasePageId}
          databaseDoc={openModalRowDatabaseDoc || doc}
          rowDocMap={openModalRowDocMap || rowDocMap}
          isDatabaseRowPage={false}
          navigateToRow={handleOpenRow}
          readOnly={readOnly}
          createRowDoc={createNewRowDoc}
          ensureRowDoc={ensureRowDoc}
          calendarViewTypeMap={calendarViewTypeMap}
          setCalendarViewType={setCalendarViewType}
          closeRowDetailModal={handleCloseRowModal}
        >
          <DatabaseRowModal
            rowId={openModalRowId}
            open={Boolean(openModalRowId)}
            openPage={onOpenRowPage}
            onOpenChange={(status) => {
              if (!status) {
                handleCloseRowModal();
              } else {
                setOpenModalRowId(openModalRowId);
              }
            }}
          />
        </DatabaseContextProvider>
      )}
    </div>
  );
}

export default Database;
