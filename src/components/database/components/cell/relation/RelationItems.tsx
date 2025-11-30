import React, { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContextState,
  getPrimaryFieldId,
  useDatabaseContext,
  useDatabaseIdFromField,
} from '@/application/database-yjs';
import { RelationCell, RelationCellData } from '@/application/database-yjs/cell.type';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { YDoc, YjsEditorKey } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { RelationPrimaryValue } from '@/components/database/components/cell/relation/RelationPrimaryValue';
import { cn } from '@/lib/utils';

function RelationItems({
  style,
  cell,
  fieldId,
  wrap,
}: {
  cell: RelationCell;
  fieldId: string;
  style?: React.CSSProperties;
  wrap: boolean;
}) {
  const context = useDatabaseContext();
  // databasePageId: The main database page ID in the folder structure
  const viewId = context.databasePageId;
  const relatedDatabaseId = useDatabaseIdFromField(fieldId);

  const createRowDoc = context.createRowDoc;
  const loadView = context.loadView;
  const navigateToRow = context.navigateToRow;
  const getViewIdFromDatabaseId = context.getViewIdFromDatabaseId;

  const [noAccess, setNoAccess] = useState(false);
  const [rows, setRows] = useState<DatabaseContextState['rowDocMap'] | null>();
  const [relatedFieldId, setRelatedFieldId] = useState<string | undefined>();
  const [relatedViewId, setRelatedViewId] = useState<string | null>(null);

  const [docGuid, setDocGuid] = useState<string | null>(null);
  const [databaseDoc, setDatabaseDoc] = useState<YDoc | null>(null);

  const [rowIds, setRowIds] = useState([] as string[]);

  const navigateToView = context.navigateToView;

  const handleUpdateRowIds = useCallback(() => {
    const data = cell?.data;

    if (!data || !(data instanceof Y.Array)) {
      setRowIds([]);
      return;
    }

    const ids = (data.toJSON() as RelationCellData) ?? [];

    setRowIds(ids);
  }, [cell.data]);

  useEffect(() => {
    if (!relatedDatabaseId) {
      setRelatedViewId(null);
      return;
    }

    void (async () => {
      try {
        const viewId = await getViewIdFromDatabaseId?.(relatedDatabaseId);

        if (!viewId) {
          setRelatedViewId(null);
          return;
        }

        setRelatedViewId(viewId);
      } catch (e) {
        console.error(e);
        setRelatedViewId(null);
      }
    })();
  }, [getViewIdFromDatabaseId, relatedDatabaseId]);

  useEffect(() => {
    if (!relatedViewId || !createRowDoc || !docGuid) return;
    void (async () => {
      try {
        const rows: Record<string, YDoc> = {};

        for (const rowId of rowIds) {
          const rowDoc = await createRowDoc(getRowKey(docGuid, rowId));

          rows[rowId] = rowDoc;
        }

        setRows(rows);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [createRowDoc, relatedViewId, relatedFieldId, rowIds, docGuid]);

  useEffect(() => {
    handleUpdateRowIds();
  }, [handleUpdateRowIds]);

  useEffect(() => {
    if (!relatedViewId) return;

    void (async () => {
      try {
        const viewDoc = await loadView?.(relatedViewId);

        if (!viewDoc) {
          throw new Error('No access');
        }

        setDocGuid(viewDoc.guid);

        setDatabaseDoc(viewDoc);
      } catch (e) {
        console.error(e);
        setNoAccess(true);
      }
    })();
  }, [loadView, relatedViewId]);

  useEffect(() => {
    if (!databaseDoc) return;
    const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);

    const observerEvent = () => {
      const database = sharedRoot.get(YjsEditorKey.database);

      const fieldId = getPrimaryFieldId(database);

      setRelatedFieldId(fieldId);
      setNoAccess(!fieldId);
    };

    observerEvent();

    sharedRoot.observe(observerEvent);
    return () => {
      sharedRoot.unobserve(observerEvent);
    };
  }, [databaseDoc]);

  return (
    <div
      style={style}
      className={cn(
        'relation-cell flex w-full gap-2 overflow-hidden',
        wrap ? 'flex-wrap whitespace-pre-wrap break-words' : 'flex-nowrap'
      )}
    >
      {noAccess ? (
        <div className={'text-text-secondary'}>No access</div>
      ) : (
        rowIds.map((rowId) => {
          const rowDoc = rows?.[rowId];

          if (!rowDoc) return null;
          return (
            <div
              key={rowId}
              onClick={async (e) => {
                if (!relatedViewId) return;
                e.stopPropagation();

                try {
                  if (navigateToRow) {
                    navigateToRow(rowId, relatedViewId !== viewId ? relatedViewId : undefined);
                    return;
                  }

                  await navigateToView?.(relatedViewId);
                  // eslint-disable-next-line
                } catch (e: any) {
                  notify.error(e.message);
                }
              }}
              className={`min-w-fit overflow-hidden text-text-primary underline ${
                relatedViewId ? 'cursor-pointer hover:text-text-action' : ''
              }`}
            >
              <RelationPrimaryValue fieldId={relatedFieldId} rowDoc={rowDoc} />
            </div>
          );
        })
      )}
    </div>
  );
}

export default RelationItems;
