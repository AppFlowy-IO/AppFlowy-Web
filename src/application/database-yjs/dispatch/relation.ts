import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import {
  useDatabase,
  useDatabaseContext,
  useRowMap,
  useSharedRoot,
} from '@/application/database-yjs/context';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { normalizeRelationTypeOption, parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { RelationLimit, RelationTypeOption } from '@/application/database-yjs/fields/relation/relation.type';
import { createRelationField, setRelationTypeOptionValues } from '@/application/database-yjs/fields/relation/utils';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import {
  FieldId,
  RowId,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFieldSetting,
  YDatabaseFieldTypeOption,
  YDatabaseRow,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
} from '@/application/types';

type RelationTypeOptionUpdates = Partial<RelationTypeOption>;

type RelationCellChanges = {
  insertedRowIds?: RowId[];
  removedRowIds?: RowId[];
};

type EffectiveRelationCellChanges = {
  insertedRowIds: RowId[];
  removedRowIds: RowId[];
};

function uniq(ids: RowId[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

// Tracks related-database docs we've already bound to sync. loadView resets
// `_syncBound` on cached docs, so calling bindViewSync repeatedly would keep
// incrementing the sync context refcount and leak owners. Caching by doc
// instance keeps our binding to a single owner per doc.
const boundRelatedDocs = new WeakSet<YDoc>();

export function getRelationRowIdsFromCell(cell?: YDatabaseCell): RowId[] {
  if (!cell) return [];

  // useSwitchPropertyType preserves the original cell payload when a non-relation
  // column is converted to Relation (string text, Y.Array file blobs, etc.).
  // Treat anything coming from a different source type as empty so foreign data
  // never gets interpreted as relation row IDs.
  const sourceType = cell.get(YjsDatabaseKey.source_field_type);

  if (sourceType !== undefined && Number(sourceType) !== FieldType.Relation) {
    return [];
  }

  const data = cell.get(YjsDatabaseKey.data);

  if (!data) return [];
  if (data instanceof Y.Array) {
    return uniq(data.toArray().map(String));
  }

  if (Array.isArray(data)) {
    return uniq(data.map(String));
  }

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        return uniq(parsed.map(String));
      }
    } catch {
      return uniq(data.split(',').map((id) => id.trim()));
    }
  }

  return [];
}

function getDatabaseFromDoc(doc: YDoc): YDatabase | null {
  return (doc.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase | undefined) ?? null;
}

function getRowFromDoc(doc: YDoc): YDatabaseRow | null {
  return (doc.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined) ?? null;
}

function getOrCreateRelationCell(rowDoc: YDoc, fieldId: FieldId): YDatabaseCell | null {
  const row = getRowFromDoc(rowDoc);

  if (!row) return null;

  const cells = row.get(YjsDatabaseKey.cells);

  if (!cells) return null;

  let cell = cells.get(fieldId);

  if (!cell) {
    cell = new Y.Map() as YDatabaseCell;
    cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
    cell.set(YjsDatabaseKey.field_type, FieldType.Relation);
    cell.set(YjsDatabaseKey.data, new Y.Array<string>());
    cells.set(fieldId, cell);
  }

  const data = cell.get(YjsDatabaseKey.data);

  if (!(data instanceof Y.Array)) {
    const relationData = new Y.Array<string>();
    const existing = getRelationRowIdsFromCell(cell);

    if (existing.length > 0) {
      relationData.push(existing);
    }

    cell.set(YjsDatabaseKey.data, relationData);
    // The cell now holds canonical relation row IDs, so the source-type marker
    // (carried over from useSwitchPropertyType) must not keep filtering reads
    // through getRelationRowIdsFromCell as foreign data.
    cell.delete(YjsDatabaseKey.source_field_type);
  }

  return cell;
}

