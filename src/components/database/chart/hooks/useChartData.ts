import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  useDatabaseContext,
  useDatabaseFields,
  useDatabaseView,
  useRowMap,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import {
  CHART_COLORS,
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  ChartType,
  isDateGroupableFieldType,
  isGroupableFieldType,
} from '@/application/database-yjs/chart.type';
import { getCell } from '@/application/database-yjs/const';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import {
  NumberFormat,
  parseNumberTypeOptions,
  parseSelectOptionTypeOptions,
  SelectOption,
} from '@/application/database-yjs/fields';
import { safeParseTimestamp } from '@/application/database-yjs/fields/date/utils';
import {
  YjsDatabaseKey,
  YjsEditorKey,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  RowId,
  YDoc,
} from '@/application/types';

import { useChartColors, UseChartColorsReturn } from './useChartColors';

interface GroupedData {
  label: string;
  optionId?: string;
  rowIds: RowId[];
  isEmptyCategory: boolean;
  /** Lexicographically sortable key for chronological ordering of date buckets */
  sortKey?: string;
}

interface GroupValue {
  label: string;
  /** Used to merge buckets across rows (e.g., date bucket key like "2026-03"). */
  groupKey: string;
  /** Chronological sort hint for date buckets. */
  sortKey?: string;
}

function bucketDate(date: Dayjs, condition: DateGroupCondition): GroupValue {
  switch (condition) {
    case DateGroupCondition.Day: {
      const key = date.format('YYYY-MM-DD');

      return { label: key, groupKey: key, sortKey: key };
    }

    case DateGroupCondition.Week: {
      // Week of year (ISO-style): start on Monday
      const monday = date.day() === 0 ? date.subtract(6, 'day') : date.subtract(date.day() - 1, 'day');
      const key = monday.format('YYYY-MM-DD');

      return { label: `Week of ${key}`, groupKey: key, sortKey: key };
    }

    case DateGroupCondition.Month: {
      const key = date.format('YYYY-MM');

      return { label: date.format('MMM YYYY'), groupKey: key, sortKey: key };
    }

    case DateGroupCondition.Year: {
      const key = date.format('YYYY');

      return { label: key, groupKey: key, sortKey: key };
    }

    case DateGroupCondition.Relative:
    default: {
      const now = dayjs();
      const startOfDay = date.startOf('day');
      const today = now.startOf('day');
      const diffDays = startOfDay.diff(today, 'day');

      if (diffDays === 0) return { label: 'Today', groupKey: 'rel-0', sortKey: '01' };
      if (diffDays === -1) return { label: 'Yesterday', groupKey: 'rel--1', sortKey: '00' };
      if (diffDays === 1) return { label: 'Tomorrow', groupKey: 'rel-1', sortKey: '02' };
      if (diffDays >= -7 && diffDays < -1) return { label: 'Last 7 days', groupKey: 'rel-last7', sortKey: '00a' };
      if (diffDays > 1 && diffDays <= 7) return { label: 'Next 7 days', groupKey: 'rel-next7', sortKey: '03' };
      // Fallback: month bucket
      const key = date.format('YYYY-MM');

      return { label: date.format('MMM YYYY'), groupKey: key, sortKey: key };
    }
  }
}

/**
 * Get cell value for grouping (x-axis field)
 */
