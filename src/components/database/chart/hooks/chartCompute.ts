import dayjs, { Dayjs } from 'dayjs';

import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import {
  ChartAggregationType,
  ChartDataItem,
  EMPTY_CATEGORY_KEY,
  isDateGroupableFieldType,
} from '@/application/database-yjs/chart.type';
import { getCell } from '@/application/database-yjs/const';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionColor } from '@/application/database-yjs/fields';
import { safeParseTimestamp } from '@/application/database-yjs/fields/date/utils';
import { RowId, YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  bucketDate,
  ChartLabels,
  CHECKBOX_CHECKED_KEY,
  CHECKBOX_UNCHECKED_KEY,
  GroupValue,
} from './chartGrouping';

/**
 * The pure half of the chart pipeline: rows and settings in, `ChartDataItem[]`
 * out. Nothing here touches React, so `useChartData` keeps it in `useMemo`.
 */

/** The row docs a chart reads, by row id. A row without an entry has no doc yet and is left out. */
export type ChartRowDocs = Record<RowId, YDoc>;

type ChartRowOrders = ReadonlyArray<{ id: string }>;

interface GroupedData {
  label: string;
  /** Stable key (option id, checkbox key or date bucket); unset for the empty category. */
  groupKey?: string;
  rowIds: RowId[];
  isEmptyCategory: boolean;
  /** Code-unit sortable key for chronological ordering of date buckets */
  sortKey?: string;
}

interface GroupingContext {
  dateCondition: DateGroupCondition;
  labels: ChartLabels;
  /** Captured once per computation, so every row buckets against the same day. */
  now: Dayjs;
}

/** The cells and row fields a chart reads; edits anywhere else never recompute it. */
export interface ChartWatchedRowData {
  fieldIds: ReadonlySet<string>;
  /** CreatedTime / LastEditedTime groups read the row's own timestamps. */
  rowTimes: boolean;
}

/**
 * Whether a row-doc change (observed from the row's data section) can change
 * what the chart reads: a watched cell, the cells map or row itself being
 * replaced, or (when grouping by created / edited time) the row timestamps.
 */
export function touchesChartedRowData(
  event: { path: Array<string | number>; changes: { keys: ReadonlyMap<string, unknown> } },
  watched: ChartWatchedRowData
): boolean {
  const { path } = event;

  // Map events only down to the cells map; a cell's own content is deeper.
  if (path.length === 0) return event.changes.keys.has(YjsEditorKey.database_row);
  if (path[0] !== YjsEditorKey.database_row) return false;
  if (path.length === 1) {
    const { keys } = event.changes;

    return (
      keys.has(YjsDatabaseKey.cells) ||
      (watched.rowTimes && (keys.has(YjsDatabaseKey.created_at) || keys.has(YjsDatabaseKey.last_modified)))
    );
  }

  if (path[1] !== YjsDatabaseKey.cells) return false;
  if (path.length === 2) return [...event.changes.keys.keys()].some((fieldId) => watched.fieldIds.has(fieldId));
  return watched.fieldIds.has(String(path[2]));
}

/**
 * Get cell value for grouping (x-axis field)
 */