export function applyRelationCellChangeset(
  existingRowIds: RowId[],
  changes: RelationCellChanges,
  sourceLimit = RelationLimit.NoLimit
): {
  nextRowIds: RowId[];
  effectiveChanges: EffectiveRelationCellChanges;
} {
  const inserted = uniq(changes.insertedRowIds ?? []);
  const removed = uniq(changes.removedRowIds ?? []);

  if (sourceLimit === RelationLimit.OneOnly && inserted.length > 0) {
    const selectedRowId = inserted[inserted.length - 1];
    const effectiveRemoved = existingRowIds.filter((rowId) => rowId !== selectedRowId);
    const effectiveInserted = existingRowIds.includes(selectedRowId) ? [] : [selectedRowId];

    return {
      nextRowIds: [selectedRowId],
      effectiveChanges: {
        insertedRowIds: effectiveInserted,
        removedRowIds: effectiveRemoved,
      },
    };
  }

  const removedSet = new Set(removed);
  const nextRowIds = existingRowIds.filter((rowId) => !removedSet.has(rowId));
  const nextSet = new Set(nextRowIds);
  const effectiveInserted: RowId[] = [];

  for (const rowId of inserted) {
    if (nextSet.has(rowId)) continue;
    nextSet.add(rowId);
    nextRowIds.push(rowId);
    effectiveInserted.push(rowId);
  }

  const effectiveRemoved = existingRowIds.filter((rowId) => removedSet.has(rowId));

  return {
    nextRowIds,
    effectiveChanges: {
      insertedRowIds: effectiveInserted,
      removedRowIds: effectiveRemoved,
    },
  };
}

function setRelationCellRowIds(rowDoc: YDoc, fieldId: FieldId, rowIds: RowId[]) {
  rowDoc.transact(() => {
    const row = getRowFromDoc(rowDoc);
    const cell = getOrCreateRelationCell(rowDoc, fieldId);

    if (!row || !cell) return;

    const data = new Y.Array<string>();

    if (rowIds.length > 0) {
      data.push(uniq(rowIds));
    }

    cell.set(YjsDatabaseKey.data, data);
    cell.set(YjsDatabaseKey.field_type, FieldType.Relation);
    // Drop any leftover source-type marker — getRelationRowIdsFromCell uses it
    // to ignore preserved-on-conversion payloads, but we just wrote canonical
    // relation data so the marker would now suppress real reads.
    cell.delete(YjsDatabaseKey.source_field_type);
    cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
  });
}

function applyRelationCellChanges(rowDoc: YDoc, fieldId: FieldId, changes: RelationCellChanges, limit: RelationLimit) {
  const existing = getRelationRowIdsFromCell(getRowFromDoc(rowDoc)?.get(YjsDatabaseKey.cells)?.get(fieldId));
  const result = applyRelationCellChangeset(existing, changes, limit);

  setRelationCellRowIds(rowDoc, fieldId, result.nextRowIds);
  return result.effectiveChanges;
}

function ensureRelationTypeOptionMap(field: YDatabaseField): YMapFieldTypeOption {
  let typeOptionMap = field.get(YjsDatabaseKey.type_option);

  if (!typeOptionMap) {
    typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
    field.set(YjsDatabaseKey.type_option, typeOptionMap);
  }

  let typeOption = typeOptionMap.get(String(FieldType.Relation));

  if (!typeOption) {
    typeOption = new Y.Map() as YMapFieldTypeOption;
    typeOptionMap.set(String(FieldType.Relation), typeOption);
  }

  return typeOption;
}

function setRelationTypeOption(field: YDatabaseField, option: RelationTypeOption) {
  const typeOption = ensureRelationTypeOptionMap(field);

  setRelationTypeOptionValues(typeOption, option);
  field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
}

