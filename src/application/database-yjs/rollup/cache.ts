import { DateTimeCell } from '@/application/database-yjs/cell.type';
import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { getDateCellStr, getRowTimeString } from '@/application/database-yjs/fields/date/utils';
import { EnhancedBigStats } from '@/application/database-yjs/fields/number/EnhancedBigStats';
import { parseNumberTypeOptions } from '@/application/database-yjs/fields/number/parse';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { parseRollupTypeOption } from '@/application/database-yjs/fields/rollup/parse';
import { parseCheckboxValue } from '@/application/database-yjs/fields/text/utils';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  RowId,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

export type RollupCellValue = {
  value: string;
  rawNumeric?: number;
  list?: string[];
};

type RollupCacheEntry = RollupCellValue & {
  generation: number;
  updatedAt: number;
};

type RollupComputeContext = {
  baseDoc: YDoc;
  database: YDatabase;
  rollupField: YDatabaseField;
  row: YDatabaseRow;
  rowId: RowId;
  fieldId: string;
  loadView?: (viewId: string) => Promise<YDoc | null>;
  createRowDoc?: (rowKey: string) => Promise<YDoc>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
};

const ROLLUP_CACHE_TTL_MS = 5_000;
const ROLLUP_CACHE_PRUNE_INTERVAL_MS = 2_000;
const ROLLUP_MAX_CONCURRENCY = 4;
const ROLLUP_RELATED_DOC_CACHE_MAX = 50;

class Semaphore {
  private count = 0;
  private queue: Array<(release: () => void) => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.count < this.max) {
      this.count += 1;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.queue.push((release) => resolve(release));
    });
  }

  private release() {
    this.count = Math.max(0, this.count - 1);
    const next = this.queue.shift();

    if (!next) return;
    this.count += 1;
    next(() => this.release());
  }
}

const semaphore = new Semaphore(ROLLUP_MAX_CONCURRENCY);
const cache = new Map<string, RollupCacheEntry>();
const inflight = new Map<string, Promise<RollupCellValue>>();
const generations = new Map<string, number>();
const listeners = new Map<string, Set<(value: RollupCellValue) => void>>();
const globalListeners = new Set<() => void>();
const relatedDocCache = new Map<string, Promise<YDoc | null>>();
let lastPruneAt = 0;

function getGeneration(cellId: string) {
  return generations.get(cellId) ?? 0;
}

function bumpGeneration(cellId: string) {
  const next = getGeneration(cellId) + 1;

  generations.set(cellId, next);
  cache.delete(cellId);
  inflight.delete(cellId);
  return next;
}

function isEntryFresh(entry: RollupCacheEntry, generation: number) {
  if (entry.generation !== generation) return false;
  return Date.now() - entry.updatedAt <= ROLLUP_CACHE_TTL_MS;
}

export function subscribeRollupCell(cellId: string, cb: (value: RollupCellValue) => void) {
  const set = listeners.get(cellId) ?? new Set();

  set.add(cb);
  listeners.set(cellId, set);
  return () => {
    const current = listeners.get(cellId);

    if (!current) return;
    current.delete(cb);
    if (current.size === 0) listeners.delete(cellId);
  };
}

export function subscribeRollupCache(cb: () => void) {
  globalListeners.add(cb);
  return () => {
    globalListeners.delete(cb);
  };
}

export function invalidateRollupCell(cellId: string) {
  bumpGeneration(cellId);
}

function emit(cellId: string, value: RollupCellValue) {
  const subs = listeners.get(cellId);

  if (subs) {
    subs.forEach((cb) => cb(value));
  }

  globalListeners.forEach((cb) => cb());
}

function getCachedValue(cellId: string): RollupCacheEntry | undefined {
  return cache.get(cellId);
}

