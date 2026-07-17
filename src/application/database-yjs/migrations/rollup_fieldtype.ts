import * as Y from 'yjs';

import { normalizeLegacyCellFieldType } from '@/application/database-yjs/cell.field-type';
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

const ROLLUP_SCHEMA_VERSION = 2;

export const DATABASE_SCHEMA_VERSION = 3;

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
  const hasRollupKeys = typeOption && Array.from(typeOption.keys()).some((key) => ROLLUP_OPTION_KEYS.has(key));

  return !hasRollupKeys;
}

function migrateFieldType(field: Y.Map<unknown>, fieldTypeById: Map<string, number>): void {
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
  fieldTypeById: Map<string, number>,
  migrateRollupFieldType: boolean,
  migrateLegacyCellType: boolean
): Promise<boolean> {
  const rowRoot = rowDoc.getMap(YjsEditorKey.data_section);
  const row = rowRoot?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

  if (!row) return false;

  const cells = row.get(YjsDatabaseKey.cells) as YDatabaseCells | undefined;

  if (!cells) return true;

  rowDoc.transact(() => {
    cells.forEach((cell, fieldId) => {
      const cellMap = cell as YDatabaseCell;

      if (migrateRollupFieldType) {
        const expectedType = fieldTypeById.get(fieldId);

        if (expectedType !== undefined) {
          const currentType = Number(cellMap.get(YjsDatabaseKey.field_type));

          if (currentType === FieldType.Rollup && expectedType === FieldType.Time) {
            cellMap.set(YjsDatabaseKey.field_type, FieldType.Time);
          }

          const sourceType = Number(cellMap.get(YjsDatabaseKey.source_field_type));

          if (sourceType === FieldType.Rollup && expectedType === FieldType.Time) {
            cellMap.set(YjsDatabaseKey.source_field_type, FieldType.Time);
          }
        }
      }

      if (migrateLegacyCellType) {
        normalizeLegacyCellFieldType(cellMap);
      }
    });
  });

  return true;
}

export async function migrateDatabaseFieldTypes(
  doc: YDoc,
  options?: {
    loadRow?: RowLoader;
    rowIds?: RowId[];
    commitVersion?: boolean;
    databaseId?: string;
  }
): Promise<boolean> {
  const root = doc.getMap(YjsEditorKey.data_section);
  const database = root?.get(YjsEditorKey.database) as YDatabase | undefined;

  if (!database) return false;

  const metas = ensureMetas(database);
  const currentVersion = Number(metas.get(YjsDatabaseKey.schema_version) ?? 0);

  const normalizeRequestedRows = Boolean(options?.rowIds?.length && options.loadRow);

  if (currentVersion >= DATABASE_SCHEMA_VERSION && !normalizeRequestedRows) return false;

  const fields = database.get(YjsDatabaseKey.fields) as YDatabaseFields | undefined;

  if (!fields) return false;

  const fieldTypeById = new Map<string, number>();
  const migrateRollupFieldType = currentVersion < ROLLUP_SCHEMA_VERSION;
  const migrateLegacyCellType = currentVersion < DATABASE_SCHEMA_VERSION || normalizeRequestedRows;

  if (migrateRollupFieldType) {
    doc.transact(() => {
      fields.forEach((field) => {
        migrateFieldType(field as Y.Map<unknown>, fieldTypeById);
      });
    });
  }

  const rowIds = options?.rowIds ?? collectRowIds(database);
  const loadRow = options?.loadRow;
  const rowKeyPrefix = options?.databaseId || doc.guid;

  let migratedEveryRow = rowIds.length === 0;

  if (loadRow && rowIds.length > 0) {
    migratedEveryRow = true;
    for (const rowId of rowIds) {
      const rowKey = getRowKey(rowKeyPrefix, rowId);
      const rowDoc = await loadRow(rowKey);

      const migrated = await migrateRowCells(rowDoc, fieldTypeById, migrateRollupFieldType, migrateLegacyCellType);

      migratedEveryRow = migratedEveryRow && migrated;
    }
  }

  // Do not mark a row migration complete when row docs were unavailable. A
  // later open with a loader must still get a chance to repair them.
  const canCommitVersion = rowIds.length === 0 || (Boolean(loadRow) && migratedEveryRow);

  if (currentVersion < DATABASE_SCHEMA_VERSION && (options?.commitVersion ?? true) && canCommitVersion) {
    metas.set(YjsDatabaseKey.schema_version, DATABASE_SCHEMA_VERSION);
  }

  return true;
}
