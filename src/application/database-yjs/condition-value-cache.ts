import { parseYDatabaseDateTimeCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell } from '@/application/database-yjs/cell.type';
import { decodeCellForSort, decodeCellToText } from '@/application/database-yjs/decode';
import {
  FieldId,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

export type ConditionSortValue = string | number | boolean | undefined;

export type RowConditionSnapshot = {
  row: YDatabaseRow;
  cells?: YDatabaseCells;
  cellDataByField: Map<FieldId, CellCacheEntry<unknown>>;
  dateCellByField: Map<FieldId, CellCacheEntry<DateTimeCell | null>>;
  filterTextByField: Map<string, string>;
  sortValueByField: Map<string, ConditionSortValue>;
};

type CellCacheEntry<T> = {
  revision: string;
  value: T;
};

const rowConditionCache = new WeakMap<YDoc, RowConditionSnapshot | null>();
const rowConditionMissingObservers = new WeakMap<YDoc, () => void>();

export function hasRowConditionData(rowDoc: YDoc): boolean;
export function hasRowConditionData(rowDoc?: YDoc | null): rowDoc is YDoc;
export function hasRowConditionData(rowDoc?: YDoc | null) {
  return Boolean(rowDoc?.getMap(YjsEditorKey.data_section).has(YjsEditorKey.database_row));
}

function getFieldCacheKey(fieldId: FieldId, field: YDatabaseField) {
  return [
    fieldId,
    field.get(YjsDatabaseKey.type),
    field.get(YjsDatabaseKey.last_modified) ?? '',
  ].join(':');
}

function getSnapshotCell(snapshot: RowConditionSnapshot, fieldId: FieldId): YDatabaseCell | undefined {
  return snapshot.cells?.get(fieldId);
}

function serializeCellRevisionValue(value: unknown) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    const jsonValue = value as { toJSON?: () => unknown };

    if (typeof jsonValue.toJSON === 'function') {
      return JSON.stringify(jsonValue.toJSON());
    }

    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getCellRevision(cell?: YDatabaseCell) {
  if (!cell) return 'missing';

  return [
    cell.get(YjsDatabaseKey.data),
    cell.get(YjsDatabaseKey.field_type),
    cell.get(YjsDatabaseKey.source_field_type),
    cell.get(YjsDatabaseKey.end_timestamp),
    cell.get(YjsDatabaseKey.include_time),
    cell.get(YjsDatabaseKey.is_range),
    cell.get(YjsDatabaseKey.reminder_id),
    cell.get(YjsDatabaseKey.last_modified),
  ].map(serializeCellRevisionValue).join('|');
}

export function getRowConditionSnapshot(rowDoc?: YDoc | null): RowConditionSnapshot | null {
  if (!rowDoc) return null;

  if (rowConditionCache.has(rowDoc)) {
    const cached = rowConditionCache.get(rowDoc);

    if (cached) return cached;

    if (!rowDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.database_row)) {
      return null;
    }

    invalidateRowConditionCache(rowDoc);
  }

  const dataSection = rowDoc.getMap(YjsEditorKey.data_section);
  const row = dataSection.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

  if (!row) {
    const invalidateMissingSnapshot = () => invalidateRowConditionCache(rowDoc);

    dataSection.observeDeep(invalidateMissingSnapshot);
    rowConditionMissingObservers.set(rowDoc, () => dataSection.unobserveDeep(invalidateMissingSnapshot));
    rowConditionCache.set(rowDoc, null);
    return null;
  }

  const snapshot: RowConditionSnapshot = {
    row,
    cells: row.get(YjsDatabaseKey.cells),
    cellDataByField: new Map(),
    dateCellByField: new Map(),
    filterTextByField: new Map(),
    sortValueByField: new Map(),
  };

  rowConditionCache.set(rowDoc, snapshot);
  return snapshot;
}

export function invalidateRowConditionCache(rowDoc?: YDoc | null) {
  if (!rowDoc) return;
  rowConditionMissingObservers.get(rowDoc)?.();
  rowConditionMissingObservers.delete(rowDoc);
  rowConditionCache.delete(rowDoc);
}

export function getConditionCellData(snapshot: RowConditionSnapshot, fieldId: FieldId) {
  const cell = getSnapshotCell(snapshot, fieldId);
  const revision = getCellRevision(cell);
  const cached = snapshot.cellDataByField.get(fieldId);

  if (cached?.revision === revision) {
    return cached.value;
  }

  const data = cell?.get(YjsDatabaseKey.data);

  snapshot.cellDataByField.set(fieldId, { revision, value: data });
  return data;
}

export function getConditionCellText(snapshot: RowConditionSnapshot, fieldId: FieldId, field: YDatabaseField) {
  const cell = getSnapshotCell(snapshot, fieldId);
  const cacheKey = `${getFieldCacheKey(fieldId, field)}:${getCellRevision(cell)}`;

  if (snapshot.filterTextByField.has(cacheKey)) {
    return snapshot.filterTextByField.get(cacheKey) ?? '';
  }

  const text = cell ? decodeCellToText(cell, field) : '';

  snapshot.filterTextByField.set(cacheKey, text);
  return text;
}

export function getConditionSortValue(snapshot: RowConditionSnapshot, fieldId: FieldId, field: YDatabaseField) {
  const cell = getSnapshotCell(snapshot, fieldId);
  const cacheKey = `${getFieldCacheKey(fieldId, field)}:${getCellRevision(cell)}`;

  if (snapshot.sortValueByField.has(cacheKey)) {
    return snapshot.sortValueByField.get(cacheKey);
  }

  const value = cell ? decodeCellForSort(cell, field) : undefined;

  snapshot.sortValueByField.set(cacheKey, value);
  return value;
}

export function getConditionDateCell(snapshot: RowConditionSnapshot, fieldId: FieldId) {
  const cell = getSnapshotCell(snapshot, fieldId);
  const revision = getCellRevision(cell);
  const cached = snapshot.dateCellByField.get(fieldId);

  if (cached?.revision === revision) {
    return cached.value;
  }

  const value = cell ? parseYDatabaseDateTimeCellToCell(cell) : null;

  snapshot.dateCellByField.set(fieldId, { revision, value });
  return value;
}