function getCellGroupValue(
  rowId: string,
  field: YDatabaseField,
  rowMetas: Record<RowId, YDoc>,
  dateCondition: DateGroupCondition
): GroupValue[] {
  const fieldId = field.get(YjsDatabaseKey.id);
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
  const rowDoc = rowMetas[rowId];
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
        return [{ label: 'Checked', groupKey: 'Checked' }];
      }

      return [{ label: 'Unchecked', groupKey: 'Unchecked' }];
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

      return [bucketDate(date, dateCondition)];
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
function getCellNumericValue(rowId: string, field: YDatabaseField, rowMetas: Record<RowId, YDoc>): number | null {
  const fieldId = field.get(YjsDatabaseKey.id);
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
  const cell = getCell(rowId, fieldId, rowMetas);
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

interface ComputeNumberChartDataInput {
  settings: ChartLayoutSettings | null;
  rowOrders: ReadonlyArray<{ id: string }> | null | undefined;
  rowMetas: Record<RowId, YDoc> | null | undefined;
  yField: YDatabaseField | null;
}

/**
 * Pure transform for the Number (KPI) chart: a single aggregated value over
 * every row that survived the view's filters (and any dashboard global
 * filters, which `useRowOrdersSelector` already applied). There is no x-axis
 * grouping. Count, or a missing / deleted Y field, falls back to the row count
 * — the same fallback the grouped charts use.
 *
 * Returns an empty array while row orders are unavailable, otherwise exactly
 * one item whose `rowIds` holds every counted row (for drill-down).
 */
export function computeNumberChartData({
  settings,
  rowOrders,
  rowMetas,
  yField,
}: ComputeNumberChartDataInput): ChartDataItem[] {
  if (!rowOrders || !rowMetas) {
    return [];
  }

  const rowIds = rowOrders.map((row) => row.id);
  const aggregationType = settings?.aggregationType ?? ChartAggregationType.Count;
  let value: number;

  if (aggregationType === ChartAggregationType.Count || !yField) {
    value = rowIds.length;
  } else {
    const numericValues = rowIds
      .map((rowId) => getCellNumericValue(rowId, yField, rowMetas))
      .filter((v): v is number => v !== null);

    value = computeAggregation(numericValues, aggregationType);
  }

  return [
    {
      label: yField ? String(yField.get(YjsDatabaseKey.name) || '') : '',
      value,
      rowIds,
      color: CHART_COLORS[0],
    },
  ];
}

interface ComputeChartDataInput {
  settings: ChartLayoutSettings | null;
  resolvedXFieldId: string | null;
  rowOrders: ReadonlyArray<{ id: string }> | null | undefined;
  rowMetas: Record<RowId, YDoc> | null | undefined;
  xAxisField: YDatabaseField | null;
  fieldType: FieldType | null;
  fields: YDatabaseFields | undefined;
  optionIdToName: Map<string, string>;
  colors: UseChartColorsReturn;
}

/**
 * Pure transform: rowOrders + rowMetas + chart settings → ChartDataItem[].
 * Side-effect free so the consumer can keep it inside a `useMemo` without
 * fighting React's data flow.
 */
function computeChartData({
  settings,
  resolvedXFieldId,
  rowOrders,
  rowMetas,
  xAxisField,
  fieldType,
  fields,
  optionIdToName,
  colors,
}: ComputeChartDataInput): ChartDataItem[] {
  if (!rowOrders || !rowMetas || !xAxisField || !resolvedXFieldId || !fieldType) {
    return [];
  }

  const {
    yFieldId,
    aggregationType,
    showEmptyValues = true,
    cumulative = false,
    dateCondition = DateGroupCondition.Month,
  } = settings ?? {
    aggregationType: ChartAggregationType.Count,
  };

  const isDateBucketed = isDateGroupableFieldType(fieldType);
  const groups = new Map<string, GroupedData>();
  const emptyGroup: GroupedData = {
    label: `No ${xAxisField.get(YjsDatabaseKey.name) || 'Value'}`,
    rowIds: [],
    isEmptyCategory: true,
  };

  rowOrders.forEach((row) => {
    const rowId = row.id;
    const groupValues = getCellGroupValue(rowId, xAxisField, rowMetas, dateCondition);

    if (groupValues.length === 0) {
      emptyGroup.rowIds.push(rowId);
    } else {
      groupValues.forEach((gv) => {
        let label = gv.label;
        let optionId: string | undefined;

        if (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect) {
          optionId = gv.groupKey;
          label = optionIdToName.get(gv.groupKey) || gv.label;
        }

        const key = gv.groupKey;

        if (!groups.has(key)) {
          groups.set(key, {
            label,
            optionId,
            rowIds: [],
            isEmptyCategory: false,
            sortKey: gv.sortKey,
          });
        }

        groups.get(key)!.rowIds.push(rowId);
      });
    }
  });

  if (showEmptyValues && emptyGroup.rowIds.length > 0) {
    groups.set(`__empty__${emptyGroup.label}`, emptyGroup);
  }

  const yField = yFieldId && fields ? fields.get(yFieldId) : undefined;

  const data: ChartDataItem[] = [];
  let colorIndex = 0;

  groups.forEach((group) => {
    let value: number;

    if (aggregationType === ChartAggregationType.Count) {
      value = group.rowIds.length;
    } else if (yFieldId) {
      const numericValues = yField
        ? group.rowIds
            .map((rowId) => getCellNumericValue(rowId, yField, rowMetas))
            .filter((v): v is number => v !== null)
        : [];

      value = computeAggregation(numericValues, aggregationType);
    } else {
      value = group.rowIds.length;
    }

    const color = group.isEmptyCategory
      ? colors.emptyColor
      : colors.getColorForCategory(group.label, group.optionId, colorIndex);

    data.push({
      label: group.label,
      value,
      rowIds: group.rowIds,
      color,
      isEmptyCategory: group.isEmptyCategory,
    });

    if (!group.isEmptyCategory) {
      colorIndex++;
    }
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

      return ak.localeCompare(bk);
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

export interface UseChartDataOptions {
  settings: ChartLayoutSettings | null;
}

export interface GroupableField {
  id: string;
  name: string;
  type: FieldType;
}

export interface UseChartDataReturn {
  chartData: ChartDataItem[];
  isLoading: boolean;
  xAxisField: YDatabaseField | null;
  selectOptions: SelectOption[];
  fieldType: FieldType | null;
  /** All fields that can be used for grouping (SingleSelect, MultiSelect, Checkbox) */
  groupableFields: GroupableField[];
  /** Whether there are any groupable fields in the database */
  hasGroupableFields: boolean;
  /** Resolved Y field (only when the aggregation needs one and it still exists) */
  yAxisField: YDatabaseField | null;
  /** Current name of the Y field, kept fresh across renames */
  yFieldName: string;
  /** Number format of the Y field when it is a Number field, otherwise null */
  yNumberFormat: NumberFormat | null;
  /** Number chart only: the aggregated value, or null for other chart types / while loading */
  numberValue: number | null;
}

const EMPTY_CHART_DATA: ChartDataItem[] = [];

/**
 * Grace period before declaring a chart "empty" when `rowOrders` is `[]` at
 * mount. Yjs typically delivers an empty array first and then populates rows
 * from the server; without this delay the chart briefly flashes "No data"
 * before the bars appear on a populated grid.
 */
const EMPTY_ROW_ORDERS_GRACE_MS = 300;

/**
 * Cap on concurrent `ensureRow` calls. An unbounded `Promise.all` over a
 * large database (5k+ rows) floods the WebSocket layer with messages, which
 * surfaces a render-loop in `react-use-websocket`'s `setLastMessage` and
 * stalls the main thread. A small worker pool keeps the pipeline saturated
 * without the burst.
 */
const ROW_LOAD_CONCURRENCY = 16;

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

/**
 * Hook for computing chart data from database rows. The transform is pure and
 * lives in `useMemo`, so React re-derives only when its inputs actually
 * change — no `useState` / `useEffect` / `setTimeout` round-trip.
 */
export function useChartData({ settings }: UseChartDataOptions): UseChartDataReturn {
  const fields = useDatabaseFields();
  const rowOrders = useRowOrdersSelector();
  const rowMetas = useRowMap();
  const { ensureRow } = useDatabaseContext();

  // Yjs mutates the `fields` Y.Map in place when fields are added, renamed,
  // or have their type changed, so its reference identity is a stale
  // dependency for downstream useMemos. Bump a clock on observed mutations
  // to invalidate them.
  const [fieldsClock, setFieldsClock] = useState(0);

  useEffect(() => {
    if (!fields) return;
    const onChange = () => setFieldsClock((c) => c + 1);

    fields.observeDeep(onChange);
    return () => fields.unobserveDeep(onChange);
  }, [fields]);

  // The default X axis follows the view's property order (desktop's
  // `select_chart_group_field`), so reordering columns can change it.
  const fieldOrders = useDatabaseView()?.get(YjsDatabaseKey.field_orders);

  useEffect(() => {
    if (!fieldOrders) return;
    const onChange = () => setFieldsClock((c) => c + 1);

    fieldOrders.observe(onChange);
    return () => fieldOrders.unobserve(onChange);
  }, [fieldOrders]);

  // Stable string representation of the row order. Yjs often returns a fresh
  // array reference even when the contents are unchanged, so we depend on the
  // joined ids in effects instead of the array identity.
  const rowIdsKey = useMemo(() => rowOrders?.map((r) => r.id).join(',') ?? '', [rowOrders]);

  const loadedRowIdsRef = useRef<Set<string>>(new Set());
  // Always start in the loading state. The effect below decides when to
  // transition to `true` — either after rows are ensured (populated grid)
  // or after a short grace period in which no rows arrived (empty grid).
  // Without the grace period an empty `rowOrders` at mount would flash
  // "No data" before Yjs syncs the actual rows.
  const [rowsLoaded, setRowsLoaded] = useState<boolean>(false);

  // Boolean view of whether `rowOrders` has been observed at all. Needed
  // because `rowIdsKey` is `''` for both `undefined` and `[]`, so the
  // `undefined → []` transition wouldn't re-trigger the effect on its own.
  const rowOrdersReady = !!rowOrders;

  // Lazily request row docs that haven't been loaded yet.
  useEffect(() => {
    if (!rowOrders || !ensureRow) {
      // Inputs not yet available — keep the loading indicator up.
      return;
    }

    if (rowOrders.length === 0) {
      // Defer the "no data" determination. Yjs often delivers an empty
      // `rowOrders` first and then populates it from the server; if rows
      // arrive within the grace window this effect re-runs (rowIdsKey
      // changes) and the timer is cancelled.
      const timer = setTimeout(() => setRowsLoaded(true), EMPTY_ROW_ORDERS_GRACE_MS);

      return () => clearTimeout(timer);
    }

    const rowsToLoad = rowOrders.filter((row) => !loadedRowIdsRef.current.has(row.id));

    if (rowsToLoad.length === 0) {
      setRowsLoaded(true);
      return;
    }

    setRowsLoaded(false);

    let cancelled = false;
    const loadAll = async () => {
      // Only mark a row as loaded *after* `ensureRow` resolves — otherwise a
      // failed load would permanently skip the row on subsequent effect fires.
      let cursor = 0;
      const worker = async () => {
        while (!cancelled) {
          const idx = cursor++;

          if (idx >= rowsToLoad.length) return;
          const row = rowsToLoad[idx];

          try {
            await ensureRow(row.id);
            loadedRowIdsRef.current.add(row.id);
          } catch (e) {
            console.error('chart: failed to load row', row.id, e);
          }
        }
      };

      const workerCount = Math.min(ROW_LOAD_CONCURRENCY, rowsToLoad.length);

      await Promise.all(Array.from({ length: workerCount }, worker));

      if (!cancelled) setRowsLoaded(true);
    };

    void loadAll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowOrdersReady, rowIdsKey, ensureRow]);

  // Find all groupable fields
  const groupableFields = useMemo<GroupableField[]>(() => {
    if (!fields) return [];
    const result: GroupableField[] = [];

    fields.forEach((field, fieldId) => {
      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (isGroupableFieldType(fieldType)) {
        result.push({
          id: fieldId,
          name: String(field.get(YjsDatabaseKey.name) || ''),
          type: fieldType,
        });
      }
    });
    // `fields` is a Y.Map whose iteration order depends on how the doc was
    // built, so rank by the view's property order instead.
    return sortByFieldOrder(result, fieldOrders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, fieldOrders, fieldsClock]);

  const hasGroupableFields = groupableFields.length > 0;

  // Resolve x-axis field: settings.xFieldId if valid, otherwise first groupable.
  const resolvedXFieldId = useMemo<string | null>(() => {
    if (!hasGroupableFields) return null;

    if (settings?.xFieldId) {
      const isValidGroupableField = groupableFields.some((f) => f.id === settings.xFieldId);

      if (isValidGroupableField) return settings.xFieldId;
    }

    return groupableFields[0].id;
  }, [settings?.xFieldId, groupableFields, hasGroupableFields]);

  const xAxisField = resolvedXFieldId && fields ? fields.get(resolvedXFieldId) ?? null : null;
  const fieldType = xAxisField ? (Number(xAxisField.get(YjsDatabaseKey.type)) as FieldType) : null;

  const selectOptions = useMemo<SelectOption[]>(() => {
    if (!xAxisField) return [];
    if (fieldType !== FieldType.SingleSelect && fieldType !== FieldType.MultiSelect) {
      return [];
    }

    return parseSelectOptionTypeOptions(xAxisField)?.options ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xAxisField, fieldType, fieldsClock]);

  const colors = useChartColors({ fieldType, selectOptions });

  const isNumberChart = settings?.chartType === ChartType.Number;
  const yFieldId = settings?.aggregationType !== ChartAggregationType.Count ? settings?.yFieldId : undefined;
  const yAxisField = yFieldId && fields ? fields.get(yFieldId) ?? null : null;

  const { yFieldName, yNumberFormat } = useMemo(() => {
    void fieldsClock;

    if (!yAxisField) return { yFieldName: '', yNumberFormat: null };

    const yType = Number(yAxisField.get(YjsDatabaseKey.type)) as FieldType;

    return {
      yFieldName: String(yAxisField.get(YjsDatabaseKey.name) || ''),
      yNumberFormat: yType === FieldType.Number ? parseNumberTypeOptions(yAxisField, yType).format : null,
    };
  }, [yAxisField, fieldsClock]);

  const optionIdToName = useMemo(() => {
    const map = new Map<string, string>();

    selectOptions.forEach((opt) => {
      map.set(opt.id, opt.name);
    });
    return map;
  }, [selectOptions]);

  // === Render-time derivation ===
  const isLoading = !rowsLoaded;

  // Pure derivation. Yjs hydrates row docs in micro-batches, so this can
  // recompute many times during a single page load — but downstream chart
  // widgets are wrapped in `React.memo(..., chartDataEqual)`, so re-renders
  // are skipped when the resulting bars are unchanged.
  const chartData = useMemo<ChartDataItem[]>(() => {
    // Yjs mutates field maps in place, so their identity cannot invalidate this
    // memo after a schema-only field-type switch.
    void fieldsClock;

    if (!rowsLoaded) return EMPTY_CHART_DATA;

    if (isNumberChart) {
      return computeNumberChartData({
        settings,
        rowOrders,
        rowMetas,
        yField: yAxisField,
      });
    }

    return computeChartData({
      settings,
      resolvedXFieldId,
      rowOrders,
      rowMetas,
      xAxisField,
      fieldType,
      fields,
      optionIdToName,
      colors,
    });
  }, [
    rowsLoaded,
    isNumberChart,
    yAxisField,
    settings,
    resolvedXFieldId,
    rowOrders,
    rowMetas,
    xAxisField,
    fieldType,
    fields,
    fieldsClock,
    optionIdToName,
    colors,
  ]);

  const numberValue = isNumberChart && chartData.length > 0 ? chartData[0].value : null;

  return {
    chartData,
    isLoading,
    xAxisField,
    selectOptions,
    fieldType,
    groupableFields,
    hasGroupableFields,
    yAxisField,
    yFieldName,
    yNumberFormat,
    numberValue,
  };
}

export default useChartData;