function getCellGroupValue(
  rowId: string,
  field: YDatabaseField,
  rowDocs: ChartRowDocs,
  { dateCondition, labels, now }: GroupingContext
): GroupValue[] {
  const fieldId = field.get(YjsDatabaseKey.id);
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
  const rowDoc = rowDocs[rowId];
  const dataSection = rowDoc?.getMap(YjsEditorKey.data_section);
  const databaseRow = dataSection?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
  const cells = databaseRow?.get(YjsDatabaseKey.cells);
  const cell = cells?.get(fieldId);
  const data = cell ? parseYDatabaseCellToCell(cell, field).data : undefined;

  switch (fieldType) {
    case FieldType.SingleSelect: {
      if (typeof data === 'string' && data.length > 0) {
        return [{ label: data, groupKey: data }];
      }

      return [];
    }

    case FieldType.MultiSelect: {
      if (typeof data === 'string' && data.length > 0) {
        return data
          .split(',')
          .filter(Boolean)
          .map((id) => ({ label: id, groupKey: id }));
      }

      return [];
    }

    case FieldType.Checkbox: {
      if (data === 'Yes' || data === true) {
        return [{ label: labels.checked, groupKey: CHECKBOX_CHECKED_KEY }];
      }

      return [{ label: labels.unchecked, groupKey: CHECKBOX_UNCHECKED_KEY }];
    }

    case FieldType.DateTime:
    case FieldType.LastEditedTime:
    case FieldType.CreatedTime: {
      // For DateTime, the timestamp lives in the cell's `data`. For
      // CreatedTime / LastEditedTime there's no per-field cell — newly
      // created rows have no entry in `cells` at all. The timestamp is
      // stored on the row itself, the same way `useRowTimeString` reads it.
      let raw: string | undefined;

      if (fieldType === FieldType.DateTime) {
        if (typeof data === 'string' && data.length > 0) raw = data;
      } else {
        // YDatabaseRow has overloaded `.get` per key, so the lookup must use
        // a literal `YjsDatabaseKey` member rather than a computed variable.
        const v =
          fieldType === FieldType.CreatedTime
            ? databaseRow?.get(YjsDatabaseKey.created_at)
            : databaseRow?.get(YjsDatabaseKey.last_modified);

        raw = v !== undefined && v !== null ? String(v) : undefined;
      }

      if (!raw) return [];

      const date = safeParseTimestamp(raw);

      if (!date.isValid()) return [];

      return [bucketDate(date, dateCondition, labels, now)];
    }

    default:
      return [];
  }
}

/**
 * Get numeric value for aggregation (y-axis field). Mirrors desktop's
 * `_yValueFromCell` in chart_bloc.dart: Number is parsed directly, Checkbox
 * yields 0/1, and date-typed fields yield "days since epoch" so Min/Max/Avg
 * make sense on a human scale.
 */
function getCellNumericValue(rowId: string, field: YDatabaseField, rowDocs: ChartRowDocs): number | null {
  const fieldId = field.get(YjsDatabaseKey.id);
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
  const cell = getCell(rowId, fieldId, rowDocs);
  const data = cell ? parseYDatabaseCellToCell(cell, field).data : undefined;

  switch (fieldType) {
    case FieldType.Checkbox: {
      if (data === null || data === undefined || data === '') return 0;
      return data === 'Yes' || data === true ? 1 : 0;
    }

    case FieldType.DateTime:
    case FieldType.LastEditedTime:
    case FieldType.CreatedTime: {
      if (data === null || data === undefined || data === '') return null;
      const parsed = safeParseTimestamp(String(data));

      if (!parsed.isValid()) return null;

      // Seconds → days since epoch (matches desktop's `timestamp / 86400`).
      return parsed.unix() / (24 * 60 * 60);
    }

    case FieldType.Number:
    default: {
      if (data === null || data === undefined || data === '') return null;
      const num = typeof data === 'number' ? data : parseFloat(String(data));

      return isNaN(num) || !isFinite(num) ? null : num;
    }
  }
}

/**
 * Compute aggregation on an array of values
 */
export function computeAggregation(values: number[], aggregationType: ChartAggregationType): number {
  if (values.length === 0) {
    return 0;
  }

  switch (aggregationType) {
    case ChartAggregationType.Count:
      return values.length;
    case ChartAggregationType.Sum:
      return values.reduce((acc, val) => acc + val, 0);
    case ChartAggregationType.Average:
      return values.reduce((acc, val) => acc + val, 0) / values.length;
    case ChartAggregationType.Min: {
      // Single-pass loop avoids `Math.min(...values)` spread-arg overflow on
      // large arrays (RangeError around ~100k elements on V8).
      let min = values[0];

      for (let i = 1; i < values.length; i++) if (values[i] < min) min = values[i];
      return min;
    }

    case ChartAggregationType.Max: {
      let max = values[0];

      for (let i = 1; i < values.length; i++) if (values[i] > max) max = values[i];
      return max;
    }

    case ChartAggregationType.Median: {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);

      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    case ChartAggregationType.CountValues:
      return new Set(values).size;
    default:
      return values.length;
  }
}

