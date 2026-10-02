import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { AttributionUid, resolveUserAttributionUid, touchRowAttribution } from '@/application/database-yjs/attribution';
import { getStoredCellFieldType, setCellStoredType } from '@/application/database-yjs/cell.field-type';
import { useDatabase, useDatabaseContext, useRowMap, useSharedRoot } from '@/application/database-yjs/context';
import { waitForDatabaseHydration } from '@/application/database-yjs/database.hydration';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { normalizeRelationTypeOption, parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { RelationLimit, RelationTypeOption } from '@/application/database-yjs/fields/relation/relation.type';
import { createRelationField, setRelationTypeOptionValues } from '@/application/database-yjs/fields/relation/utils';
import {
  CellWriteStatus,
  checkExistingCellWrite,
  shouldSkipBulkRewrite,
  writeStatusFor,
} from '@/application/database-yjs/fields/text/rich-text-guard';
import { notifyRichTextNewer } from '@/application/database-yjs/fields/text/rich-text-notice';
import {
  executeDatabaseOperations as executeOperations,
  runDatabaseAction,
  runDatabaseRowAction,
} from '@/application/database-yjs/history';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { waitForDatabaseRowHydration } from '@/application/database-yjs/row.hydration';
import { getRowKey } from '@/application/database-yjs/row_meta';
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
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

import { migrateRollupsForRelation } from '../rollup/filter';

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

export { getRelationRowIdsFromCell };

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
  const sourceType = getStoredCellFieldType(cell, FieldType.Relation);

  if (sourceType !== FieldType.Relation || !(data instanceof Y.Array)) {
    const relationData = new Y.Array<string>();
    const existing = getRelationRowIdsFromCell(cell);

    if (existing.length > 0) {
      relationData.push(existing);
    }

    cell.set(YjsDatabaseKey.data, relationData);
    setCellStoredType(cell, FieldType.Relation);
    // The cell now holds canonical relation row IDs, so legacy source metadata
    // must not keep filtering reads as foreign data.
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

/**
 * Replaces a relation cell's row ids. A cell holding formatting that needs a
 * newer client (a Text cell before the field became a Relation) is never
 * rewritten (rich text spec R49).
 */
export function setRelationCellRowIds(
  rowDoc: YDoc,
  fieldId: FieldId,
  rowIds: RowId[],
  actorUid?: AttributionUid
): CellWriteStatus {
  let status: CellWriteStatus = 'written';

  runDatabaseRowAction(rowDoc, { type: 'relation.update-cell', fieldId, fieldType: FieldType.Relation }, () => {
    const row = getRowFromDoc(rowDoc);
    const ids = uniq(rowIds);
    const check = checkExistingCellWrite(row?.get(YjsDatabaseKey.cells)?.get(fieldId), {
      set: { [YjsDatabaseKey.data]: ids },
      delete: [YjsDatabaseKey.source_field_type],
    });

    if (check !== 'proceed') {
      status = writeStatusFor(check);
      return;
    }

    const cell = getOrCreateRelationCell(rowDoc, fieldId);

    if (!row || !cell) return;

    const data = new Y.Array<string>();

    if (ids.length > 0) {
      data.push(ids);
    }

    cell.set(YjsDatabaseKey.data, data);
    setCellStoredType(cell, FieldType.Relation);
    // Drop any leftover source-type marker — getRelationRowIdsFromCell uses it
    // to ignore preserved-on-conversion payloads, but we just wrote canonical
    // relation data so the marker would now suppress real reads.
    cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    touchRowAttribution(row, actorUid);
  });

  return status;
}

function applyRelationCellChanges(
  rowDoc: YDoc,
  fieldId: FieldId,
  changes: RelationCellChanges,
  limit: RelationLimit,
  actorUid?: AttributionUid
) {
  const existing = getRelationRowIdsFromCell(getRowFromDoc(rowDoc)?.get(YjsDatabaseKey.cells)?.get(fieldId));
  const result = applyRelationCellChangeset(existing, changes, limit);

  // A refused cell changes nothing, so its reciprocal side must not change either.
  if (setRelationCellRowIds(rowDoc, fieldId, result.nextRowIds, actorUid) === 'refused-rich-text-newer') {
    notifyRichTextNewer();
    return { insertedRowIds: [], removedRowIds: [] };
  }

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

export function addFieldToAllViews(database: YDatabase, fieldId: FieldId) {
  const views = database.get(YjsDatabaseKey.views);
  const viewIds = Object.keys(views?.toJSON() ?? {});

  for (const viewId of viewIds) {
    const view = views.get(viewId) as YDatabaseView | undefined;
    const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
    const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

    // `field_orders` is what the grid renders from; `field_settings` only carries visibility and
    // is optional-chained everywhere it is read. Bailing out on a view that has no settings map
    // used to drop the reciprocal column from that view entirely.
    if (!fieldOrders) continue;

    const alreadyOrdered = fieldOrders.toArray().some((item) => item.id === fieldId);

    if (!alreadyOrdered) {
      fieldOrders.push([{ id: fieldId }]);
    }

    if (fieldSettings && !fieldSettings.get(fieldId)) {
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
    const rowOrders = views.get(viewId)?.get(YjsDatabaseKey.row_orders)?.toArray() as
      | Array<{ id?: string; is_deleted?: boolean }>
      | undefined;

    rowOrders?.forEach((row) => {
      if (row.id && !row.is_deleted) rowIds.add(row.id);
    });
  }

  return Array.from(rowIds);
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

  return waitForDatabaseRowHydration(rowDoc);
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

  // `loadView` resolves as soon as a doc exists locally, which for a database that has never been
  // opened can be an empty shell with the first sync still in flight. Every caller reads the
  // `database` map straight away and silently degrades when it is missing — dropping the relation
  // back to one-way, or skipping the reciprocal cell write — so wait for it to land. The wait must
  // come AFTER binding sync: for a cache-only shell with no HTTP fetch in flight, the sync binding
  // is the only channel that can deliver the missing `database` map, and waiting first would let
  // the timeout expire before that channel even opens.
  if (doc) await waitForDatabaseHydration(doc);

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

  runDatabaseAction(relatedDoc, { type: 'relation.delete-reciprocal-field', policy: 'skip' }, () => {
    deleteFieldFromDatabase(relatedDatabase, relationOption.reciprocal_field_id as FieldId);
  });
}

async function clearRelationCells(args: {
  database: YDatabase;
  databaseDoc: YDoc;
  fieldId: FieldId;
  rowMap?: Record<RowId, YDoc> | null;
  createRow?: (rowKey: string) => Promise<YDoc>;
  actorUid?: AttributionUid;
}) {
  const rowIds = collectDatabaseRowIds(args.database, Object.keys(args.rowMap ?? {}));

  await Promise.all(
    rowIds.map(async (rowId) => {
      const rowDoc = await loadRowDoc({
        databaseDoc: args.databaseDoc,
        rowId,
        rowMap: args.rowMap,
        createRow: args.createRow,
      });

      if (!rowDoc) return;

      runDatabaseRowAction(
        rowDoc,
        { type: 'relation.clear-cell', fieldId: args.fieldId, fieldType: FieldType.Relation },
        () => {
          const row = getRowFromDoc(rowDoc);
          const cells = row?.get(YjsDatabaseKey.cells);

          if (shouldSkipBulkRewrite(cells?.get(args.fieldId))) return;
          cells?.delete(args.fieldId);
          if (row) touchRowAttribution(row, args.actorUid);
        }
      );
    })
  );
}

async function backfillReciprocalLinks(args: {
  sourceDatabase: YDatabase;
  sourceDatabaseDoc: YDoc;
  sourceFieldId: FieldId;
  reciprocalDatabaseDoc: YDoc;
  reciprocalFieldId: FieldId;
  rowMap?: Record<RowId, YDoc> | null;
  createRow?: (rowKey: string) => Promise<YDoc>;
  actorUid?: AttributionUid;
}) {
  const sourceRowIds = collectDatabaseRowIds(args.sourceDatabase, Object.keys(args.rowMap ?? {}));

  await Promise.all(
    sourceRowIds.map(async (sourceRowId) => {
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

      await Promise.all(
        relatedRowIds.map(async (relatedRowId) => {
          const relatedRowDoc = await loadRowDoc({
            databaseDoc: args.reciprocalDatabaseDoc,
            rowId: relatedRowId,
            createRow: args.createRow,
            rowMap: args.reciprocalDatabaseDoc === args.sourceDatabaseDoc ? args.rowMap : undefined,
          });

          if (!relatedRowDoc) return;

          applyRelationCellChanges(
            relatedRowDoc,
            args.reciprocalFieldId,
            { insertedRowIds: [sourceRowId] },
            RelationLimit.NoLimit,
            args.actorUid
          );
        })
      );
    })
  );
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
  actorUid?: AttributionUid;
  /**
   * The related database doc, when the caller already resolved it. Resolving it again means a
   * second `loadView` round-trip — and a second wait on {@link waitForDatabaseHydration} for a
   * database that is still syncing.
   */
  relatedDoc?: YDoc | null;
}) {
  if (args.insertedRowIds.length === 0) return;

  const field = args.database.get(YjsDatabaseKey.fields)?.get(args.sourceFieldId);

  if (!field) return;

  const typeOption = parseRelationTypeOption(field);

  if (!typeOption.is_two_way || !typeOption.database_id || !typeOption.reciprocal_field_id) {
    return;
  }

  const relatedDoc =
    args.relatedDoc ??
    (await loadRelatedDatabaseDoc({
      sourceDatabase: args.database,
      sourceDatabaseDoc: args.databaseDoc,
      relatedDatabaseId: typeOption.database_id,
      loadView: args.loadView,
      getViewIdFromDatabaseId: args.getViewIdFromDatabaseId,
      bindViewSync: args.bindViewSync,
    }));

  if (!relatedDoc) return;

  const relatedDatabase = getDatabaseFromDoc(relatedDoc);
  const reciprocalFieldId = typeOption.reciprocal_field_id;
  const reciprocalField = relatedDatabase?.get(YjsDatabaseKey.fields)?.get(reciprocalFieldId);
  const reciprocalLimit = reciprocalField
    ? parseRelationTypeOption(reciprocalField).source_limit
    : RelationLimit.NoLimit;

  await Promise.all(
    args.insertedRowIds.map(async (targetRowId) => {
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
        reciprocalLimit,
        args.actorUid
      );

      if (reciprocalLimit !== RelationLimit.OneOnly) return;

      await Promise.all(
        reciprocalChanges.removedRowIds.map(async (removedSourceRowId) => {
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
            typeOption.source_limit,
            args.actorUid
          );
        })
      );
    })
  );
}

/**
 * Row-agnostic relation cell writer: `(rowId, fieldId, changes)`. Keeps the
 * reciprocal side of a two-way relation in step, like `useUpdateRelationCell`.
 */
export function useUpdateRelationCellDispatch() {
  const context = useDatabaseContext();
  const database = useDatabase();
  const rowMap = useRowMap();
  const { createRow, getViewIdFromDatabaseId, loadView, bindViewSync } = context;
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

  return useCallback(
    async (rowId: RowId, fieldId: FieldId, changes: RelationCellChanges) => {
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

      // The template editor edits a hidden source row that never joins
      // row_orders; reciprocal links would point real rows at that phantom
      // row id. The default is applied to real rows created from the
      // template, whose reciprocals are backfilled by useNewRowDispatch.
      if (
        !typeOption.is_two_way ||
        !typeOption.database_id ||
        !typeOption.reciprocal_field_id ||
        context.templateEditingRowId === rowId
      ) {
        applyRelationCellChanges(sourceRowDoc, fieldId, changes, typeOption.source_limit, actorUid);
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

      // Hydrate every participant before writing. Rebuild the plan after each
      // await so remote edits during hydration cannot leave a stale plan.
      // This also includes links displaced by a reciprocal OneOnly limit.
      const loaded = new Map<string, YDoc | null>([[getRowKey(context.databaseDoc.guid, rowId), sourceRowDoc]]);

      for (;;) {
        const loading = new Map<string, Promise<void>>();
        const plan = new Map<YDoc, Map<FieldId, RowId[]>>();
        let unavailable = false;
        const getRow = (databaseDoc: YDoc, id: RowId) => {
          const key = getRowKey(databaseDoc.guid, id);

          if (loaded.has(key)) {
            const doc = loaded.get(key);

            if (!doc) unavailable = true;
            return doc;
          }

          if (!loading.has(key)) {
            loading.set(
              key,
              loadRowDoc({
                databaseDoc,
                rowId: id,
                createRow,
                rowMap: databaseDoc === context.databaseDoc ? rowMap : undefined,
              }).then((doc) => {
                loaded.set(key, doc);
              })
            );
          }

          return null;
        };

        const stage = (doc: YDoc, id: FieldId, update: RelationCellChanges, limit: RelationLimit) => {
          const fields = plan.get(doc) ?? new Map<FieldId, RowId[]>();
          const existing =
            fields.get(id) ?? getRelationRowIdsFromCell(getRowFromDoc(doc)?.get(YjsDatabaseKey.cells)?.get(id));
          const result = applyRelationCellChangeset(existing, update, limit);

          fields.set(id, result.nextRowIds);
          plan.set(doc, fields);
          return result.effectiveChanges;
        };

        const effective = stage(sourceRowDoc, fieldId, changes, typeOption.source_limit);
        const inserted = new Set(effective.insertedRowIds);

        for (const targetId of uniq([...effective.removedRowIds, ...effective.insertedRowIds])) {
          const target = getRow(relatedDoc, targetId);

          if (!target) continue;
          const reciprocal = stage(
            target,
            typeOption.reciprocal_field_id,
            inserted.has(targetId) ? { insertedRowIds: [rowId] } : { removedRowIds: [rowId] },
            reciprocalLimit
          );

          if (!inserted.has(targetId) || reciprocalLimit !== RelationLimit.OneOnly) continue;

          for (const displacedId of reciprocal.removedRowIds) {
            if (displacedId === rowId) continue;
            const displaced = getRow(context.databaseDoc, displacedId);

            if (displaced) stage(displaced, fieldId, { removedRowIds: [targetId] }, typeOption.source_limit);
          }
        }

        if (loading.size > 0) {
          await Promise.all(loading.values());
          continue;
        }

        if (unavailable) return;

        for (const [doc, fields] of plan) {
          for (const [id, ids] of fields) {
            if (
              checkExistingCellWrite(getRowFromDoc(doc)?.get(YjsDatabaseKey.cells)?.get(id), {
                set: { [YjsDatabaseKey.data]: ids },
                delete: [YjsDatabaseKey.source_field_type],
              }) === 'refuse'
            ) {
              notifyRichTextNewer();
              return;
            }
          }
        }

        // No await between the final checks and the writes to either side.
        for (const [doc, fields] of plan) {
          for (const [id, ids] of fields) setRelationCellRowIds(doc, id, ids, actorUid);
        }

        return;
      }
    },
    [actorUid, bindViewSync, context, createRow, database, getViewIdFromDatabaseId, loadView, rowMap]
  );
}

export function useUpdateRelationCell(rowId: RowId, fieldId: FieldId) {
  const update = useUpdateRelationCellDispatch();

  return useCallback((changes: RelationCellChanges) => update(rowId, fieldId, changes), [fieldId, rowId, update]);
}

export function useUpdateRelationTypeOption(fieldId: FieldId) {
  const context = useDatabaseContext();
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowMap();
  const { createRow, getViewIdFromDatabaseId, loadView, bindViewSync } = context;
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

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
      const databaseIdChanged = updates.database_id !== undefined && updates.database_id !== oldOption.database_id;
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
          oldRelatedDoc &&
            runDatabaseAction(oldRelatedDoc, { type: 'relation.delete-reciprocal-field', policy: 'skip' }, () =>
              deleteFieldFromDatabase(oldRelatedDatabase, oldOption.reciprocal_field_id as FieldId)
            );
        }
      }

      if (databaseIdChanged) {
        await clearRelationCells({
          database,
          databaseDoc: context.databaseDoc,
          fieldId,
          rowMap,
          createRow,
          actorUid,
        });
        nextOption = {
          ...nextOption,
          reciprocal_field_id: undefined,
          reciprocal_field_name: nextOption.is_two_way ? nextOption.reciprocal_field_name : undefined,
        };
      }

      const shouldCreateReciprocal = nextOption.is_two_way && nextOption.database_id && !nextOption.reciprocal_field_id;

      // The back-pointer sync after `executeOperations` needs the same related doc the create
      // path resolves; keep it so that block does not pay a second loadView round-trip (and a
      // second hydration wait) within one call.
      let createdRelatedDoc: YDoc | null = null;

      if (shouldCreateReciprocal) {
        const relatedDoc = await loadRelatedDatabaseDoc({
          sourceDatabase: database,
          sourceDatabaseDoc: context.databaseDoc,
          relatedDatabaseId: nextOption.database_id,
          loadView,
          getViewIdFromDatabaseId,
          bindViewSync,
        });

        createdRelatedDoc = relatedDoc;
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

          runDatabaseAction(relatedDoc, { type: 'relation.create-reciprocal-field', policy: 'skip' }, () => {
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
            actorUid,
          });
        } else {
          // Couldn't load the related database to create a reciprocal field.
          // Fall back to a one-way relation so we don't persist `is_two_way: true`
          // without a reciprocal_field_id, which would silently break cell mirroring.
          // The toggle flipping itself back off is the only signal the user gets, so leave a
          // trace: this is the path where "two-way is on but the related database has no
          // matching property" comes from.
          Log.warn('[relation] two-way relation disabled: related database could not be loaded', {
            fieldId,
            relatedDatabaseId: nextOption.database_id,
          });
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
            if (databaseIdChanged) migrateRollupsForRelation(database, fieldId);
          },
        ],
        'updateRelationTypeOption',
        {
          type: 'relation.update-type-option',
          fieldId,
          fieldType: FieldType.Relation,
          policy: 'skip',
        }
      );

      if (nextOption.is_two_way && nextOption.reciprocal_field_id && nextOption.database_id) {
        // `createdRelatedDoc` was loaded for this same `database_id`; it is only null when the
        // reciprocal field already existed (e.g. a limit tweak on an established two-way
        // relation), where the load still has to happen here.
        const relatedDoc =
          createdRelatedDoc ??
          (await loadRelatedDatabaseDoc({
            sourceDatabase: database,
            sourceDatabaseDoc: context.databaseDoc,
            relatedDatabaseId: nextOption.database_id,
            loadView,
            getViewIdFromDatabaseId,
            bindViewSync,
          }));
        const relatedDatabase = relatedDoc ? getDatabaseFromDoc(relatedDoc) : null;
        const reciprocalField = relatedDatabase?.get(YjsDatabaseKey.fields)?.get(nextOption.reciprocal_field_id);

        if (relatedDoc && reciprocalField) {
          const reciprocalOption = parseRelationTypeOption(reciprocalField);

          runDatabaseAction(relatedDoc, { type: 'relation.update-reciprocal-field', policy: 'skip' }, () => {
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
    [
      actorUid,
      bindViewSync,
      context,
      createRow,
      database,
      fieldId,
      getViewIdFromDatabaseId,
      loadView,
      rowMap,
      sharedRoot,
    ]
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
  actorUid?: AttributionUid;
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

  runDatabaseRowAction(
    rowDoc,
    { type: 'relation.create-related-row-primary-cell', fieldId: args.primaryFieldId },
    () => {
      initialDatabaseRow(rowId, databaseId, rowDoc, args.actorUid);
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
    }
  );

  // Add the new row to every view's row_orders so it shows up in any open
  // grid/board/calendar of the target database.
  runDatabaseAction(args.relatedDatabaseDoc, { type: 'relation.create-related-row-order', policy: 'skip' }, () => {
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
