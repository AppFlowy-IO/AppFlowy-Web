import dayjs, { Dayjs } from 'dayjs';
import { TFunction } from 'i18next';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useDatabaseContext,
  useDatabaseFields,
  useDatabaseView,
  useRowMap,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { DEFAULT_CHART_LAYOUT_SETTINGS } from '@/application/database-yjs/chart-layout-setting';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  isDateGroupableFieldType,
  isGroupableFieldType,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { parseSelectOptionTypeOptions, SelectOption } from '@/application/database-yjs/fields';
import { parseDesktopCheckboxValue } from '@/application/database-yjs/fields/text/utils';
import {
  RowId,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { getCheckboxChartColor, getSelectOptionChartColor, getSelectOptionChartTextColor } from './chartColors';
import { ChartRowsWatch, createChartRowsStore } from './chartRowsStore';

const SECONDS_PER_DAY = 24 * 60 * 60;
const RELATIVE_MONTH_PREFIX = 'month_';

/** Dart `String.compareTo`: UTF-16 code unit order, not `localeCompare`. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Fill `{}` placeholders in order (desktop's positional `tr(args: [...])`). */
function formatPositional(template: string, values: string[]): string {
  return values.reduce((text, value) => text.replace('{}', () => value), template);
}

/** Local midnight of a `yyyy-MM-dd` bucket key (Dart `DateTime.tryParse`). */
function parseBucketDate(key: string): Dayjs | null {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(key);

  if (!match) return null;
  const date = new Date(0);

  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  const parsed = dayjs(date);

  return parsed.isValid() ? parsed : null;
}

function relativeBucketKey(date: Dayjs, now: Dayjs): string {
  // Calendar-day difference. Desktop takes `Duration.inDays` between two local
  // midnights, which is off by one across a DST change; dayjs is not.
  const diff = date.startOf('day').diff(now.startOf('day'), 'day');

  if (diff === 0) return 'today';
  if (diff === -1) return 'yesterday';
  if (diff === 1) return 'tomorrow';
  if (diff >= -7 && diff < -1) return 'last_7_days';
  if (diff > 1 && diff <= 7) return 'next_7_days';
  if (diff >= -30 && diff < -7) return 'last_30_days';
  if (diff > 7 && diff <= 30) return 'next_30_days';
  // Further away: bucket by month.
  return `${RELATIVE_MONTH_PREFIX}${date.format('YYYY-MM')}`;
}

/**
 * Desktop's `ChartUtils.dateToBucketKey`: a key that sorts chronologically —
 * Day `2026-03-15`, Week `2026-03-09` (its Monday), Month `2026-03`, Year
 * `2026`, Relative `today` / `last_7_days` / … / `month_2026-03`.
 */
export function dateToBucketKey(date: Dayjs, condition: DateGroupCondition, now: Dayjs = dayjs()): string {
  switch (condition) {
    case DateGroupCondition.Day:
      return date.format('YYYY-MM-DD');
    case DateGroupCondition.Week:
      // Monday of the week (dayjs: Sunday = 0).
      return date.subtract((date.day() + 6) % 7, 'day').format('YYYY-MM-DD');
    case DateGroupCondition.Month:
      return date.format('YYYY-MM');
    case DateGroupCondition.Year:
      return date.format('YYYY');
    case DateGroupCondition.Relative:
      return relativeBucketKey(date, now);
    default:
      return date.format('YYYY-MM');
  }
}

function relativeKeyToLabel(key: string, t: TFunction): string {
  switch (key) {
    case 'today':
      return t('board.dateCondition.today');
    case 'yesterday':
      return t('board.dateCondition.yesterday');
    case 'tomorrow':
      return t('board.dateCondition.tomorrow');
    case 'last_7_days':
      return t('board.dateCondition.lastSevenDays');
    case 'next_7_days':
      return t('board.dateCondition.nextSevenDays');
    case 'last_30_days':
      return t('board.dateCondition.lastThirtyDays');
    case 'next_30_days':
      return t('board.dateCondition.nextThirtyDays');
    default: {
      if (key.startsWith(RELATIVE_MONTH_PREFIX)) {
        const date = parseBucketDate(`${key.substring(RELATIVE_MONTH_PREFIX.length)}-01`);

        if (date) return date.format('MMM YYYY');
      }

      return key;
    }
  }
}

/**
 * Desktop's `ChartUtils.bucketKeyToLabel`: Day `March 15, 2026`, Week
 * `Week of Mar 09 - 15 2026`, Month `Mar 2026`, Year `2026`, Relative the
 * board's relative names (months as `Mar 2026`).
 */
export function bucketKeyToLabel(key: string, condition: DateGroupCondition, t: TFunction): string {
  switch (condition) {
    case DateGroupCondition.Day: {
      const date = parseBucketDate(key);

      return date ? date.format('MMMM D, YYYY') : key;
    }

    case DateGroupCondition.Week: {
      const monday = parseBucketDate(key);

      if (!monday) return key;
      const sunday = monday.add(6, 'day');
      const beginFormat = monday.year() !== sunday.year() ? 'MMM DD YYYY' : 'MMM DD';
      const endFormat = monday.month() !== sunday.month() ? 'MMM DD YYYY' : 'DD YYYY';

      return formatPositional(t('board.dateCondition.weekOf'), [monday.format(beginFormat), sunday.format(endFormat)]);
    }

    case DateGroupCondition.Month: {
      const date = parseBucketDate(`${key}-01`);

      return date ? date.format('MMM YYYY') : key;
    }

    case DateGroupCondition.Year:
      return key;
    case DateGroupCondition.Relative:
      return relativeKeyToLabel(key, t);
    default:
      return key;
  }
}

/** Desktop's `ChartUtils.relativeBucketSortOrder`: past ranges first, months after every range. */
export function relativeBucketSortOrder(key: string): number {
  switch (key) {
    case 'last_30_days':
      return 0;
    case 'last_7_days':
      return 1;
    case 'yesterday':
      return 2;
    case 'today':
      return 3;
    case 'tomorrow':
      return 4;
    case 'next_7_days':
      return 5;
    case 'next_30_days':
      return 6;
    default:
      return key.startsWith(RELATIVE_MONTH_PREFIX) ? 7 : 8;
  }
}

/** Desktop's date bucket comparator: chronological keys, Relative by range then month. */
export function compareDateBucketKeys(a: string, b: string, condition: DateGroupCondition): number {
  if (condition === DateGroupCondition.Relative) {
    const order = relativeBucketSortOrder(a) - relativeBucketSortOrder(b);

    if (order !== 0) return order;
    const stripMonth = (key: string) =>
      key.startsWith(RELATIVE_MONTH_PREFIX) ? key.substring(RELATIVE_MONTH_PREFIX.length) : key;

    return compareCodeUnits(stripMonth(a), stripMonth(b));
  }

  return compareCodeUnits(a, b);
}

/**
 * Desktop's `aggregateValuesForTest`: Count is the bucket's row count; the
 * others fold the Y values collected for the bucket, and 0 when it has none.
 */
export function aggregateChartValues(
  aggregationType: ChartAggregationType,
  rowCount: number,
  values: readonly number[]
): number {
  const sum = () => values.reduce((acc, value) => acc + value, 0);

  switch (aggregationType) {
    case ChartAggregationType.Count:
      return rowCount;
    case ChartAggregationType.CountValues:
      return new Set(values).size;
    case ChartAggregationType.Sum:
      return sum();
    case ChartAggregationType.Average:
      return values.length === 0 ? 0 : sum() / values.length;
    // `reduce` instead of `Math.min(...values)`: spreading ~100k arguments
    // throws a RangeError on V8.
    case ChartAggregationType.Min:
      return values.length === 0 ? 0 : values.reduce((min, value) => (value < min ? value : min));
    case ChartAggregationType.Max:
      return values.length === 0 ? 0 : values.reduce((max, value) => (value > max ? value : max));
    case ChartAggregationType.Median: {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);

      return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    default:
      return rowCount;
  }
}

/** A hydrated row's data map and cells, read once per row per compute. */
interface RowData {
  row: YDatabaseRow;
  cells: YDatabaseCells | undefined;
}

function readRowData(rowDoc: YDoc | undefined): RowData | null {
  const row = rowDoc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

  return row ? { row, cells: row.get(YjsDatabaseKey.cells) } : null;
}

/** A cell's data in its field's current type (lazy desktop conversion included). */
function readCellData(rowData: RowData | null, field: YDatabaseField): unknown {
  const cell = rowData?.cells?.get(field.get(YjsDatabaseKey.id));

  return cell ? parseYDatabaseCellToCell(cell, field).data : undefined;
}

/** Collab's checkbox parse: `1` / `true` / `yes` in any case is checked. */
function isCheckedCellData(data: unknown): boolean {
  return (
    (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') &&
    parseDesktopCheckboxValue(data)
  );
}

/**
 * Whole seconds, the way collab reads date cells (`data.parse::<i64>()`).
 * 13-digit values are millisecond timestamps from older web builds.
 */
function parseTimestampSeconds(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  const text = String(value);

  if (!/^[+-]?\d+$/.test(text)) return null;
  const seconds = Number(text);

  return Math.abs(seconds) >= 1e12 ? Math.trunc(seconds / 1000) : seconds;
}

/**
 * Timestamp of a date-typed field in seconds. Created / last-edited time live
 * on the row itself (newly created rows have no cell for them), the way
 * desktop synthesizes their cells from `row.created_at` / `row.modified_at`.
 */
function readTimestamp(rowData: RowData | null, field: YDatabaseField, fieldType: FieldType): number | null {
  // YDatabaseRow overloads `.get` per key, so each lookup names its key.
  if (fieldType === FieldType.CreatedTime) return parseTimestampSeconds(rowData?.row.get(YjsDatabaseKey.created_at));
  if (fieldType === FieldType.LastEditedTime) {
    return parseTimestampSeconds(rowData?.row.get(YjsDatabaseKey.last_modified));
  }

  return parseTimestampSeconds(readCellData(rowData, field));
}

/**
 * Desktop's `yValueFromCellForTest`: Number → its value, Checkbox → 1 / 0
 * (empty counts as 0), date types → seconds / 86400; anything else has no
 * value.
 */
function readYValue(rowData: RowData | null, field: YDatabaseField, fieldType: FieldType): number | null {
  switch (fieldType) {
    case FieldType.Number: {
      const data = readCellData(rowData, field);

      if (data === null || data === undefined || data === '') return null;
      const value = typeof data === 'number' ? data : parseFloat(String(data));

      return Number.isFinite(value) ? value : null;
    }

    case FieldType.Checkbox:
      return isCheckedCellData(readCellData(rowData, field)) ? 1 : 0;
    case FieldType.DateTime:
    case FieldType.LastEditedTime:
    case FieldType.CreatedTime: {
      const seconds = readTimestamp(rowData, field, fieldType);

      return seconds === null ? null : seconds / SECONDS_PER_DAY;
    }

    default:
      return null;
  }
}

/**
 * Options a select cell resolves to, like desktop's `make_selected_options`:
 * known ids in cell order (unknown ids dropped), a SingleSelect keeps one.
 */
function readSelectedOptions(
  data: unknown,
  optionsById: ReadonlyMap<string, SelectOption>,
  single: boolean
): SelectOption[] {
  if (typeof data !== 'string' || data === '') return [];
  const selected: SelectOption[] = [];

  for (const id of data.split(',')) {
    const option = optionsById.get(id);

    if (!option) continue;
    selected.push(option);
    if (single) break;
  }

  return selected;
}

interface Bucket {
  label: string;
  rowIds: RowId[];
  yValues: number[];
  isEmptyCategory: boolean;
  /** Option tag / checkbox color; palette buckets leave it to the widget. */
  color?: string;
  textColor?: string;
  /** Date bucket key, the chronological sort key. */
  sortKey?: string;
}

export interface ComputeChartDataInput {
  settings: ChartLayoutSettings | null;
  rowOrders: ReadonlyArray<{ id: string }> | null | undefined;
  rowMetas: Record<RowId, YDoc> | null | undefined;
  xAxisField: YDatabaseField | null;
  fieldType: FieldType | null;
  fields: YDatabaseFields | undefined;
  selectOptions: readonly SelectOption[];
  t: TFunction;
  /** Reference time for Relative date buckets. */
  now?: Dayjs;
}

/**
 * Pure transform: rows + chart settings → ChartDataItem[], ported from
 * desktop's `ChartBloc._computeChartData`. Side-effect free so the consumer
 * can keep it inside a `useMemo`.
 *
 * - Select / checkbox buckets are keyed by their label, like desktop: options
 *   sharing a name share a bucket (first option color wins).
 * - Select fields always carry a "No {field}" bucket, even with no rows;
 *   checkbox rows are always Checked / Unchecked; date fields get the bucket
 *   only when some rows have no date. `omitEmptyValues` drops it.
 * - Labels sort by UTF-16 code units, date buckets chronologically, and the
 *   empty bucket goes last.
 */
export function computeChartData({
  settings,
  rowOrders,
  rowMetas,
  xAxisField,
  fieldType,
  fields,
  selectOptions,
  t,
  now = dayjs(),
}: ComputeChartDataInput): ChartDataItem[] {
  if (!rowOrders || !rowMetas || !xAxisField || fieldType === null || !isGroupableFieldType(fieldType)) {
    return [];
  }

  const { aggregationType, yFieldId, omitEmptyValues, dateCondition } = settings ?? DEFAULT_CHART_LAYOUT_SETTINGS;
  const isSelectField = fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect;
  const isDateField = isDateGroupableFieldType(fieldType);
  const emptyBucket: Bucket = {
    label: t('chart.noFieldValue', {
      name: String(xAxisField.get(YjsDatabaseKey.name) ?? ''),
      // Plain text label; i18next would otherwise HTML-escape the field name.
      interpolation: { escapeValue: false },
    }),
    rowIds: [],
    yValues: [],
    isEmptyCategory: true,
  };
  const checkedLabel = t('chart.checked');
  const uncheckedLabel = t('chart.unchecked');

  // Count ignores the Y axis; a missing Y field leaves every other aggregation at 0.
  const yField = aggregationType !== ChartAggregationType.Count && yFieldId ? fields?.get(yFieldId) : undefined;
  const yFieldType = yField ? (Number(yField.get(YjsDatabaseKey.type)) as FieldType) : null;

  const optionsById = new Map<string, SelectOption>();

  selectOptions.forEach((option) => {
    if (option.id && !optionsById.has(option.id)) optionsById.set(option.id, option);
  });

  const buckets = new Map<string, Bucket>();
  const bucketFor = (key: string, create: () => Bucket) => {
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = create();
      buckets.set(key, bucket);
    }

    return bucket;
  };

  for (const { id: rowId } of rowOrders) {
    const rowData = readRowData(rowMetas[rowId]);
    const yValue = yField && yFieldType !== null ? readYValue(rowData, yField, yFieldType) : null;
    const add = (bucket: Bucket, collectY = true) => {
      bucket.rowIds.push(rowId);
      if (collectY && yValue !== null) bucket.yValues.push(yValue);
    };

    if (isSelectField) {
      const options = readSelectedOptions(
        readCellData(rowData, xAxisField),
        optionsById,
        fieldType === FieldType.SingleSelect
      );

      if (options.length === 0) {
        // Desktop quirk: a MultiSelect row without options is counted in the
        // empty bucket but its Y value is not aggregated there.
        add(emptyBucket, fieldType === FieldType.SingleSelect);
        continue;
      }

      options.forEach((option) => {
        const label = option.name || option.id;

        add(
          bucketFor(label, () => ({
            label,
            rowIds: [],
            yValues: [],
            isEmptyCategory: false,
            color: getSelectOptionChartColor(option.color),
            textColor: getSelectOptionChartTextColor(option.color),
          }))
        );
      });
      continue;
    }

    if (fieldType === FieldType.Checkbox) {
      // A missing or unparsable checkbox cell is Unchecked: no empty bucket.
      const checked = isCheckedCellData(readCellData(rowData, xAxisField));
      const label = checked ? checkedLabel : uncheckedLabel;

      add(
        bucketFor(label, () => ({
          label,
          rowIds: [],
          yValues: [],
          isEmptyCategory: false,
          color: getCheckboxChartColor(checked),
        }))
      );
      continue;
    }

    const seconds = readTimestamp(rowData, xAxisField, fieldType);
    const date = seconds === null ? null : dayjs(seconds * 1000);

    if (!date || !date.isValid()) {
      add(emptyBucket);
      continue;
    }

    const key = dateToBucketKey(date, dateCondition, now);

    add(
      bucketFor(key, () => ({
        label: bucketKeyToLabel(key, dateCondition, t),
        rowIds: [],
        yValues: [],
        isEmptyCategory: false,
        sortKey: key,
      }))
    );
  }

  const sorted = [...buckets.values()].sort((a, b) =>
    isDateField
      ? compareDateBucketKeys(a.sortKey ?? '', b.sortKey ?? '', dateCondition)
      : compareCodeUnits(a.label, b.label)
  );

  // The empty bucket always sorts last on desktop.
  if (!omitEmptyValues && (isSelectField || emptyBucket.rowIds.length > 0)) {
    sorted.push(emptyBucket);
  }

  return sorted.map((bucket) => {
    const item: ChartDataItem = {
      label: bucket.label,
      value: aggregateChartValues(aggregationType, bucket.rowIds.length, bucket.yValues),
      rowIds: bucket.rowIds,
      isEmptyCategory: bucket.isEmptyCategory,
    };

    if (bucket.color !== undefined) item.color = bucket.color;
    if (bucket.textColor !== undefined) item.textColor = bucket.textColor;
    return item;
  });
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
  /** Fields that can be used for grouping, in the view's field order. */
  groupableFields: GroupableField[];
  /** Whether there are any groupable fields in the database */
  hasGroupableFields: boolean;
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
 * Hook for computing chart data from database rows. The transform is pure and
 * lives in `useMemo`, so React re-derives only when its inputs actually
 * change — no `useState` / `useEffect` / `setTimeout` round-trip.
 */
export function useChartData({ settings }: UseChartDataOptions): UseChartDataReturn {
  const { t } = useTranslation();
  const fields = useDatabaseFields();
  const fieldOrders = useDatabaseView()?.get(YjsDatabaseKey.field_orders);
  const rowOrders = useRowOrdersSelector();
  const rowMetas = useRowMap();
  const { ensureRow, dataSource } = useDatabaseContext();
  const isHistory = dataSource?.type === 'history';

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

  // Same for the view's field order, which decides the default X-axis field.
  const [fieldOrdersClock, setFieldOrdersClock] = useState(0);

  useEffect(() => {
    if (!fieldOrders) return;
    const onChange = () => setFieldOrdersClock((c) => c + 1);

    fieldOrders.observe(onChange);
    return () => fieldOrders.unobserve(onChange);
  }, [fieldOrders]);

  // Stable string representation of the row order. Yjs often returns a fresh
  // array reference even when the contents are unchanged, so we depend on the
  // joined ids in effects instead of the array identity.
  const rowIdsKey = useMemo(() => rowOrders?.map((r) => r.id).join(',') ?? '', [rowOrders]);

  const loadedRowIdsRef = useRef<Set<string>>(new Set());
  // Rows whose doc has been ensured, published once per load batch. The chart
  // is computed over these only, so rows that arrive later (a collaborator's
  // new row, a filter revealing one) join it once their doc is in, instead of
  // being bucketed as empty in the meantime.
  const [loadedRowIds, setLoadedRowIds] = useState<ReadonlySet<string>>(() => new Set());
  // Always start in the loading state. The effect below flips this once:
  // after the first rows are ensured (populated grid) or after a short grace
  // period in which no rows arrived (empty grid; without it an empty
  // `rowOrders` at mount would flash "No data" before Yjs syncs the rows).
  // It never flips back: later batches load behind the chart on screen, the
  // way desktop keeps its chart until a reload emits, instead of a spinner.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Boolean view of whether `rowOrders` has been observed at all. Needed
  // because `rowIdsKey` is `''` for both `undefined` and `[]`, so the
  // `undefined → []` transition wouldn't re-trigger the effect on its own.
  const rowOrdersReady = !!rowOrders;

  // Lazily request row docs that haven't been loaded yet.
  useEffect(() => {
    if (isHistory) {
      if (rowOrders) setHasLoadedOnce(true);
      return;
    }

    if (!rowOrders || !ensureRow) {
      // Inputs not yet available — keep the loading indicator up.
      return;
    }

    if (rowOrders.length === 0) {
      // Defer the "no data" determination. Yjs often delivers an empty
      // `rowOrders` first and then populates it from the server; if rows
      // arrive within the grace window this effect re-runs (rowIdsKey
      // changes) and the timer is cancelled.
      const timer = setTimeout(() => setHasLoadedOnce(true), EMPTY_ROW_ORDERS_GRACE_MS);

      return () => clearTimeout(timer);
    }

    // Ensured ids only accumulate, so a size check tells whether the
    // published set is behind (a cancelled batch may have ensured some rows).
    const publishLoadedRows = () => {
      setLoadedRowIds((prev) =>
        prev.size === loadedRowIdsRef.current.size ? prev : new Set(loadedRowIdsRef.current)
      );
      setHasLoadedOnce(true);
    };

    const rowsToLoad = rowOrders.filter((row) => !loadedRowIdsRef.current.has(row.id));

    if (rowsToLoad.length === 0) {
      publishLoadedRows();
      return;
    }

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

      if (!cancelled) publishLoadedRows();
    };

    void loadAll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowOrdersReady, rowIdsKey, ensureRow, isHistory]);

  // Groupable fields in the view's field order, like desktop's
  // `fieldController.fieldInfos`; fields missing from the order go last.
  const groupableFields = useMemo<GroupableField[]>(() => {
    if (!fields) return [];
    const orderedIds = new Set<string>();

    fieldOrders?.toArray().forEach(({ id }) => {
      if (fields.has(id)) orderedIds.add(id);
    });
    fields.forEach((_field, fieldId) => orderedIds.add(fieldId));

    const result: GroupableField[] = [];

    orderedIds.forEach((fieldId) => {
      const field = fields.get(fieldId);
      const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

      if (field && isGroupableFieldType(fieldType)) {
        result.push({
          id: fieldId,
          name: String(field.get(YjsDatabaseKey.name) || ''),
          type: fieldType,
        });
      }
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, fieldsClock, fieldOrders, fieldOrdersClock]);

  const hasGroupableFields = groupableFields.length > 0;

  // Resolve x-axis field: settings.xFieldId if valid, otherwise first groupable
  // (desktop's `_resolveXAxisField`).
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

  // Row documents are separate Yjs documents, so none of the inputs above
  // changes when a cell is edited in place (from the drill-down's row peek, by
  // a collaborator, or by a sync filling a doc that opened empty). Observe the
  // loaded row docs for the data the axes read and bump a clock, coalesced
  // per frame, like desktop reloading the chart on `rowsUpdated`.
  const chartRowsStore = useMemo(() => createChartRowsStore(), []);
  const { aggregationType, yFieldId } = settings ?? DEFAULT_CHART_LAYOUT_SETTINGS;
  const yField = aggregationType !== ChartAggregationType.Count && yFieldId ? fields?.get(yFieldId) : undefined;
  const yFieldType = yField ? (Number(yField.get(YjsDatabaseKey.type)) as FieldType) : null;
  const rowsWatch = useMemo<ChartRowsWatch>(() => {
    const fieldIds = new Set<string>();
    const rowKeys = new Set<string>();

    if (resolvedXFieldId) fieldIds.add(resolvedXFieldId);
    if (yField && yFieldId) fieldIds.add(yFieldId);
    // Created / last-edited time live on the row, not in a cell.
    for (const type of [fieldType, yFieldType]) {
      if (type === FieldType.CreatedTime) rowKeys.add(YjsDatabaseKey.created_at);
      if (type === FieldType.LastEditedTime) rowKeys.add(YjsDatabaseKey.last_modified);
    }

    return { fieldIds, rowKeys };
  }, [resolvedXFieldId, fieldType, yField, yFieldId, yFieldType]);

  useEffect(() => {
    chartRowsStore.setWatch(rowsWatch);
  }, [chartRowsStore, rowsWatch]);

  useEffect(() => {
    // A historical snapshot cannot change, and registering its rows would
    // retain them outside the bounded history store.
    if (!isHistory) chartRowsStore.replaceRows(rowMetas ?? {});
  }, [chartRowsStore, rowMetas, isHistory]);

  useEffect(() => () => chartRowsStore.detachRows(), [chartRowsStore]);

  const rowsClock = useSyncExternalStore(
    chartRowsStore.subscribe,
    chartRowsStore.getSnapshot,
    chartRowsStore.getSnapshot
  );

  // === Render-time derivation ===
  const isLoading = !hasLoadedOnce;

  // The rows the chart draws: those with an ensured doc. A historical
  // snapshot holds every row already.
  const loadedRowOrders = useMemo(
    () => (isHistory ? rowOrders : rowOrders?.filter(({ id }) => loadedRowIds.has(id))),
    [rowOrders, loadedRowIds, isHistory]
  );

  // Pure derivation. The clocks stand in for the Yjs maps and row docs the
  // compute reads in place, whose identities never change on an edit.
  // Downstream chart widgets are wrapped in `React.memo(..., chartDataEqual)`,
  // so a recompute that leaves the bars unchanged does not re-render them.
  const chartData = useMemo<ChartDataItem[]>(() => {
    void fieldsClock;
    void rowsClock;

    if (!hasLoadedOnce) return EMPTY_CHART_DATA;

    return computeChartData({
      settings,
      rowOrders: loadedRowOrders,
      rowMetas,
      xAxisField,
      fieldType,
      fields,
      selectOptions,
      t,
    });
  }, [
    hasLoadedOnce,
    settings,
    loadedRowOrders,
    rowMetas,
    xAxisField,
    fieldType,
    fields,
    fieldsClock,
    rowsClock,
    selectOptions,
    t,
  ]);

  return {
    chartData,
    isLoading,
    xAxisField,
    selectOptions,
    fieldType,
    groupableFields,
    hasGroupableFields,
  };
}

export default useChartData;
