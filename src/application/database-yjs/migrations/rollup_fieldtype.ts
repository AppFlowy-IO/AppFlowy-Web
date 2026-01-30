import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  RowId,
  YDatabase,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseFields,
  YDatabaseMetas,
  YDatabaseRow,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

export const ROLLUP_SCHEMA_VERSION = 2;

type RowLoader = (rowKey: string) => Promise<YDoc>;

const ROLLUP_OPTION_KEYS = new Set([
  'relation_field_id',
  'target_field_id',
  'calculation_type',
  'show_as',
  'condition_value',
]);

function ensureMetas(database: YDatabase): YDatabaseMetas {
  let metas = database.get(YjsDatabaseKey.metas) as YDatabaseMetas | undefined;

  if (!metas) {
    metas = new Y.Map() as YDatabaseMetas;
    database.set(YjsDatabaseKey.metas, metas);
  }

  return metas;
}

function collectRowIds(database: YDatabase): RowId[] {
  const rowIdSet = new Set<RowId>();
  const views = database.get(YjsDatabaseKey.views) as YDatabaseViews | undefined;

  if (!views) return [];

  views.forEach((view) => {
    const rowOrders = view.get(YjsDatabaseKey.row_orders);

    if (!rowOrders) return;
    const orders = rowOrders.toJSON() as { id: RowId }[];

    orders.forEach((row) => {
      if (row?.id) rowIdSet.add(row.id);
    });
  });

  return Array.from(rowIdSet);
}

function isLegacyTimeField(fieldType: number, field: Y.Map<unknown>): boolean {
  if (fieldType !== FieldType.Rollup) return false;

  const typeOptionMap = field.get(YjsDatabaseKey.type_option) as Y.Map<unknown> | undefined;
  const typeOption = typeOptionMap?.get(String(fieldType)) as Y.Map<unknown> | undefined;
  const hasRollupKeys =
    typeOption && Array.from(typeOption.keys()).some((key) => ROLLUP_OPTION_KEYS.has(key));

  return !hasRollupKeys;
}

function migrateFieldType(
  field: Y.Map<unknown>,
  fieldTypeById: Map<string, number>
): void {
  const fieldId = field.get(YjsDatabaseKey.id) as string;
  const fieldType = Number(field.get(YjsDatabaseKey.type));

  if (!fieldId) return;

  if (!isLegacyTimeField(fieldType, field)) {
    fieldTypeById.set(fieldId, fieldType);
    return;
  }

  const typeOptionMap = field.get(YjsDatabaseKey.type_option) as Y.Map<unknown> | undefined;
  const legacyOption = typeOptionMap?.get(String(fieldType)) as Y.Map<unknown> | undefined;

  if (typeOptionMap && legacyOption) {
    typeOptionMap.set(String(FieldType.Time), legacyOption);
    typeOptionMap.delete(String(fieldType));
  }

  field.set(YjsDatabaseKey.type, FieldType.Time);
  fieldTypeById.set(fieldId, FieldType.Time);
}

async function migrateRowCells(
  rowDoc: YDoc,
  fieldTypeById: Map<string, number>
): Promise<void> {
  const rowRoot = rowDoc.getMap(YjsEditorKey.data_section);
  const row = rowRoot?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

  if (!row) return;

  const cells = row.get(YjsDatabaseKey.cells) as YDatabaseCells | undefined;

  if (!cells) return;

  rowDoc.transact(() => {
    cells.forEach((cell, fieldId) => {
      const cellMap = cell as YDatabaseCell;
      const expectedType = fieldTypeById.get(fieldId);

      if (!expectedType) return;

      const currentType = Number(cellMap.get(YjsDatabaseKey.field_type));

      if (currentType === FieldType.Rollup && expectedType === FieldType.Time) {
        cellMap.set(YjsDatabaseKey.field_type, FieldType.Time);
      }

      const sourceType = Number(cellMap.get(YjsDatabaseKey.source_field_type));

      if (sourceType === FieldType.Rollup && expectedType === FieldType.Time) {
        cellMap.set(YjsDatabaseKey.source_field_type, FieldType.Time);
      }
    });
  });
}

export async function migrateDatabaseFieldTypes(
  doc: YDoc,
  options?: {
    loadRow?: RowLoader;
    rowIds?: RowId[];
    commitVersion?: boolean;
  }
): Promise<boolean> {
  const root = doc.getMap(YjsEditorKey.data_section);
  const database = root?.get(YjsEditorKey.database) as YDatabase | undefined;

  if (!database) return false;

  const metas = ensureMetas(database);
  const currentVersion = Number(metas.get(YjsDatabaseKey.schema_version) ?? 0);

  if (currentVersion >= ROLLUP_SCHEMA_VERSION) return false;

  const fields = database.get(YjsDatabaseKey.fields) as YDatabaseFields | undefined;

  if (!fields) return false;

  const fieldTypeById = new Map<string, number>();

  doc.transact(() => {
    fields.forEach((field) => {
      migrateFieldType(field as Y.Map<unknown>, fieldTypeById);
    });
  });

  const rowIds = options?.rowIds ?? collectRowIds(database);
  const loadRow = options?.loadRow;

  if (loadRow && rowIds.length > 0) {
    for (const rowId of rowIds) {
      const rowKey = getRowKey(doc.guid, rowId);
      const rowDoc = await loadRow(rowKey);

      await migrateRowCells(rowDoc, fieldTypeById);
    }
  }

  if (options?.commitVersion ?? true) {
    metas.set(YjsDatabaseKey.schema_version, ROLLUP_SCHEMA_VERSION);
  }

  return true;
}
