import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  AppendBreadcrumb,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreateFolderViewPayload,
  CreateRowDoc,
  LoadView,
  LoadViewMeta,
  RowId,
  UIVariant,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { DatabaseRow } from '@/components/database/DatabaseRow';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';
import DatabaseViews from '@/components/database/DatabaseViews';
import { CalendarViewType } from '@/components/database/fullcalendar/types';

import { DatabaseContextProvider } from './DatabaseContext';

export interface Database2Props {
  workspaceId: string;
  doc: YDoc;
  readOnly?: boolean;
  createRowDoc?: CreateRowDoc;
  loadView?: LoadView;
  navigateToView?: (viewId: string, blockId?: string) => Promise<void>;
  loadViewMeta?: LoadViewMeta;
  viewId: string;
  iidName: string;
  rowId?: string;
  modalRowId?: string;
  appendBreadcrumb?: AppendBreadcrumb;
  onChangeView: (viewId: string) => void;
  onOpenRowPage?: (rowId: string) => void;
  visibleViewIds: string[];
  iidIndex: string;
  variant?: UIVariant;
  onRendered?: () => void;
  isDocumentBlock?: boolean;
  paddingStart?: number;
  paddingEnd?: number;
  showActions?: boolean;
  createFolderView?: (payload: CreateFolderViewPayload) => Promise<string>;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  embeddedHeight?: number;
}

function Database(props: Database2Props) {
  const {
    doc,
    createRowDoc,
    viewId,
    iidIndex,
    iidName,
    visibleViewIds,
    rowId,
    onChangeView,
    onOpenRowPage,
    appendBreadcrumb,
    readOnly = true,
    loadView,
    navigateToView,
    modalRowId,
    isDocumentBlock: _isDocumentBlock,
    embeddedHeight,
  } = props;

  const database = doc.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase | null;
  const views = database?.get(YjsDatabaseKey.views);

  // Find view by iid field (views map uses numeric keys like "0", "1", "2")
  const findViewByIid = useCallback((viewsMap: typeof views, targetIid: string) => {
    if (!viewsMap) return null;

    // Try direct access first (for standalone databases)
    const directView = viewsMap.get(targetIid);

    if (directView) return directView;

    // Search by iid field (for embedded databases)
    const viewsData = viewsMap.toJSON();
    const keys = Object.keys(viewsData);

    for (const key of keys) {
      const v = viewsMap.get(key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const viewIid = v?.get?.(YjsDatabaseKey.iid as any);

      if (viewIid === targetIid) {
        return v;
      }
    }

    return null;
  }, []);

  const view = findViewByIid(views, iidIndex);
  const rowOrders = view?.get(YjsDatabaseKey.row_orders);

  const [rowIds, setRowIds] = useState<RowId[]>([]);
  const [rowDocMap, setRowDocMap] = useState<Record<RowId, YDoc> | null>(null);

  const updateRowMap = useCallback(async () => {
    const newRowMap: Record<RowId, YDoc> = {};

    if (!rowIds || !createRowDoc) {
      return;
    }

    const promises = rowIds.map(async (id) => {
      if (!id) {
        return;
      }

      const rowKey = getRowKey(doc.guid, id);
      const rowDoc = await createRowDoc(rowKey);

      return { id, rowDoc };
    });

    const results = await Promise.all(promises);

    results.forEach((result) => {
      if (result) {
        newRowMap[result.id] = result.rowDoc;
      }
    });

    setRowDocMap(newRowMap);
  }, [createRowDoc, doc.guid, rowIds]);

  const debounceUpdateRowMap = useMemo(() => {
    return debounce(updateRowMap, 200);
  }, [updateRowMap]);

  useEffect(() => {
    void debounceUpdateRowMap();
  }, [debounceUpdateRowMap]);


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

  const handleUpdateRowDocMap = useCallback(async () => {
    const rowOrdersData = rowOrders?.toJSON() || [];
    const ids = rowOrdersData.map(({ id }: { id: string }) => id);

    console.debug('[Database] row orders updated', {
      viewId,
      iidIndex,
      ids,
      raw: rowOrdersData,
    });
    setRowIds(ids);
  }, [iidIndex, rowOrders, viewId]);

  useEffect(() => {
    void handleUpdateRowDocMap();

    rowOrders?.observe(handleUpdateRowDocMap);
    return () => {
      rowOrders?.unobserve(handleUpdateRowDocMap);
    };
  }, [handleUpdateRowDocMap, rowOrders]);

  const [openModalRowId, setOpenModalRowId] = useState<string | null>(() => modalRowId || null);
  const [openModalViewId, setOpenModalViewId] = useState<string | null>(() => (modalRowId ? viewId : null));
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

  if (!rowDocMap || !viewId) {
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
        calendarViewTypeMap={calendarViewTypeMap}
        setCalendarViewType={setCalendarViewType}
      >
        {rowId ? (
          <DatabaseRow appendBreadcrumb={appendBreadcrumb} rowId={rowId} />
        ) : (
          <div className='appflowy-database relative flex w-full flex-1 select-text flex-col overflow-hidden'>
            <DatabaseViews
              visibleViewIds={visibleViewIds}
              iidIndex={iidIndex}
              viewName={iidName}
              onChangeView={onChangeView}
              viewId={viewId}
              fixedHeight={embeddedHeight}
            />
          </div>
        )}
      </DatabaseContextProvider>
      {openModalRowId && (
        <DatabaseContextProvider
          {...props}
          viewId={openModalViewId || viewId}
          iidIndex={openModalViewId || iidIndex}
          databaseDoc={openModalRowDatabaseDoc || doc}
          rowDocMap={openModalRowDocMap || rowDocMap}
          isDatabaseRowPage={false}
          navigateToRow={handleOpenRow}
          readOnly={readOnly}
          createRowDoc={createNewRowDoc}
          calendarViewTypeMap={calendarViewTypeMap}
          setCalendarViewType={setCalendarViewType}
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