function addFieldToAllViews(database: YDatabase, fieldId: FieldId) {
  const views = database.get(YjsDatabaseKey.views);
  const viewIds = Object.keys(views?.toJSON() ?? {});

  for (const viewId of viewIds) {
    const view = views.get(viewId) as YDatabaseView | undefined;
    const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
    const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

    if (!fieldOrders || !fieldSettings) continue;

    const alreadyOrdered = fieldOrders.toArray().some((item) => item.id === fieldId);

    if (!alreadyOrdered) {
      fieldOrders.push([{ id: fieldId }]);
    }

    if (!fieldSettings.get(fieldId)) {
      const setting = new Y.Map() as YDatabaseFieldSetting;

      setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
      fieldSettings.set(fieldId, setting);
    }
  }
}

function deleteFieldFromDatabase(database: YDatabase, fieldId: FieldId) {
  database.get(YjsDatabaseKey.fields)?.delete(fieldId);

  const views = database.get(YjsDatabaseKey.views);
  const viewIds = Object.keys(views?.toJSON() ?? {});

  for (const viewId of viewIds) {
    const view = views.get(viewId) as YDatabaseView | undefined;
    const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
    const filters = view?.get(YjsDatabaseKey.filters);
    const sorts = view?.get(YjsDatabaseKey.sorts);
    const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

    const fieldIndex = fieldOrders?.toArray().findIndex((item) => item.id === fieldId) ?? -1;

    if (fieldIndex >= 0) {
      fieldOrders?.delete(fieldIndex);
    }

    const filterIndex = filters?.toArray().findIndex((filter) => filter.get(YjsDatabaseKey.field_id) === fieldId) ?? -1;

    if (filterIndex >= 0) {
      filters?.delete(filterIndex);
    }

    const sortIndex = sorts?.toArray().findIndex((sort) => sort.get(YjsDatabaseKey.field_id) === fieldId) ?? -1;

    if (sortIndex >= 0) {
      sorts?.delete(sortIndex);
    }

    fieldSettings?.delete(fieldId);
  }
}

function collectDatabaseRowIds(database: YDatabase, loadedRowIds: RowId[] = []) {
  const rowIds = new Set<RowId>(loadedRowIds);
  const views = database.get(YjsDatabaseKey.views);
  const viewIds = Object.keys(views?.toJSON() ?? {});

  for (const viewId of viewIds) {
    const rowOrders = views.get(viewId)?.get(YjsDatabaseKey.row_orders)?.toArray() as Array<{ id?: string }> | undefined;

    rowOrders?.forEach((row) => {
      if (row.id) rowIds.add(row.id);
    });
  }

  return Array.from(rowIds);
}

// `createRow` opens / binds a row doc but the `database_row` map arrives
// asynchronously from sync. Without waiting, getOrCreateRelationCell sees no
// row and silently drops the reciprocal write — leaving two-way relations
// pointing at a row that never got a back-link. Wait briefly for the data to
// arrive; resolve null on timeout so we don't block forever on a permanently
// missing row.
const ROW_HYDRATION_TIMEOUT_MS = 3000;

function waitForRowHydration(rowDoc: YDoc, timeoutMs = ROW_HYDRATION_TIMEOUT_MS): Promise<YDoc | null> {
  if (hasRowConditionData(rowDoc)) return Promise.resolve(rowDoc);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: YDoc | null) => {
      if (settled) return;
      settled = true;
      rowDoc.off('update', listener);
      clearTimeout(timer);
      resolve(value);
    };

    const listener = () => {
      if (hasRowConditionData(rowDoc)) finish(rowDoc);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    rowDoc.on('update', listener);
  });
}

async function loadRowDoc(args: {
  databaseDoc: YDoc;
  rowId: RowId;
  rowMap?: Record<RowId, YDoc> | null;
  createRow?: (rowKey: string) => Promise<YDoc>;
}) {
  const cached = args.rowMap?.[args.rowId];

  if (cached) return cached;
  if (!args.createRow) return null;

  const rowDoc = await args.createRow(getRowKey(args.databaseDoc.guid, args.rowId));

  return waitForRowHydration(rowDoc);
}

