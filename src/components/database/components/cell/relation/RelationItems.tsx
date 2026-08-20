import CircularProgress from '@mui/material/CircularProgress';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import {
  type DatabaseContextState,
  getPrimaryFieldId,
  useDatabaseContextOptional,
  useDatabaseIdFromField,
} from '@/application/database-yjs';
import type { RelationCell, RelationCellData } from '@/application/database-yjs/cell.type';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import { type YDatabaseField, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { RelationPrimaryValue } from '@/components/database/components/cell/relation/RelationPrimaryValue';
import { cn } from '@/lib/utils';

function RelationItemValue({
  field,
  fieldId,
  onTextChange,
  rowDoc,
  rowId,
}: {
  field?: YDatabaseField;
  fieldId?: string;
  onTextChange: (rowId: string, text: string) => void;
  rowDoc: YDoc;
  rowId: string;
}) {
  const handleTextChange = useCallback((text: string) => onTextChange(rowId, text), [onTextChange, rowId]);

  return <RelationPrimaryValue field={field} fieldId={fieldId} onTextChange={handleTextChange} rowDoc={rowDoc} />;
}

function RelationItems({
  style,
  cell,
  fieldId,
  onTextChange,
  wrap,
}: {
  cell: RelationCell;
  fieldId: string;
  onTextChange?: (text: string) => void;
  style?: CSSProperties;
  wrap: boolean;
}) {
  const { t } = useTranslation();
  const context = useDatabaseContextOptional();
  // databasePageId: The main database page ID in the folder structure
  const viewId = context?.databasePageId;
  const relatedDatabaseId = useDatabaseIdFromField(fieldId);

  const createRow = context?.createRow;
  const loadView = context?.loadView;
  const navigateToRow = context?.navigateToRow;
  const getViewIdFromDatabaseId = context?.getViewIdFromDatabaseId;

  const [noAccess, setNoAccess] = useState(false);
  const [rows, setRows] = useState<DatabaseContextState['rowMap'] | null>();
  const [relatedFieldId, setRelatedFieldId] = useState<string | undefined>();
  const [relatedViewId, setRelatedViewId] = useState<string | null>(null);

  const [databaseDoc, setDatabaseDoc] = useState<YDoc | null>(null);
  const [relatedField, setRelatedField] = useState<YDatabaseField | undefined>();
  const docGuid = databaseDoc?.guid ?? null;

  const [rowIds, setRowIds] = useState<string[]>(() => {
    const data = cell.data;

    return data instanceof Y.Array ? (data.toJSON() as RelationCellData) ?? [] : [];
  });
  const [loading, setLoading] = useState(() => rowIds.length > 0);
  const [rowTexts, setRowTexts] = useState<Record<string, string>>({});
  const hasRelatedRows = rowIds.length > 0;

  const navigateToView = context?.navigateToView;

  const handleRowTextChange = useCallback((rowId: string, text: string) => {
    setRowTexts((current) => (current[rowId] === text ? current : { ...current, [rowId]: text }));
  }, []);
  const searchText = rowIds.reduce((result, rowId) => {
    const text = rowTexts[rowId];

    return text ? `${result}${result ? ' ' : ''}${text}` : result;
  }, '');

  useEffect(() => {
    onTextChange?.(searchText);
  }, [onTextChange, searchText]);

  const handleUpdateRowIds = useCallback(() => {
    const data = cell?.data;

    if (!data || !(data instanceof Y.Array)) {
      setRowIds([]);
      return;
    }

    const ids = (data.toJSON() as RelationCellData) ?? [];

    setRowIds((current) =>
      current.length === ids.length && current.every((rowId, index) => rowId === ids[index]) ? current : ids
    );
  }, [cell.data]);

  useEffect(() => {
    setRelatedViewId(null);
    setDatabaseDoc(null);
    setRelatedFieldId(undefined);
    setRelatedField(undefined);
    setRows(undefined);
    setNoAccess(false);

    if (!relatedDatabaseId || !hasRelatedRows) {
      setLoading(false);
      return;
    }

    setLoading(true);

    if (!getViewIdFromDatabaseId || !loadView) {
      setRelatedViewId(null);
      setNoAccess(true);
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const viewId = await getViewIdFromDatabaseId(relatedDatabaseId);

        if (cancelled) return;

        if (!viewId) {
          setRelatedViewId(null);
          setNoAccess(true);
          setLoading(false);
          return;
        }

        setNoAccess(false);
        setRelatedViewId(viewId);

        const viewDoc = await loadView(viewId, false, false, {
          databaseId: relatedDatabaseId,
          databaseMetadataOnly: true,
        });

        if (cancelled) return;

        if (!viewDoc) {
          throw new Error('No access');
        }

        setDatabaseDoc(viewDoc);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setRelatedViewId(null);
        setNoAccess(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getViewIdFromDatabaseId, hasRelatedRows, loadView, relatedDatabaseId]);

  useEffect(() => {
    if (!hasRelatedRows) {
      setRows({});
      setLoading(false);
      return;
    }

    if (!relatedViewId || !docGuid || !relatedFieldId) return;

    if (!createRow) {
      setNoAccess(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const rowObserverCleanups: Array<() => void> = [];

    setLoading(true);

    void (async () => {
      // Load all rows in parallel instead of sequentially (async-parallel optimization)
      const rowResults = await Promise.allSettled(
        rowIds.map(async (rowId) => {
          const rowDoc = await createRow(getRowKey(docGuid, rowId));

          return [rowId, rowDoc] as const;
        })
      );

      if (cancelled) return;

      const rowEntries: Array<readonly [string, YDoc]> = [];

      rowResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          rowEntries.push(result.value);
        } else {
          console.error(result.reason);
        }
      });

      const rows: Record<string, YDoc> = Object.fromEntries(rowEntries);
      const updateLoadingState = () => {
        if (cancelled) return;

        const hasUnhydratedRow = rowEntries.some(([, rowDoc]) => {
          const data = rowDoc.getMap(YjsEditorKey.data_section);
          const row = data.get(YjsEditorKey.database_row);

          return !(row instanceof Y.Map) || !(row.get(YjsDatabaseKey.cells) instanceof Y.Map);
        });

        setLoading(hasUnhydratedRow);
      };

      setRows(rows);
      rowEntries.forEach(([, rowDoc]) => {
        rowObserverCleanups.push(subscribeSharedYjsDeep(rowDoc.getMap(YjsEditorKey.data_section), updateLoadingState));
      });
      // Subscribe before reading so hydration cannot land between the final
      // readiness check and observer installation.
      updateLoadingState();
    })();

    return () => {
      cancelled = true;
      rowObserverCleanups.forEach((cleanup) => cleanup());
    };
  }, [createRow, docGuid, hasRelatedRows, relatedFieldId, relatedViewId, rowIds]);

  useEffect(() => {
    handleUpdateRowIds();
    const data = cell.data;

    if (!(data instanceof Y.Array)) return;

    data.observe(handleUpdateRowIds);
    return () => {
      data.unobserve(handleUpdateRowIds);
    };
  }, [cell.data, handleUpdateRowIds]);

  useEffect(() => {
    if (!databaseDoc) return;
    const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);

    const observerEvent = () => {
      const database = sharedRoot.get(YjsEditorKey.database);

      if (!database) {
        setRelatedFieldId(undefined);
        setRelatedField(undefined);
        setLoading(hasRelatedRows);
        return;
      }

      const fieldId = getPrimaryFieldId(database);

      setRelatedFieldId(fieldId);
      setRelatedField(fieldId ? database?.get(YjsDatabaseKey.fields)?.get(fieldId) : undefined);
      setNoAccess(!fieldId);
      if (!fieldId) setLoading(false);
    };

    observerEvent();

    // The primary field can change type without replacing the database map.
    // Share the deep observer across rendered relation cells for this database.
    return subscribeSharedYjsDeep(sharedRoot, observerEvent);
  }, [databaseDoc, hasRelatedRows]);

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
        <>
          {rowIds.map((rowId) => {
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
                <RelationItemValue
                  field={relatedField}
                  fieldId={relatedFieldId}
                  onTextChange={handleRowTextChange}
                  rowDoc={rowDoc}
                  rowId={rowId}
                />
              </div>
            );
          })}
          {loading ? (
            <div aria-label={t('loading')} className='flex min-h-5 items-center' role='status'>
              <CircularProgress
                aria-hidden
                className='text-icon-secondary'
                data-testid='relation-cell-loading'
                size={14}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default RelationItems;