function pruneCache(now = Date.now()) {
  if (now - lastPruneAt < ROLLUP_CACHE_PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  for (const [cellId, entry] of cache) {
    if (now - entry.updatedAt > ROLLUP_CACHE_TTL_MS) {
      cache.delete(cellId);
    }
  }
}

function touchRelatedDocCache(viewId: string, promise: Promise<YDoc | null>) {
  relatedDocCache.delete(viewId);
  relatedDocCache.set(viewId, promise);

  if (relatedDocCache.size > ROLLUP_RELATED_DOC_CACHE_MAX) {
    const oldestKey = relatedDocCache.keys().next().value;

    if (oldestKey) {
      relatedDocCache.delete(oldestKey);
    }
  }
}

async function loadRelatedDoc(
  viewId: string,
  loadView?: (viewId: string) => Promise<YDoc | null>
) {
  if (!loadView) return null;
  const cached = relatedDocCache.get(viewId);

  if (cached) {
    touchRelatedDocCache(viewId, cached);
    return cached;
  }

  const promise = loadView(viewId).catch(() => {
    relatedDocCache.delete(viewId);
    return null;
  });

  touchRelatedDocCache(viewId, promise);
  return promise;
}

function getRelationRowIds(cell?: YDatabaseCell): RowId[] {
  if (!cell) return [];
  const data = cell.get(YjsDatabaseKey.data);

  if (!data) return [];
  if (typeof data === 'object' && 'toJSON' in data) {
    const ids = (data as { toJSON: () => unknown }).toJSON();

    return Array.isArray(ids) ? (ids as RowId[]) : [];
  }

  return Array.isArray(data) ? (data as RowId[]) : [];
}

function isEmptyValue(value: string) {
  return value.trim() === '';
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = EnhancedBigStats.parse(value);

    if (!parsed) return null;
    const asNumber = Number(parsed);

    return Number.isNaN(asNumber) ? null : asNumber;
  }

  return null;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = typeof value === 'number' ? value : Number(value);

  if (Number.isNaN(raw)) return null;
  const abs = Math.abs(raw);

  if (abs >= 1_000_000_000_000) {
    return Math.floor(raw / 1000);
  }

  return raw;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);

  if (days >= 365) {
    const years = Math.floor(days / 365);
    const remainingDays = days % 365;

    if (remainingDays > 0) {
      return `${years} year${years > 1 ? 's' : ''}, ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
    }

    return `${years} year${years > 1 ? 's' : ''}`;
  }

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}`;
  }

  const hours = Math.floor(seconds / 3600);

  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  const minutes = Math.floor(seconds / 60);

  return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

function formatNumericResult(field: YDatabaseField, value: number): string {
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  if (fieldType === FieldType.Number) {
    const format = parseNumberTypeOptions(field).format;

    return EnhancedBigStats.formatValue(value.toFixed(2), format);
  }

  return value.toFixed(2);
}

function formatDateValue(field: YDatabaseField, timestampSeconds: number): string {
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  if (fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime) {
    return getRowTimeString(field, String(timestampSeconds)) ?? '';
  }

  const typeOptionMap = field.get(YjsDatabaseKey.type_option);
  const typeOption = typeOptionMap?.get(String(FieldType.DateTime));
  const includeTimeRaw = typeOption?.get(YjsDatabaseKey.include_time);
  const includeTime = typeof includeTimeRaw === 'boolean' ? includeTimeRaw : Boolean(includeTimeRaw);
  const dateCell: DateTimeCell = {
    createdAt: 0,
    lastModified: 0,
    fieldType: FieldType.DateTime,
    data: String(timestampSeconds),
    includeTime,
    isRange: false,
    endTimestamp: undefined,
    reminderId: undefined,
  };

  return getDateCellStr({ cell: dateCell, field });
}

async function computeRollupCellValue(context: RollupComputeContext): Promise<RollupCellValue> {
  const { rollupField, database, row } = context;
  const rollupOption = parseRollupTypeOption(rollupField);

  if (!rollupOption || !rollupOption.relation_field_id) {
    return { value: '' };
  }

  const relationField = (database.get(YjsDatabaseKey.fields) as YDatabaseFields | undefined)?.get(
    rollupOption.relation_field_id
  );

  if (!relationField || Number(relationField.get(YjsDatabaseKey.type)) !== FieldType.Relation) {
    return { value: '' };
  }

  const relationOption = parseRelationTypeOption(relationField);

  if (!relationOption?.database_id) {
    return { value: '' };
  }

  const relationCell = row?.get(YjsDatabaseKey.cells)?.get(rollupOption.relation_field_id);
  const relatedRowIds = getRelationRowIds(relationCell);

  const showAs = (rollupOption.show_as ?? RollupDisplayMode.Calculated) as RollupDisplayMode;
  const calculationType = (rollupOption.calculation_type ?? CalculationType.Count) as CalculationType;
  const totalRelated = relatedRowIds.length;
  const conditionValue = rollupOption.condition_value ?? '';

  if (totalRelated === 0) {
    if (showAs === RollupDisplayMode.OriginalList || showAs === RollupDisplayMode.UniqueList) {
      return { value: '', list: [] };
    }

    switch (calculationType) {
      case CalculationType.Count:
      case CalculationType.CountEmpty:
      case CalculationType.CountNonEmpty:
      case CalculationType.CountUnique:
      case CalculationType.CountChecked:
      case CalculationType.CountUnchecked:
        return { value: '0', rawNumeric: 0 };
      case CalculationType.CountValue:
        return conditionValue ? { value: '0', rawNumeric: 0 } : { value: '' };
      default:
        return { value: '' };
    }
  }

  if (!rollupOption.target_field_id) {
    if (showAs === RollupDisplayMode.Calculated && calculationType === CalculationType.Count) {
      return { value: String(totalRelated), rawNumeric: totalRelated };
    }

    return { value: '' };
  }

  const viewId = await context.getViewIdFromDatabaseId?.(relationOption.database_id);

  if (!viewId) return { value: '' };

  const relatedDoc = await loadRelatedDoc(viewId, context.loadView);

  if (!relatedDoc) return { value: '' };

  const relatedRoot = relatedDoc.getMap(YjsEditorKey.data_section);
  const relatedDatabase = relatedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;
  const relatedFields = relatedDatabase?.get(YjsDatabaseKey.fields);
  const targetField = relatedFields?.get(rollupOption.target_field_id);

  if (!relatedDatabase || !targetField) return { value: '' };

  const targetFieldType = Number(targetField.get(YjsDatabaseKey.type)) as FieldType;
  const values: string[] = [];
  const numericValues: number[] = [];
  const timestampValues: number[] = [];
  const checkboxValues: boolean[] = [];
  const selectValues: string[][] = [];
  const nonEmptyFlags: boolean[] = [];

  for (const relatedRowId of relatedRowIds) {
    if (!context.createRowDoc) continue;
    const rowKey = getRowKey(relatedDoc.guid, relatedRowId);
    const relatedRowDoc = await context.createRowDoc(rowKey);
    const relatedRowRoot = relatedRowDoc.getMap(YjsEditorKey.data_section);
    const relatedRow = relatedRowRoot?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

    if (!relatedRow) continue;
    const cell = relatedRow.get(YjsDatabaseKey.cells)?.get(rollupOption.target_field_id);
    const rawData = cell?.get(YjsDatabaseKey.data);

    let text = '';

    if (targetFieldType === FieldType.CreatedTime) {
      const ts = normalizeTimestamp(relatedRow.get(YjsDatabaseKey.created_at));

      if (ts !== null) {
        text = formatDateValue(targetField, ts);
        timestampValues.push(ts);
      }
    } else if (targetFieldType === FieldType.LastEditedTime) {
      const ts = normalizeTimestamp(relatedRow.get(YjsDatabaseKey.last_modified));

      if (ts !== null) {
        text = formatDateValue(targetField, ts);
        timestampValues.push(ts);
      }
    } else if (cell) {
      text = decodeCellToText(cell, targetField);
      if (targetFieldType === FieldType.DateTime) {
        const ts = normalizeTimestamp(cell.get(YjsDatabaseKey.data));

        if (ts !== null) {
          timestampValues.push(ts);
        }
      }
    }

    values.push(text);
    nonEmptyFlags.push(!isEmptyValue(text));

    if (targetFieldType === FieldType.Number) {
      const numeric = parseNumber(rawData ?? text);

      if (numeric !== null) {
        numericValues.push(numeric);
      }
    }

    if (targetFieldType === FieldType.Checkbox) {
      const checkboxInput =
        typeof rawData === 'string' || typeof rawData === 'number' || typeof rawData === 'boolean'
          ? rawData
          : text;

      checkboxValues.push(parseCheckboxValue(checkboxInput));
    }

    if (targetFieldType === FieldType.SingleSelect || targetFieldType === FieldType.MultiSelect) {
      const ids = typeof rawData === 'string' ? rawData.split(',').map((id) => id.trim()).filter(Boolean) : [];

      selectValues.push(ids);
    }
  }

  if (showAs === RollupDisplayMode.OriginalList || showAs === RollupDisplayMode.UniqueList) {
    const list: string[] = [];
    const seen = new Set<string>();

    values.forEach((value) => {
      if (isEmptyValue(value)) return;
      if (showAs === RollupDisplayMode.UniqueList) {
        if (seen.has(value)) return;
        seen.add(value);
      }

      list.push(value);
    });
    return { value: list.join(', '), list };
  }

  const emptyCount = nonEmptyFlags.filter((isNonEmpty) => !isNonEmpty).length;
  const nonEmptyCount = nonEmptyFlags.filter(Boolean).length;

  switch (calculationType) {
    case CalculationType.Count:
      return { value: String(totalRelated), rawNumeric: totalRelated };
    case CalculationType.CountEmpty:
      return { value: String(emptyCount), rawNumeric: emptyCount };
    case CalculationType.CountNonEmpty:
      return { value: String(nonEmptyCount), rawNumeric: nonEmptyCount };
    case CalculationType.Sum: {
      if (numericValues.length === 0) return { value: '' };
      const sum = numericValues.reduce((acc, v) => acc + v, 0);

      return { value: formatNumericResult(targetField, sum), rawNumeric: sum };
    }

    case CalculationType.Average: {
      if (numericValues.length === 0) return { value: '' };
      const avg = numericValues.reduce((acc, v) => acc + v, 0) / numericValues.length;

      return { value: formatNumericResult(targetField, avg), rawNumeric: avg };
    }

    case CalculationType.Min: {
      if (numericValues.length === 0) return { value: '' };
      const min = Math.min(...numericValues);

      return { value: formatNumericResult(targetField, min), rawNumeric: min };
    }

    case CalculationType.Max: {
      if (numericValues.length === 0) return { value: '' };
      const max = Math.max(...numericValues);

      return { value: formatNumericResult(targetField, max), rawNumeric: max };
    }

    case CalculationType.Median: {
      if (numericValues.length === 0) return { value: '' };
      const sorted = [...numericValues].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

      return { value: formatNumericResult(targetField, median), rawNumeric: median };
    }

    case CalculationType.NumberRange: {
      if (numericValues.length < 2) return { value: '' };
      const min = Math.min(...numericValues);
      const max = Math.max(...numericValues);
      const range = max - min;

      return { value: formatNumericResult(targetField, range), rawNumeric: range };
    }

    case CalculationType.NumberMode: {
      if (numericValues.length === 0) return { value: '' };
      const frequency = new Map<number, number>();

      numericValues.forEach((value) => {
        const key = Math.round(value * 100) / 100;

        frequency.set(key, (frequency.get(key) ?? 0) + 1);
      });
      let mode = numericValues[0];
      let maxCount = 0;

      frequency.forEach((count, key) => {
        if (count > maxCount) {
          maxCount = count;
          mode = key;
        }
      });
      return { value: formatNumericResult(targetField, mode), rawNumeric: mode };
    }

    case CalculationType.DateEarliest: {
      if (timestampValues.length === 0) return { value: '' };
      const earliest = Math.min(...timestampValues);

      return { value: formatDateValue(targetField, earliest) };
    }

    case CalculationType.DateLatest: {
      if (timestampValues.length === 0) return { value: '' };
      const latest = Math.max(...timestampValues);

      return { value: formatDateValue(targetField, latest) };
    }

    case CalculationType.DateRange: {
      if (timestampValues.length < 2) return { value: '' };
      const min = Math.min(...timestampValues);
      const max = Math.max(...timestampValues);

      return { value: formatDuration(max - min) };
    }

    case CalculationType.CountChecked: {
      if (targetFieldType !== FieldType.Checkbox) return { value: '' };
      const count = checkboxValues.filter(Boolean).length;

      return { value: String(count), rawNumeric: count };
    }

    case CalculationType.CountUnchecked: {
      if (targetFieldType !== FieldType.Checkbox) return { value: '' };
      const count = checkboxValues.filter((checked) => !checked).length;

      return { value: String(count), rawNumeric: count };
    }

    case CalculationType.PercentChecked: {
      if (targetFieldType !== FieldType.Checkbox || totalRelated === 0) return { value: '' };
      const count = checkboxValues.filter(Boolean).length;
      const percent = (count / totalRelated) * 100;

      return { value: `${percent.toFixed(1)}%`, rawNumeric: percent };
    }

    case CalculationType.PercentUnchecked: {
      if (targetFieldType !== FieldType.Checkbox || totalRelated === 0) return { value: '' };
      const count = checkboxValues.filter((checked) => !checked).length;
      const percent = (count / totalRelated) * 100;

      return { value: `${percent.toFixed(1)}%`, rawNumeric: percent };
    }

    case CalculationType.PercentEmpty: {
      if (totalRelated === 0) return { value: '' };
      const percent = (emptyCount / totalRelated) * 100;

      return { value: `${percent.toFixed(1)}%`, rawNumeric: percent };
    }

    case CalculationType.PercentNotEmpty: {
      if (totalRelated === 0) return { value: '' };
      const percent = (nonEmptyCount / totalRelated) * 100;

      return { value: `${percent.toFixed(1)}%`, rawNumeric: percent };
    }

    case CalculationType.CountUnique: {
      const uniqueValues = new Set<string>();

      if (targetFieldType === FieldType.MultiSelect) {
        selectValues.forEach((ids) => {
          if (ids.length === 0) return;
          uniqueValues.add([...ids].sort().join(','));
        });
      } else {
        values.forEach((value) => {
          if (!isEmptyValue(value)) {
            uniqueValues.add(value);
          }
        });
      }

      const count = uniqueValues.size;

      return { value: String(count), rawNumeric: count };
    }

    case CalculationType.CountValue: {
      if (
        ![FieldType.SingleSelect, FieldType.MultiSelect].includes(targetFieldType) ||
        conditionValue.trim() === ''
      ) {
        return { value: '' };
      }

      const count = selectValues.filter((ids) => ids.includes(conditionValue)).length;

      return { value: String(count), rawNumeric: count };
    }

    default:
      return { value: '' };
  }
}

export async function readRollupCell(context: RollupComputeContext): Promise<RollupCellValue> {
  pruneCache();
  const cellId = `${context.rowId}:${context.fieldId}`;
  const generation = getGeneration(cellId);
  const cached = getCachedValue(cellId);

  if (cached && isEntryFresh(cached, generation)) {
    return { value: cached.value, rawNumeric: cached.rawNumeric, list: cached.list };
  }

  let promise = inflight.get(cellId);

  if (!promise) {
    promise = (async () => {
      const release = await semaphore.acquire();

      try {
        const value = await computeRollupCellValue(context);
        const currentGen = getGeneration(cellId);

        if (currentGen === generation) {
          cache.set(cellId, {
            value: value.value,
            rawNumeric: value.rawNumeric,
            list: value.list,
            generation: currentGen,
            updatedAt: Date.now(),
          });
          emit(cellId, value);
        }

        return value;
      } finally {
        release();
        inflight.delete(cellId);
      }
    })();

    inflight.set(cellId, promise);
  }

  const value = await promise;
  const currentGen = getGeneration(cellId);
  const currentCached = getCachedValue(cellId);

  if (currentCached && isEntryFresh(currentCached, currentGen)) {
    return { value: currentCached.value, rawNumeric: currentCached.rawNumeric, list: currentCached.list };
  }

  if (currentGen !== generation) {
    return { value: '' };
  }

  return value;
}

export function readRollupCellSync(context: RollupComputeContext): RollupCellValue {
  pruneCache();
  const cellId = `${context.rowId}:${context.fieldId}`;
  const generation = getGeneration(cellId);
  const cached = getCachedValue(cellId);

  if (cached && isEntryFresh(cached, generation)) {
    return { value: cached.value, rawNumeric: cached.rawNumeric, list: cached.list };
  }

  if (!inflight.has(cellId)) {
    const promise = (async () => {
      const release = await semaphore.acquire();

      try {
        const value = await computeRollupCellValue(context);
        const currentGen = getGeneration(cellId);

        if (currentGen === generation) {
          cache.set(cellId, {
            value: value.value,
            rawNumeric: value.rawNumeric,
            list: value.list,
            generation: currentGen,
            updatedAt: Date.now(),
          });
          emit(cellId, value);
        }

        return value;
      } finally {
        release();
        inflight.delete(cellId);
      }
    })();

    inflight.set(cellId, promise);
  }

  return cached ? { value: cached.value, rawNumeric: cached.rawNumeric, list: cached.list } : { value: '' };
}