async function loadRelatedDatabaseDoc(args: {
  sourceDatabase: YDatabase;
  sourceDatabaseDoc: YDoc;
  relatedDatabaseId: string;
  loadView?: (viewId: string) => Promise<YDoc | null>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  bindViewSync?: (doc: YDoc) => unknown;
}) {
  const sourceDatabaseId = args.sourceDatabase.get(YjsDatabaseKey.id);

  if (sourceDatabaseId === args.relatedDatabaseId) {
    return args.sourceDatabaseDoc;
  }

  const relatedViewId = await args.getViewIdFromDatabaseId?.(args.relatedDatabaseId);

  if (!relatedViewId || !args.loadView) return null;

  const doc = await args.loadView(relatedViewId);

  // loadView may return a cache-only doc that is not bound to server sync.
  // Bind it so reciprocal field/cell mutations propagate to other clients;
  // without this, two-way relation edits to an unopened related database can
  // remain local and other clients see a dangling reciprocal pointer.
  // The WeakSet dedupe is essential: loadView resets `_syncBound = false`
  // on cached docs, so calling bindViewSync on every relation edit would keep
  // incrementing registerSyncContext's refcount and leak sync owners.
  if (doc && args.bindViewSync && !boundRelatedDocs.has(doc)) {
    boundRelatedDocs.add(doc);
    args.bindViewSync(doc);
  }

  return doc;
}

export async function deleteReciprocalRelationField(args: {
  sourceDatabase: YDatabase;
  sourceDatabaseDoc: YDoc;
  relationOption: RelationTypeOption | null;
  loadView?: (viewId: string) => Promise<YDoc | null>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  bindViewSync?: (doc: YDoc) => unknown;
}) {
  const { relationOption } = args;

  if (!relationOption?.is_two_way || !relationOption.database_id || !relationOption.reciprocal_field_id) {
    return;
  }

  const relatedDoc = await loadRelatedDatabaseDoc({
    sourceDatabase: args.sourceDatabase,
    sourceDatabaseDoc: args.sourceDatabaseDoc,
    relatedDatabaseId: relationOption.database_id,
    loadView: args.loadView,
    getViewIdFromDatabaseId: args.getViewIdFromDatabaseId,
    bindViewSync: args.bindViewSync,
  });
  const relatedDatabase = relatedDoc ? getDatabaseFromDoc(relatedDoc) : null;

  if (!relatedDoc || !relatedDatabase) return;

  relatedDoc.transact(() => {
    deleteFieldFromDatabase(relatedDatabase, relationOption.reciprocal_field_id as FieldId);
  });
}

async function clearRelationCells(args: {
  database: YDatabase;
  databaseDoc: YDoc;
  fieldId: FieldId;
  rowMap?: Record<RowId, YDoc> | null;
  createRow?: (rowKey: string) => Promise<YDoc>;
}) {
  const rowIds = collectDatabaseRowIds(args.database, Object.keys(args.rowMap ?? {}));

  await Promise.all(rowIds.map(async (rowId) => {
    const rowDoc = await loadRowDoc({
      databaseDoc: args.databaseDoc,
      rowId,
      rowMap: args.rowMap,
      createRow: args.createRow,
    });

    rowDoc?.transact(() => {
      const row = getRowFromDoc(rowDoc);

      row?.get(YjsDatabaseKey.cells)?.delete(args.fieldId);
      row?.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    });
  }));
}

