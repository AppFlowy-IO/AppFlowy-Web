import { useCallback, useEffect, useRef, useState } from 'react';

import { prefetchDatabaseBlobDiff } from '@/application/database-blob';
import { getRowKey } from '@/application/database-yjs/row_meta';
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
  const pendingRowDocsRef = useRef<Map<RowId, Promise<YDoc>>>(new Map());
  const prefetchedDatabaseIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    rowDocMapRef.current = rowDocMap;
  }, [rowDocMap]);

  useEffect(() => {
    const databaseId = doc.guid;

    if (!workspaceId || !databaseId) return;

    if (prefetchedDatabaseIdsRef.current.has(databaseId)) return;

    prefetchedDatabaseIdsRef.current.add(databaseId);
    void prefetchDatabaseBlobDiff(workspaceId, databaseId).catch((error) => {
      prefetchedDatabaseIdsRef.current.delete(databaseId);
      Log.warn('[Database] database blob diff prefetch failed', {
        databaseId,
        error,
      });
    });
  }, [workspaceId, doc.guid]);


  const createNewRowDoc = useCallback(
    async (rowKey: string) => {
      if (!createRowDoc) {
        throw new Error('createRowDoc function is not provided');
      }

      const rowDoc = await createRowDoc(rowKey);

      return rowDoc;
    },
    [createRowDoc]
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

      const rowKey = getRowKey(doc.guid, rowId);
      const promise = createRowDoc(rowKey);

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
    [createRowDoc, doc.guid]
  );

  useEffect(() => {
    rowDocMapRef.current = {};
    pendingRowDocsRef.current.clear();
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

          const rowDoc = await createRowDoc?.(getRowKey(viewDoc.guid, rowId));

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
    [createRowDoc, loadView, navigateToView, onOpenRowPage, readOnly]
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
