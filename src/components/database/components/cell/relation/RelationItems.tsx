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
import {
  type YDatabase,
  type YDatabaseField,
  type YDatabaseView,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { RelationPrimaryValue } from '@/components/database/components/cell/relation/RelationPrimaryValue';
import { getLiveDatabaseRowIds } from '@/components/database/components/cell/relation/relationRowOrders';
import { cn } from '@/lib/utils';

function isRowStructurallyHydrated(rowDoc: YDoc): boolean {
  const data = rowDoc.getMap(YjsEditorKey.data_section);
  const row = data.get(YjsEditorKey.database_row);

  return row instanceof Y.Map && row.get(YjsDatabaseKey.cells) instanceof Y.Map;
}

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

interface RelationItemsProps {
  cell: RelationCell;
  fieldId: string;
  onTextChange?: (text: string) => void;
  style?: CSSProperties;
  wrap: boolean;
}

function RelationItemsForDatabase({
  style,
  cell,
  onTextChange,
  wrap,
  relatedDatabaseId,
}: RelationItemsProps & { relatedDatabaseId: string | undefined }) {
  const { t } = useTranslation();
  const context = useDatabaseContextOptional();
  // databasePageId: The main database page ID in the folder structure
  const viewId = context?.databasePageId;

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
  // null means the target database has not exposed authoritative row_orders
  // yet. Once present, linked ids absent from this list are stale/deleted and
  // their empty row docs must not keep the cell in a loading state forever.
  const [liveRelatedRowIds, setLiveRelatedRowIds] = useState<string[] | null>(null);
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
    setLiveRelatedRowIds(null);
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
    const rowObserverCleanups = new Map<string, () => void>();
    const liveRelatedRowIdSet = liveRelatedRowIds === null ? null : new Set(liveRelatedRowIds);
    const targetRowIds =
      liveRelatedRowIdSet === null ? rowIds : rowIds.filter((rowId) => liveRelatedRowIdSet.has(rowId));

    if (targetRowIds.length === 0) {
      setRows({});
      setLoading(false);
      return;
    }

    setLoading(true);

    void (async () => {
      // Load all rows in parallel instead of sequentially (async-parallel optimization)
      const rowResults = await Promise.allSettled(
        targetRowIds.map(async (rowId) => {
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
      const pendingRowIds = new Set<string>();

      setRows(rows);
      rowEntries.forEach(([rowId, rowDoc]) => {
        if (isRowStructurallyHydrated(rowDoc)) return;

        pendingRowIds.add(rowId);
        const markReady = () => {
          if (cancelled || !isRowStructurallyHydrated(rowDoc)) return;

          pendingRowIds.delete(rowId);
          rowObserverCleanups.get(rowId)?.();
          rowObserverCleanups.delete(rowId);
          if (pendingRowIds.size === 0) setLoading(false);
        };

        rowObserverCleanups.set(rowId, subscribeSharedYjsDeep(rowDoc.getMap(YjsEditorKey.data_section), markReady));
        // Subscribe before reading so hydration cannot land between the final
        // readiness check and observer installation.
        markReady();
      });
      setLoading(pendingRowIds.size > 0);
    })();

    return () => {
      cancelled = true;
      rowObserverCleanups.forEach((cleanup) => cleanup());
      rowObserverCleanups.clear();
    };
  }, [createRow, docGuid, hasRelatedRows, liveRelatedRowIds, relatedFieldId, relatedViewId, rowIds]);

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
    let observedDatabase: YDatabase | undefined;
    let cleanupFields: (() => void) | undefined;
    let membershipCleanups: Array<() => void> = [];

    const updatePrimaryField = () => {
      if (!observedDatabase) {
        setRelatedFieldId(undefined);
        setRelatedField(undefined);
        return;
      }

      const primaryFieldId = getPrimaryFieldId(observedDatabase);

      setRelatedFieldId(primaryFieldId);
      setRelatedField(primaryFieldId ? observedDatabase.get(YjsDatabaseKey.fields)?.get(primaryFieldId) : undefined);
      setNoAccess(!primaryFieldId);
      if (!primaryFieldId) setLoading(false);
    };

    const updateMembership = () => {
      const databaseRowIds = observedDatabase ? getLiveDatabaseRowIds(observedDatabase) : null;
      const databaseRowIdSet = databaseRowIds === null ? null : new Set(databaseRowIds);
      const nextLiveRowIds =
        databaseRowIdSet === null ? null : rowIds.filter((rowId) => databaseRowIdSet.has(rowId)).sort();

      setLiveRelatedRowIds((current) => {
        if (current === nextLiveRowIds) return current;
        if (current === null || nextLiveRowIds === null) return nextLiveRowIds;
        return current.length === nextLiveRowIds.length && current.every((id, index) => id === nextLiveRowIds[index])
          ? current
          : nextLiveRowIds;
      });
    };

    const detachMembership = () => {
      membershipCleanups.forEach((cleanup) => cleanup());
      membershipCleanups = [];
    };

    const attachMembership = () => {
      detachMembership();

      const database = observedDatabase;
      const views = database?.get(YjsDatabaseKey.views);
      const metas = database?.get(YjsDatabaseKey.metas);

      if (metas) {
        const handleMetasChange = (event: Y.YMapEvent<unknown>) => {
          if (event.keysChanged.has(YjsDatabaseKey.iid)) updateMembership();
        };

        metas.observe(handleMetasChange);
        membershipCleanups.push(() => metas.unobserve(handleMetasChange));
      }

      if (views) {
        const handleViewsChange = () => attachMembership();

        views.observe(handleViewsChange);
        membershipCleanups.push(() => views.unobserve(handleViewsChange));

        views.forEach((view: YDatabaseView) => {
          const handleViewChange = (event: Y.YMapEvent<unknown>) => {
            if (event.keysChanged.has(YjsDatabaseKey.row_orders) || event.keysChanged.has(YjsDatabaseKey.is_inline)) {
              attachMembership();
            }
          };

          const rowOrders = view.get(YjsDatabaseKey.row_orders);

          view.observe(handleViewChange);
          membershipCleanups.push(() => view.unobserve(handleViewChange));

          if (rowOrders) {
            const handleRowOrdersChange = () => updateMembership();

            rowOrders.observe(handleRowOrdersChange);
            membershipCleanups.push(() => rowOrders.unobserve(handleRowOrdersChange));
          }
        });
      }

      updateMembership();
    };

    const attachFields = () => {
      cleanupFields?.();
      cleanupFields = undefined;

      const fields = observedDatabase?.get(YjsDatabaseKey.fields);

      if (fields) cleanupFields = subscribeSharedYjsDeep(fields, updatePrimaryField);
      updatePrimaryField();
    };

    const handleDatabaseChange = (event: Y.YMapEvent<unknown>) => {
      if (event.keysChanged.has(YjsDatabaseKey.fields)) attachFields();
      if (event.keysChanged.has(YjsDatabaseKey.views) || event.keysChanged.has(YjsDatabaseKey.metas)) {
        attachMembership();
      }
    };

    const attachDatabase = () => {
      observedDatabase?.unobserve(handleDatabaseChange);
      cleanupFields?.();
      cleanupFields = undefined;
      detachMembership();

      observedDatabase = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;

      if (!observedDatabase) {
        setRelatedFieldId(undefined);
        setRelatedField(undefined);
        setLiveRelatedRowIds(null);
        setLoading(hasRelatedRows);
        return;
      }

      observedDatabase.observe(handleDatabaseChange);
      attachFields();
      attachMembership();
    };

    const handleSharedRootChange = (event: Y.YMapEvent<unknown>) => {
      if (event.keysChanged.has(YjsEditorKey.database)) attachDatabase();
    };

    sharedRoot.observe(handleSharedRootChange);
    attachDatabase();

    return () => {
      sharedRoot.unobserve(handleSharedRootChange);
      observedDatabase?.unobserve(handleDatabaseChange);
      cleanupFields?.();
      detachMembership();
    };
  }, [databaseDoc, hasRelatedRows, rowIds]);

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

function RelationItems(props: RelationItemsProps) {
  const relatedDatabaseId = useDatabaseIdFromField(props.fieldId);

  // Every local doc and async row result belongs to one immutable relation
  // target. A keyed implementation prevents a pending database-A load from
  // committing rows after the field has switched to database B.
  return <RelationItemsForDatabase key={relatedDatabaseId ?? ''} {...props} relatedDatabaseId={relatedDatabaseId} />;
}

export default RelationItems;