async function backfillReciprocalLinks(args: {
  sourceDatabase: YDatabase;
  sourceDatabaseDoc: YDoc;
  sourceFieldId: FieldId;
  reciprocalDatabaseDoc: YDoc;
  reciprocalFieldId: FieldId;
  rowMap?: Record<RowId, YDoc> | null;
  createRow?: (rowKey: string) => Promise<YDoc>;
}) {
  const sourceRowIds = collectDatabaseRowIds(args.sourceDatabase, Object.keys(args.rowMap ?? {}));

  await Promise.all(sourceRowIds.map(async (sourceRowId) => {
    const sourceRowDoc = await loadRowDoc({
      databaseDoc: args.sourceDatabaseDoc,
      rowId: sourceRowId,
      rowMap: args.rowMap,
      createRow: args.createRow,
    });

    if (!sourceRowDoc) return;

    const relatedRowIds = getRelationRowIdsFromCell(
      getRowFromDoc(sourceRowDoc)?.get(YjsDatabaseKey.cells)?.get(args.sourceFieldId)
    );

    await Promise.all(relatedRowIds.map(async (relatedRowId) => {
      const relatedRowDoc = await loadRowDoc({
        databaseDoc: args.reciprocalDatabaseDoc,
        rowId: relatedRowId,
        createRow: args.createRow,
        rowMap: args.reciprocalDatabaseDoc === args.sourceDatabaseDoc ? args.rowMap : undefined,
      });

      if (!relatedRowDoc) return;

      applyRelationCellChanges(relatedRowDoc, args.reciprocalFieldId, { insertedRowIds: [sourceRowId] }, RelationLimit.NoLimit);
    }));
  }));
}

export async function applyRelationReciprocalInserts(args: {
  sourceRowId: RowId;
  sourceFieldId: FieldId;
  insertedRowIds: RowId[];
  database: YDatabase;
  databaseDoc: YDoc;
  rowMap?: Record<RowId, YDoc> | null;
  createRow?: (rowKey: string) => Promise<YDoc>;
  loadView?: (viewId: string) => Promise<YDoc | null>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
  bindViewSync?: (doc: YDoc) => unknown;
}) {
  if (args.insertedRowIds.length === 0) return;

  const field = args.database.get(YjsDatabaseKey.fields)?.get(args.sourceFieldId);

  if (!field) return;

  const typeOption = parseRelationTypeOption(field);

  if (!typeOption.is_two_way || !typeOption.database_id || !typeOption.reciprocal_field_id) {
    return;
  }

  const relatedDoc = await loadRelatedDatabaseDoc({
    sourceDatabase: args.database,
    sourceDatabaseDoc: args.databaseDoc,
    relatedDatabaseId: typeOption.database_id,
    loadView: args.loadView,
    getViewIdFromDatabaseId: args.getViewIdFromDatabaseId,
    bindViewSync: args.bindViewSync,
  });

  if (!relatedDoc) return;

  const relatedDatabase = getDatabaseFromDoc(relatedDoc);
  const reciprocalFieldId = typeOption.reciprocal_field_id;
  const reciprocalField = relatedDatabase?.get(YjsDatabaseKey.fields)?.get(reciprocalFieldId);
  const reciprocalLimit = reciprocalField
    ? parseRelationTypeOption(reciprocalField).source_limit
    : RelationLimit.NoLimit;

  await Promise.all(args.insertedRowIds.map(async (targetRowId) => {
    const targetRowDoc = await loadRowDoc({
      databaseDoc: relatedDoc,
      rowId: targetRowId,
      createRow: args.createRow,
      rowMap: relatedDoc === args.databaseDoc ? args.rowMap : undefined,
    });

    if (!targetRowDoc) return;

    const reciprocalChanges = applyRelationCellChanges(
      targetRowDoc,
      reciprocalFieldId,
      { insertedRowIds: [args.sourceRowId] },
      reciprocalLimit
    );

    if (reciprocalLimit !== RelationLimit.OneOnly) return;

    await Promise.all(reciprocalChanges.removedRowIds.map(async (removedSourceRowId) => {
      if (removedSourceRowId === args.sourceRowId) return;

      const removedSourceRowDoc = await loadRowDoc({
        databaseDoc: args.databaseDoc,
        rowId: removedSourceRowId,
        rowMap: args.rowMap,
        createRow: args.createRow,
      });

      if (!removedSourceRowDoc) return;

      applyRelationCellChanges(
        removedSourceRowDoc,
        args.sourceFieldId,
        { removedRowIds: [targetRowId] },
        typeOption.source_limit
      );
    }));
  }));
}