/** The aggregate of `rowIds` over the Y field; rows with an empty cell are left out. */
function aggregateRows(
  rowIds: readonly RowId[],
  yField: YDatabaseField,
  rowDocs: ChartRowDocs,
  aggregation: ChartAggregationType
): number {
  const numericValues = rowIds
    .map((rowId) => getCellNumericValue(rowId, yField, rowDocs))
    .filter((value): value is number => value !== null);

  return computeAggregation(numericValues, aggregation);
}

export interface ComputeNumberChartDataInput {
  /**
   * The effective aggregation (`resolveEffectiveAggregation`): Count unless a
   * value aggregation has its Y field.
   */
  aggregation: ChartAggregationType;
  rowOrders: ChartRowOrders | null | undefined;
  /** Only read when the value aggregates the Y field (not for a row count). */
  rowDocs: ChartRowDocs | null | undefined;
  yField: YDatabaseField | null;
}

/**
 * Pure transform for the Number (KPI) chart: a single aggregated value over
 * every row that survived the view's filters (and any dashboard global
 * filters, which `useRowOrdersSelector` already applied). There is no x-axis
 * grouping. A Count is the row count.
 *
 * Returns an empty array while row orders (or, when the Y field is
 * aggregated, row docs) are unavailable, otherwise exactly one item whose
 * `rowIds` holds every counted row (for drill-down).
 */
export function computeNumberChartData({
  aggregation,
  rowOrders,
  rowDocs,
  yField,
}: ComputeNumberChartDataInput): ChartDataItem[] {
  if (!rowOrders) {
    return [];
  }

  let rowIds = rowOrders.map((row) => row.id);
  let value: number;

  if (aggregation === ChartAggregationType.Count || !yField) {
    value = rowIds.length;
  } else {
    if (!rowDocs) return [];
    // A row whose doc has not arrived yet counts once it does.
    rowIds = rowIds.filter((rowId) => rowDocs[rowId]);
    value = aggregateRows(rowIds, yField, rowDocs, aggregation);
  }

  return [
    {
      label: yField ? String(yField.get(YjsDatabaseKey.name) || '') : '',
      value,
      rowIds,
    },
  ];
}

export interface ComputeChartDataInput {
  /** The effective aggregation (`resolveEffectiveAggregation`). */
  aggregation: ChartAggregationType;
  /** The Y field a value aggregation reads; a Count ignores it. */
  yField: YDatabaseField | null;
  showEmptyValues: boolean;
  cumulative: boolean;
  dateCondition: DateGroupCondition;
  rowOrders: ChartRowOrders | null | undefined;
  rowDocs: ChartRowDocs | null | undefined;
  xAxisField: YDatabaseField | null;
  fieldType: FieldType | null;
  optionIdToName: ReadonlyMap<string, string>;
  optionIdToColor: ReadonlyMap<string, SelectOptionColor>;
  labels: ChartLabels;
}

/**
 * Pure transform: row orders + row docs + the grouping settings →
 * `ChartDataItem[]`. Style settings (WP10) are not an input, so a style
 * change never regroups the rows.
 */
