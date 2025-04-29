import { db } from '@/application/db';
import {
  AppendBreadcrumb, CreateFolderViewPayload,
  CreateRowDoc,
  LoadView,
  LoadViewMeta, RowId, UIVariant,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import DatabaseRow from '@/components/database/DatabaseRow';
import DatabaseViews from '@/components/database/DatabaseViews';
import { useLiveQuery } from 'dexie-react-hooks';
import { debounce } from 'lodash-es';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  appendBreadcrumb?: AppendBreadcrumb;
  onChangeView: (viewId: string) => void;
  onOpenRow?: (rowId: string) => void;
  visibleViewIds: string[];
  iidIndex: string;
  variant?: UIVariant;
  onRendered?: () => void;
  isDocumentBlock?: boolean;
  paddingStart?: number;
  paddingEnd?: number;
  showActions?: boolean;
  createFolderView?: (payload: CreateFolderViewPayload) => Promise<string>;
}

function Database ({
  workspaceId,
  doc,
  createRowDoc,
  navigateToView,
  loadViewMeta,
  loadView,
  viewId,
  iidIndex,
  iidName,
  visibleViewIds,
  rowId,
  onChangeView,
  onOpenRow,
  appendBreadcrumb,
  onRendered,
  readOnly = true,
  variant = UIVariant.App,
  paddingStart,
  paddingEnd,
  isDocumentBlock,
  showActions,
  createFolderView,
  ...props
}: Database2Props) {
  const database = doc.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase;
  const view = database.get(YjsDatabaseKey.views).get(iidIndex);

  const rowOrders = view?.get(YjsDatabaseKey.row_orders);
  const [rowIds, setRowIds] = useState<RowId[]>([]);
  const [rowDocMap, setRowDocMap] = useState<Record<RowId, YDoc> | null>(null);
  const dbRows = useLiveQuery(async () => {
    const rows = await db.rows.bulkGet(rowIds.map(id => `${doc.guid}_rows_${id}`));

    return rows;
  }, [rowIds, variant]);

  const updateRowMap = useCallback(async () => {
    const newRowMap: Record<RowId, YDoc> = {};

    console.log('Database.tsx: updateRowMap', rowIds, dbRows);
    if (!dbRows || !createRowDoc) return;

    for (const row of dbRows) {
      if (!row) {
        continue;
      }

      newRowMap[row.row_id] = await createRowDoc(row.row_key);
    }

    setRowDocMap(newRowMap);
  }, [createRowDoc, dbRows, rowIds]);

  const debounceUpdateRowMap = useMemo(() => {
    return debounce(updateRowMap, 200);
  }, [updateRowMap]);

  useEffect(() => {
    void debounceUpdateRowMap();
  }, [debounceUpdateRowMap]);

  useEffect(() => {
    console.log('Database.tsx: database', database.toJSON());
    console.log('Database.tsx: rowDocMap', rowDocMap);
  }, [rowDocMap, database]);

  const createNewRowDoc = useCallback(async (rowKey: string) => {
    if (!createRowDoc) {
      throw new Error('createRowDoc function is not provided');
    }

    const rowId = rowKey.split('_rows_')[1];

    const rowDoc = await createRowDoc(rowKey);

    await db.rows.put({
      row_id: rowId,
      version: 1,
      row_key: rowKey,
    });

    return rowDoc;
  }, [createRowDoc]);

  const handleUpdateRowDocMap = useCallback(async () => {
    setRowIds(rowOrders?.toJSON().map(({ id }: { id: string }) => id) || []);
  }, [rowOrders]);

  useEffect(() => {
    void handleUpdateRowDocMap();

    rowOrders?.observe(handleUpdateRowDocMap);
    return () => {
      rowOrders?.unobserve(handleUpdateRowDocMap);
    };
  }, [handleUpdateRowDocMap, rowOrders]);

  if (!rowDocMap || !viewId) {
    return null;
  }

  return (
    <div className={'flex w-full flex-1 justify-center'}>
      <DatabaseContextProvider
        workspaceId={workspaceId}
        isDatabaseRowPage={!!rowId}
        navigateToRow={onOpenRow}
        iidIndex={iidIndex}
        viewId={viewId}
        databaseDoc={doc}
        rowDocMap={rowDocMap}
        readOnly={readOnly}
        loadView={loadView}
        navigateToView={navigateToView}
        loadViewMeta={loadViewMeta}
        createRowDoc={createNewRowDoc}
        paddingStart={paddingStart}
        paddingEnd={paddingEnd}
        isDocumentBlock={isDocumentBlock}
        onRendered={onRendered}
        createFolderView={createFolderView}
        showActions={showActions}
        {...props}
      >
        {rowId ? (
          <DatabaseRow
            appendBreadcrumb={appendBreadcrumb}
            rowId={rowId}
          />
        ) : (
          <div className="appflowy-database relative flex w-full flex-1 select-text flex-col overflow-y-hidden">
            <DatabaseViews
              visibleViewIds={visibleViewIds}
              iidIndex={iidIndex}
              viewName={iidName}
              onChangeView={onChangeView}
              viewId={viewId}
            />
          </div>
        )}
      </DatabaseContextProvider>
    </div>
  );
}

export default Database;