export function useUpdateRelationCell(rowId: RowId, fieldId: FieldId) {
  const context = useDatabaseContext();
  const database = useDatabase();
  const rowMap = useRowMap();
  const { createRow, getViewIdFromDatabaseId, loadView, bindViewSync } = context;

  return useCallback(
    async (changes: RelationCellChanges) => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) return;

      const typeOption = parseRelationTypeOption(field);
      const sourceRowDoc = await loadRowDoc({
        databaseDoc: context.databaseDoc,
        rowId,
        rowMap,
        createRow,
      });

      if (!sourceRowDoc) return;

      const effectiveChanges = applyRelationCellChanges(sourceRowDoc, fieldId, changes, typeOption.source_limit);

      if (!typeOption.is_two_way || !typeOption.database_id || !typeOption.reciprocal_field_id) {
        return;
      }

      const relatedDoc = await loadRelatedDatabaseDoc({
        sourceDatabase: database,
        sourceDatabaseDoc: context.databaseDoc,
        relatedDatabaseId: typeOption.database_id,
        loadView,
        getViewIdFromDatabaseId,
        bindViewSync,
      });

      if (!relatedDoc) return;

      const relatedDatabase = getDatabaseFromDoc(relatedDoc);
      const reciprocalField = relatedDatabase?.get(YjsDatabaseKey.fields)?.get(typeOption.reciprocal_field_id);
      const reciprocalLimit = reciprocalField
        ? parseRelationTypeOption(reciprocalField).source_limit
        : RelationLimit.NoLimit;

      await Promise.all(effectiveChanges.removedRowIds.map(async (targetRowId) => {
        const targetRowDoc = await loadRowDoc({
          databaseDoc: relatedDoc,
          rowId: targetRowId,
          createRow,
          rowMap: relatedDoc === context.databaseDoc ? rowMap : undefined,
        });

        if (!targetRowDoc) return;

        applyRelationCellChanges(
          targetRowDoc,
          typeOption.reciprocal_field_id as FieldId,
          { removedRowIds: [rowId] },
          reciprocalLimit
        );
      }));

      await applyRelationReciprocalInserts({
        sourceRowId: rowId,
        sourceFieldId: fieldId,
        insertedRowIds: effectiveChanges.insertedRowIds,
        database,
        databaseDoc: context.databaseDoc,
        rowMap,
        createRow,
        loadView,
        getViewIdFromDatabaseId,
        bindViewSync,
      });
    },
    [bindViewSync, context, createRow, database, fieldId, getViewIdFromDatabaseId, loadView, rowId, rowMap]
  );
}