export function computeChartData({
  aggregation,
  yField,
  showEmptyValues,
  cumulative,
  dateCondition,
  rowOrders,
  rowDocs,
  xAxisField,
  fieldType,
  optionIdToName,
  optionIdToColor,
  labels,
}: ComputeChartDataInput): ChartDataItem[] {
  if (!rowOrders || !rowDocs || !xAxisField || fieldType === null) {
    return [];
  }

  const isDateBucketed = isDateGroupableFieldType(fieldType);
  const groups = new Map<string, GroupedData>();
  const emptyGroup: GroupedData = {
    label: labels.noFieldValue(String(xAxisField.get(YjsDatabaseKey.name) || '')),
    rowIds: [],
    isEmptyCategory: true,
  };
  const context: GroupingContext = { dateCondition, labels, now: dayjs() };

  rowOrders.forEach((row) => {
    const rowId = row.id;

    // A row whose doc has not arrived yet counts once it does.
    if (!rowDocs[rowId]) return;
    const groupValues = getCellGroupValue(rowId, xAxisField, rowDocs, context);

    if (groupValues.length === 0) {
      emptyGroup.rowIds.push(rowId);
    } else {
      groupValues.forEach((gv) => {
        let label = gv.label;

        if (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect) {
          label = optionIdToName.get(gv.groupKey) || gv.label;
        }

        const key = gv.groupKey;

        if (!groups.has(key)) {
          groups.set(key, {
            label,
            groupKey: key,
            rowIds: [],
            isEmptyCategory: false,
            sortKey: gv.sortKey,
          });
        }

        groups.get(key)?.rowIds.push(rowId);
      });
    }
  });

  if (showEmptyValues && emptyGroup.rowIds.length > 0) {
    groups.set(`__empty__${emptyGroup.label}`, emptyGroup);
  }

  const data: ChartDataItem[] = [];
  const isSelect = fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect;

  groups.forEach((group) => {
    const value =
      aggregation === ChartAggregationType.Count || !yField
        ? group.rowIds.length
        : aggregateRows(group.rowIds, yField, rowDocs, aggregation);

    // Colors are assigned at render time from this metadata (`chart-colors.ts`).
    const item: ChartDataItem = {
      label: group.label,
      value,
      rowIds: group.rowIds,
      key: group.isEmptyCategory ? EMPTY_CATEGORY_KEY : group.groupKey,
      isEmptyCategory: group.isEmptyCategory,
    };
    const optionColor = isSelect && group.groupKey ? optionIdToColor.get(group.groupKey) : undefined;

    if (optionColor) item.optionColor = optionColor;
    if (group.groupKey === CHECKBOX_CHECKED_KEY) item.checkboxState = 'checked';
    if (group.groupKey === CHECKBOX_UNCHECKED_KEY) item.checkboxState = 'unchecked';
    data.push(item);
  });

  // Pre-build a label → sortKey map so the comparator below is O(1) per
  // call instead of scanning `groups.values()` every comparison.
  const sortKeyByLabel = isDateBucketed ? new Map<string, string>() : null;

  if (sortKeyByLabel) {
    groups.forEach((g) => {
      if (!sortKeyByLabel.has(g.label)) sortKeyByLabel.set(g.label, g.sortKey ?? g.label);
    });
  }

  data.sort((a, b) => {
    if (a.isEmptyCategory) return 1;
    if (b.isEmptyCategory) return -1;
    if (sortKeyByLabel) {
      const ak = sortKeyByLabel.get(a.label) ?? a.label;
      const bk = sortKeyByLabel.get(b.label) ?? b.label;

      // Code-unit order, like desktop's `compareTo`, so the key prefixes hold.
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    }

    return a.label.localeCompare(b.label);
  });

  if (cumulative) {
    let runningTotal = 0;

    for (const item of data) {
      if (item.isEmptyCategory) continue;
      runningTotal += item.value;
      item.value = runningTotal;
    }
  }

  return data;
}

/**
 * Order fields by the view's `field_orders`; fields the view does not list
 * keep their relative order after the listed ones.
 */
export function sortByFieldOrder<T extends { id: string }>(
  items: T[],
  fieldOrders: { toArray: () => { id?: unknown }[] } | undefined
): T[] {
  if (!fieldOrders || items.length < 2) return items;
  const position = new Map<string, number>();

  fieldOrders.toArray().forEach((order, index) => {
    if (typeof order?.id === 'string' && !position.has(order.id)) position.set(order.id, index);
  });

  return items
    .map((item, index) => ({ item, index, rank: position.get(item.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}
