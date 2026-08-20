import { debounce } from 'lodash-es';
import { useEffect } from 'react';

import { useDatabase, useDatabaseContext, useDatabaseFields, useDatabaseView, useRowMap } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { parseRelationTypeOption, parseRollupTypeOption } from '@/application/database-yjs/fields';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { invalidateRelationCell } from '@/application/database-yjs/relation/cache';
import { invalidateRollupCell } from '@/application/database-yjs/rollup/cache';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import { YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

const ROLLUP_OBSERVER_POOL_SIZE = 4;

/**
 * Hook that sets up observers for rollup fields used in sorts/filters.
 * When related row data changes, the rollup values need to be invalidated
 * and recalculated.
 *
 * @param onConditionsChange - Callback to trigger when rollup data changes
 * @param rollupWatchVersion - Version counter to trigger re-setup of observers
 */
export function useRollupFieldObservers(onConditionsChange: () => void, rollupWatchVersion: number) {
  const rows = useRowMap();
  const fields = useDatabaseFields();
  const database = useDatabase();
  const view = useDatabaseView();
  const sorts = view?.get(YjsDatabaseKey.sorts);
  const filters = view?.get(YjsDatabaseKey.filters);
  const { loadView, createRow, getViewIdFromDatabaseId } = useDatabaseContext();

  useEffect(() => {
    if (!rows || !fields || !database || !loadView || !createRow || !getViewIdFromDatabaseId) return;

    // Find relation and rollup fields used in sorts/filters.
    const relationFieldIds = new Set<string>();
    const rollupFieldIds = new Set<string>();

    sorts?.forEach((sort) => {
      const fieldId = sort.get(YjsDatabaseKey.field_id);

      if (!fieldId) return;
      const field = fields.get(fieldId);

      if (field && Number(field.get(YjsDatabaseKey.type)) === FieldType.Relation) {
        relationFieldIds.add(fieldId);
      }

      if (field && Number(field.get(YjsDatabaseKey.type)) === FieldType.Rollup) {
        rollupFieldIds.add(fieldId);
      }
    });

    filters?.forEach((filter) => {
      const fieldId = filter.get(YjsDatabaseKey.field_id);

      if (!fieldId) return;
      const field = fields.get(fieldId);

      if (field && Number(field.get(YjsDatabaseKey.type)) === FieldType.Relation) {
        relationFieldIds.add(fieldId);
      }

      if (field && Number(field.get(YjsDatabaseKey.type)) === FieldType.Rollup) {
        rollupFieldIds.add(fieldId);
      }
    });

    if (relationFieldIds.size === 0 && rollupFieldIds.size === 0) return;

    let cancelled = false;
    const observerCleanups: Array<() => void> = [];
    const rowDocCache = new Map<string, YDoc>();
    const relatedDocCache = new Map<string, YDoc | null>();
    const viewIdCache = new Map<string, string | null>();
    const debouncedChange = debounce(onConditionsChange, 200);

    const getRelatedDoc = async (databaseId: string) => {
      if (relatedDocCache.has(databaseId)) {
        return relatedDocCache.get(databaseId) ?? null;
      }

      const viewId = viewIdCache.has(databaseId)
        ? viewIdCache.get(databaseId)
        : await getViewIdFromDatabaseId(databaseId);

      if (cancelled) return null;
      viewIdCache.set(databaseId, viewId ?? null);
      if (!viewId) {
        relatedDocCache.set(databaseId, null);
        return null;
      }

      const doc = await loadView(viewId, false, false, {
        databaseId,
        databaseMetadataOnly: true,
      });

      if (cancelled) return null;
      relatedDocCache.set(databaseId, doc);
      return doc;
    };

    const getRowDoc = async (rowKey: string) => {
      if (rowDocCache.has(rowKey)) return rowDocCache.get(rowKey);
      const doc = await createRow(rowKey);

      if (cancelled) return undefined;
      if (doc) {
        rowDocCache.set(rowKey, doc);
      }

      return doc;
    };

    const runWithPool = async (tasks: Array<() => Promise<void>>) => {
      if (tasks.length === 0) return;
      let index = 0;
      const poolSize = Math.min(ROLLUP_OBSERVER_POOL_SIZE, tasks.length);

      await Promise.all(
        Array.from({ length: poolSize }, async () => {
          while (!cancelled) {
            const currentIndex = index;

            if (currentIndex >= tasks.length) {
              break;
            }

            index += 1;
            await tasks[currentIndex]();
          }
        })
      );
    };

    const setup = async () => {
      const tasks: Array<() => Promise<void>> = [];

      for (const relationFieldId of relationFieldIds) {
        if (cancelled) return;
        const relationField = fields.get(relationFieldId);
        const relationOption = relationField ? parseRelationTypeOption(relationField) : null;

        if (!relationOption?.database_id) continue;
        const relatedDoc = await getRelatedDoc(relationOption.database_id);

        if (cancelled) return;
        if (!relatedDoc) continue;

        const invalidateRelatedRelationValues = () => {
          Object.keys(rows).forEach((rowId) => {
            invalidateRelationCell(`${rowId}:${relationFieldId}`);
          });
          debouncedChange();
        };

        observerCleanups.push(
          subscribeSharedYjsDeep(relatedDoc.getMap(YjsEditorKey.data_section), invalidateRelatedRelationValues)
        );

        for (const [rowId, rowDoc] of Object.entries(rows)) {
          if (cancelled) return;
          const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as
            | YDatabaseRow
            | undefined;
          const relationCell = row?.get(YjsDatabaseKey.cells)?.get(relationFieldId);
          const relatedRowIds = getRelationRowIdsFromCell(relationCell);

          relatedRowIds.forEach((relatedRowId) => {
            tasks.push(async () => {
              if (cancelled) return;
              const relatedRowDoc = await getRowDoc(getRowKey(relatedDoc.guid, relatedRowId));

              if (cancelled || !relatedRowDoc) return;
              const handler = () => {
                invalidateRelationCell(`${rowId}:${relationFieldId}`);
                debouncedChange();
              };

              observerCleanups.push(subscribeSharedYjsDeep(relatedRowDoc.getMap(YjsEditorKey.data_section), handler));
            });
          });
        }
      }

      for (const rollupFieldId of rollupFieldIds) {
        if (cancelled) return;
        const rollupField = fields.get(rollupFieldId);

        if (!rollupField) continue;
        const rollupOption = parseRollupTypeOption(rollupField);

        if (!rollupOption?.relation_field_id || !rollupOption.target_field_id) continue;
        const relationField = fields.get(rollupOption.relation_field_id);

        if (!relationField) continue;
        const relationOption = parseRelationTypeOption(relationField);

        if (!relationOption?.database_id) continue;

        const relatedDoc = await getRelatedDoc(relationOption.database_id);

        if (cancelled) return;
        if (!relatedDoc) continue;
        const docGuid = relatedDoc.guid;
        const invalidateRelatedRollupValues = () => {
          Object.keys(rows).forEach((rowId) => {
            invalidateRollupCell(`${rowId}:${rollupFieldId}`);
          });
          debouncedChange();
        };

        observerCleanups.push(
          subscribeSharedYjsDeep(relatedDoc.getMap(YjsEditorKey.data_section), invalidateRelatedRollupValues)
        );

        for (const [rowId, rowDoc] of Object.entries(rows)) {
          if (cancelled) return;
          const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
          const row = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

          if (!row) continue;
          const relationCell = row.get(YjsDatabaseKey.cells)?.get(rollupOption.relation_field_id);
          const relatedRowIds = getRelationRowIdsFromCell(relationCell);

          if (relatedRowIds.length === 0) continue;

          for (const relatedRowId of relatedRowIds) {
            tasks.push(async () => {
              if (cancelled) return;
              const relatedRowDoc = await getRowDoc(getRowKey(docGuid, relatedRowId));

              if (cancelled || !relatedRowDoc) return;
              const handler = () => {
                invalidateRollupCell(`${rowId}:${rollupFieldId}`);
                debouncedChange();
              };

              observerCleanups.push(subscribeSharedYjsDeep(relatedRowDoc.getMap(YjsEditorKey.data_section), handler));
            });
          }
        }
      }

      await runWithPool(tasks);
    };

    void setup();

    return () => {
      cancelled = true;
      debouncedChange.cancel();
      observerCleanups.forEach((cleanup) => cleanup());
    };
  }, [
    rows,
    fields,
    database,
    loadView,
    createRow,
    getViewIdFromDatabaseId,
    sorts,
    filters,
    onConditionsChange,
    rollupWatchVersion,
  ]);
}