export function useUpdateRelationTypeOption(fieldId: FieldId) {
  const context = useDatabaseContext();
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowMap();
  const { createRow, getViewIdFromDatabaseId, loadView, bindViewSync } = context;

  return useCallback(
    async (updates: RelationTypeOptionUpdates) => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) return;

      const oldOption = parseRelationTypeOption(field);
      let nextOption = normalizeRelationTypeOption({
        ...oldOption,
        ...updates,
      });
      // Legacy / mid-migration database docs may have an undefined `database.id`;
      // fall back to the doc guid (matches other database code paths) so the
      // reciprocal field is created with a resolvable database_id.
      const sourceDatabaseId = database.get(YjsDatabaseKey.id) ?? context.databaseDoc.guid;
      const databaseIdChanged =
        updates.database_id !== undefined && updates.database_id !== oldOption.database_id;
      const disablingTwoWay = oldOption.is_two_way && updates.is_two_way === false;

      if ((databaseIdChanged || disablingTwoWay) && oldOption.reciprocal_field_id && oldOption.database_id) {
        const oldRelatedDoc = await loadRelatedDatabaseDoc({
          sourceDatabase: database,
          sourceDatabaseDoc: context.databaseDoc,
          relatedDatabaseId: oldOption.database_id,
          loadView,
          getViewIdFromDatabaseId,
          bindViewSync,
        });
        const oldRelatedDatabase = oldRelatedDoc ? getDatabaseFromDoc(oldRelatedDoc) : null;

        if (oldRelatedDatabase) {
          oldRelatedDoc?.transact(() => deleteFieldFromDatabase(oldRelatedDatabase, oldOption.reciprocal_field_id as FieldId));
        }
      }

      if (databaseIdChanged) {
        await clearRelationCells({
          database,
          databaseDoc: context.databaseDoc,
          fieldId,
          rowMap,
          createRow,
        });
        nextOption = {
          ...nextOption,
          reciprocal_field_id: undefined,
          reciprocal_field_name: nextOption.is_two_way ? nextOption.reciprocal_field_name : undefined,
        };
      }

      const shouldCreateReciprocal =
        nextOption.is_two_way && nextOption.database_id && !nextOption.reciprocal_field_id;

      if (shouldCreateReciprocal) {
        const relatedDoc = await loadRelatedDatabaseDoc({
          sourceDatabase: database,
          sourceDatabaseDoc: context.databaseDoc,
          relatedDatabaseId: nextOption.database_id,
          loadView,
          getViewIdFromDatabaseId,
          bindViewSync,
        });
        const relatedDatabase = relatedDoc ? getDatabaseFromDoc(relatedDoc) : null;

        if (relatedDoc && relatedDatabase) {
          const reciprocalFieldId = nanoid(6);
          const reciprocalFieldName = nextOption.reciprocal_field_name || field.get(YjsDatabaseKey.name);
          const reciprocalField = createRelationField(reciprocalFieldId, {
            name: reciprocalFieldName,
            database_id: sourceDatabaseId,
            is_two_way: true,
            reciprocal_field_id: fieldId,
            source_limit: RelationLimit.NoLimit,
            target_limit: RelationLimit.NoLimit,
          });

          relatedDoc.transact(() => {
            relatedDatabase.get(YjsDatabaseKey.fields)?.set(reciprocalFieldId, reciprocalField);
            addFieldToAllViews(relatedDatabase, reciprocalFieldId);
          });

          nextOption = {
            ...nextOption,
            reciprocal_field_id: reciprocalFieldId,
          };

          await backfillReciprocalLinks({
            sourceDatabase: database,
            sourceDatabaseDoc: context.databaseDoc,
            sourceFieldId: fieldId,
            reciprocalDatabaseDoc: relatedDoc,
            reciprocalFieldId,
            rowMap,
            createRow,
          });
        } else {
          // Couldn't load the related database to create a reciprocal field.
          // Fall back to a one-way relation so we don't persist `is_two_way: true`
          // without a reciprocal_field_id, which would silently break cell mirroring.
          nextOption = {
            ...nextOption,
            is_two_way: false,
          };
        }
      }

      if (!nextOption.is_two_way) {
        nextOption = {
          ...nextOption,
          reciprocal_field_id: undefined,
          reciprocal_field_name: undefined,
        };
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            const currentField = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!currentField) return;
            setRelationTypeOption(currentField, nextOption);
          },
        ],
        'updateRelationTypeOption'
      );

      if (nextOption.is_two_way && nextOption.reciprocal_field_id && nextOption.database_id) {
        const relatedDoc = await loadRelatedDatabaseDoc({
          sourceDatabase: database,
          sourceDatabaseDoc: context.databaseDoc,
          relatedDatabaseId: nextOption.database_id,
          loadView,
          getViewIdFromDatabaseId,
          bindViewSync,
        });
        const relatedDatabase = relatedDoc ? getDatabaseFromDoc(relatedDoc) : null;
        const reciprocalField = relatedDatabase?.get(YjsDatabaseKey.fields)?.get(nextOption.reciprocal_field_id);

        if (relatedDoc && reciprocalField) {
          const reciprocalOption = parseRelationTypeOption(reciprocalField);

          relatedDoc.transact(() => {
            setRelationTypeOption(reciprocalField, {
              ...reciprocalOption,
              database_id: sourceDatabaseId,
              is_two_way: true,
              reciprocal_field_id: fieldId,
            });
          });
        }
      }
    },
    [bindViewSync, context, createRow, database, fieldId, getViewIdFromDatabaseId, loadView, rowMap, sharedRoot]
  );
}

/**
 * Create a new row in a (possibly different) related database with the
 * primary cell pre-filled, then return its row id. Mirrors the desktop
 * `_handleCreateAndLinkRow` flow (see commit c811059939, AppFlowy#8644):
 *   1. Resolve the target's primary field from its loaded view doc.
 *   2. Create a fresh row doc and seed the primary cell with `primaryText`.
 *   3. Append the row id to every view's `row_orders` in the target db.
 * The caller is expected to pipe the returned row id through the existing
 * relation-update path (`useUpdateRelationCell` / `onAddRelationRowId`)
 * so the source cell, OneOnly limits, and reciprocal back-links all get
 * the same handling as a normal "select existing row" action.
 */
export async function createRowInRelatedDatabase(args: {
  relatedDatabaseDoc: YDoc;
  primaryFieldId: FieldId;
  primaryText: string;
  createRow?: (rowKey: string) => Promise<YDoc>;
  bindViewSync?: (doc: YDoc) => unknown;
}): Promise<RowId | null> {
  const trimmed = args.primaryText.trim();

  if (!trimmed) return null;
  if (!args.createRow) return null;

  const relatedDatabase = getDatabaseFromDoc(args.relatedDatabaseDoc);

  if (!relatedDatabase) return null;

  const databaseId = relatedDatabase.get(YjsDatabaseKey.id) || args.relatedDatabaseDoc.guid;
  const rowId = uuidv4();
  const rowKey = getRowKey(args.relatedDatabaseDoc.guid, rowId);
  const rowDoc = await args.createRow(rowKey);

  rowDoc.transact(() => {
    initialDatabaseRow(rowId, databaseId, rowDoc);
    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as Y.Map<unknown>;
    const row = rowSharedRoot.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

    if (!row) return;

    const cells = row.get(YjsDatabaseKey.cells);

    if (!cells) return;

    const primaryCell = new Y.Map() as YDatabaseCell;
    const now = String(dayjs().unix());

    primaryCell.set(YjsDatabaseKey.created_at, now);
    primaryCell.set(YjsDatabaseKey.last_modified, now);
    primaryCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    primaryCell.set(YjsDatabaseKey.data, trimmed);
    cells.set(args.primaryFieldId, primaryCell);
  });

  // Add the new row to every view's row_orders so it shows up in any open
  // grid/board/calendar of the target database.
  args.relatedDatabaseDoc.transact(() => {
    const views = relatedDatabase.get(YjsDatabaseKey.views);

    if (!views) return;

    Object.keys(views.toJSON()).forEach((viewId) => {
      const view = views.get(viewId) as YDatabaseView | undefined;
      const rowOrders = view?.get(YjsDatabaseKey.row_orders);

      if (rowOrders) {
        rowOrders.push([{ id: rowId, height: 36 }]);
      }
    });
  });

  // Bind sync if the target db hasn't been opened yet so the new row
  // propagates. The shared `boundRelatedDocs` WeakSet keeps this idempotent
  // across multiple create-and-link calls in one session.
  if (args.bindViewSync && !boundRelatedDocs.has(args.relatedDatabaseDoc)) {
    boundRelatedDocs.add(args.relatedDatabaseDoc);
    args.bindViewSync(args.relatedDatabaseDoc);
  }

  return rowId;
}
