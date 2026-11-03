import dayjs from 'dayjs';

import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import {
  aggregateChartCells,
  canonicalNumber,
  ChartCellValue,
  ChartGroupContext,
  ChartGroupField,
  ChartGroupHint,
  ChartGroupNameLookup,
  chartGroupRefs,
  chartValueOfAggregate,
  ChartYCell,
  CHECKBOX_CHECKED_KEY,
  CHECKBOX_UNCHECKED_KEY,
  EMPTY_GROUP_KEY,
  resolveNumberBuckets,
} from '@/application/database-yjs/chart-config';
import { ChartTextGrouping } from '@/application/database-yjs/chart-extended-settings';
import { ChartAggregationType, ChartDataItem } from '@/application/database-yjs/chart.type';
import { getCell } from '@/application/database-yjs/const';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionColor } from '@/application/database-yjs/fields';
import { safeParseTimestamp } from '@/application/database-yjs/fields/date/utils';
import { getRowIdentifierGroupIds } from '@/application/database-yjs/group';
import { RowId, YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { ChartLabels } from './chartGrouping';
import { ChartRowFact, ChartSeriesCandidate } from './chartSeries';

/**
 * The pure half of the chart pipeline: rows and settings in, row facts out
 * (R-GROUPKEY of WP11 for the X axis and the Group by property, and the Y
 * cells the aggregations read). Nothing here touches React, so
 * `useChartData` keeps it in `useMemo`; `buildChartSeries` aggregates,
 * sorts, hides and colours.
 */

/** The row docs a chart reads, by row id. A row without an entry has no doc yet and is left out. */
export type ChartRowDocs = Record<RowId, YDoc>;

type ChartRowOrders = ReadonlyArray<{ id: string }>;

/** The cells and row fields a chart reads; edits anywhere else never recompute it. */
export interface ChartWatchedRowData {
  fieldIds: ReadonlySet<string>;
  /** CreatedTime / LastEditedTime / CreatedBy / LastEditedBy read the row's own attributes. */
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
      (watched.rowTimes &&
        (keys.has(YjsDatabaseKey.created_at) ||
          keys.has(YjsDatabaseKey.last_modified) ||
          keys.has(YjsDatabaseKey.created_by) ||
          keys.has(YjsDatabaseKey.last_edited_by)))
    );
  }

  if (path[1] !== YjsDatabaseKey.cells) return false;
  if (path.length === 2) return [...event.changes.keys.keys()].some((fieldId) => watched.fieldIds.has(fieldId));
  return watched.fieldIds.has(String(path[2]));
}

/** Field types whose chart value is read from the row's own attributes. */
export function readsRowAttributes(fieldType: FieldType | null | undefined): boolean {
  return (
    fieldType === FieldType.CreatedTime ||
    fieldType === FieldType.LastEditedTime ||
    fieldType === FieldType.CreatedBy ||
    fieldType === FieldType.LastEditedBy
  );
}

function databaseRowOf(rowDocs: ChartRowDocs, rowId: RowId): YDatabaseRow | undefined {
  return rowDocs[rowId]?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
}

function cellData(rowId: RowId, field: YDatabaseField, rowDocs: ChartRowDocs): unknown {
  const cell = getCell(rowId, field.get(YjsDatabaseKey.id), rowDocs);

  return cell ? parseYDatabaseCellToCell(cell, field).data : undefined;
}

/**
 * A date cell or a row timestamp in seconds. DateTime reads the cell;
 * CreatedTime / LastEditedTime have no cell (new rows have none at all) and
 * read the row itself, the way `useRowTimeString` does.
 */
function readTimestamp(rowId: RowId, field: YDatabaseField, fieldType: FieldType, rowDocs: ChartRowDocs): number | null {
  let raw: string | undefined;

  if (fieldType === FieldType.DateTime) {
    const data = cellData(rowId, field, rowDocs);

    if ((typeof data === 'string' || typeof data === 'number') && String(data).length > 0) raw = String(data);
  } else {
    const row = databaseRowOf(rowDocs, rowId);
    // YDatabaseRow has overloaded `.get` per key, so each lookup uses a literal key.
    const value =
      fieldType === FieldType.CreatedTime ? row?.get(YjsDatabaseKey.created_at) : row?.get(YjsDatabaseKey.last_modified);

    raw = value !== undefined && value !== null ? String(value) : undefined;
  }

  if (!raw) return null;
  const date = safeParseTimestamp(raw);

  return date.isValid() ? date.unix() : null;
}

function readNumber(data: unknown): number | null {
  if (data === null || data === undefined || data === '') return null;
  const number = typeof data === 'number' ? data : parseFloat(String(data));

  return Number.isFinite(number) ? number : null;
}

function readText(data: unknown): string {
  if (typeof data === 'string' || typeof data === 'number') return String(data);
  if (data && typeof (data as { toString?: unknown }).toString === 'function') {
    const text = String(data);

    return text === '[object Object]' ? '' : text;
  }

  return '';
}

function readSelectIds(data: unknown, fieldType: FieldType): string[] {
  if (typeof data !== 'string' || data.length === 0) return [];
  return fieldType === FieldType.MultiSelect ? data.split(',').filter(Boolean) : [data];
}

/**
 * Whether a checkbox cell is checked, as desktop `ChartCellParser.isChecked`
 * reads it: the server and older clients write `Yes`, `true` or `1`.
 */
function isChecked(data: unknown): boolean {
  if (data === true) return true;
  if (typeof data !== 'string' && typeof data !== 'number') return false;
  return ['true', 'yes', '1', 'checked'].includes(String(data).trim().toLowerCase());
}

/** An X-axis cell as the abstract value `chartGroupRefs` groups. */
export function readChartCellValue(
  rowId: RowId,
  field: YDatabaseField,
  fieldType: FieldType,
  rowDocs: ChartRowDocs
): ChartCellValue {
  switch (fieldType) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return { kind: 'select', ids: readSelectIds(cellData(rowId, field, rowDocs), fieldType) };
    case FieldType.Checkbox:
      return { kind: 'checkbox', checked: isChecked(cellData(rowId, field, rowDocs)) };
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime: {
      const timestamp = readTimestamp(rowId, field, fieldType, rowDocs);

      return timestamp === null ? { kind: 'empty' } : { kind: 'date', date: dayjs.unix(timestamp) };
    }

    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return { kind: 'users', ids: getRowIdentifierGroupIds(rowId, rowDocs, field) };
    case FieldType.Relation:
      return { kind: 'relation', ids: getRowIdentifierGroupIds(rowId, rowDocs, field) };
    case FieldType.RichText:
    case FieldType.URL:
      return { kind: 'text', text: readText(cellData(rowId, field, rowDocs)) };
    case FieldType.Number: {
      const value = readNumber(cellData(rowId, field, rowDocs));

      return value === null ? { kind: 'empty' } : { kind: 'number', value };
    }

    default:
      return { kind: 'empty' };
  }
}

const EMPTY_Y_CELL: ChartYCell = { empty: true, tokens: [] };

/**
 * A Y cell as the aggregations read it (WP11 §1.9): numbers, checkbox state
 * (also as 0/1 for legacy sums), timestamps in seconds (also as days since
 * the epoch for legacy sums), or the cell's tokens (ids or trimmed text).
 */
export function readChartYCell(rowId: RowId, field: YDatabaseField, fieldType: FieldType, rowDocs: ChartRowDocs): ChartYCell {
  switch (fieldType) {
    case FieldType.Number: {
      const value = readNumber(cellData(rowId, field, rowDocs));

      return value === null ? EMPTY_Y_CELL : { empty: false, tokens: [canonicalNumber(value)], number: value };
    }

    case FieldType.Checkbox: {
      const checked = isChecked(cellData(rowId, field, rowDocs));

      return { empty: !checked, tokens: [checked ? CHECKBOX_CHECKED_KEY : CHECKBOX_UNCHECKED_KEY], checked, number: checked ? 1 : 0 };
    }

    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime: {
      const timestamp = readTimestamp(rowId, field, fieldType, rowDocs);

      return timestamp === null
        ? EMPTY_Y_CELL
        : { empty: false, tokens: [String(timestamp)], timestamp, number: timestamp / (24 * 60 * 60) };
    }

    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      const ids = readSelectIds(cellData(rowId, field, rowDocs), fieldType);

      return { empty: ids.length === 0, tokens: ids };
    }

    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
    case FieldType.Relation: {
      const ids = getRowIdentifierGroupIds(rowId, rowDocs, field);

      return { empty: ids.length === 0, tokens: ids };
    }

    case FieldType.RichText:
    case FieldType.URL: {
      const text = readText(cellData(rowId, field, rowDocs)).trim();

      return text ? { empty: false, tokens: [text] } : EMPTY_Y_CELL;
    }

    default:
      return EMPTY_Y_CELL;
  }
}

function fieldTypeOf(field: YDatabaseField): FieldType {
  return Number(field.get(YjsDatabaseKey.type)) as FieldType;
}

/** The aggregate of `rowIds` over the Y field, as the chart stores it (`null` is no value). */
function aggregateRows(
  rowIds: readonly RowId[],
  yField: YDatabaseField | null,
  rowDocs: ChartRowDocs,
  aggregation: ChartAggregationType
): number | null {
  if (aggregation === ChartAggregationType.Count || !yField) return rowIds.length;
  const yType = fieldTypeOf(yField);
  const cells = rowIds.map((rowId) => readChartYCell(rowId, yField, yType, rowDocs));

  return chartValueOfAggregate(aggregation, aggregateChartCells(aggregation, cells));
}

export interface ComputeNumberChartDataInput {
  /** The effective aggregation (`effectiveChartAggregation`): Count unless a value aggregation has its Y field. */
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
 * grouping, and `hidden_groups`, the sort and cumulative do not apply.
 *
 * Returns an empty array while row orders (or, when the Y field is
 * aggregated, row docs) are unavailable and when the value is "no value"
 * (an Average over empty cells): the card then shows "No data". Otherwise
 * exactly one item whose `rowIds` holds every counted row (for drill-down).
 */
export function computeNumberChartData({
  aggregation,
  rowOrders,
  rowDocs,
  yField,
}: ComputeNumberChartDataInput): ChartDataItem[] {
  if (!rowOrders) return [];

  let rowIds = rowOrders.map((row) => row.id);
  let value: number | null;

  if (aggregation === ChartAggregationType.Count || !yField) {
    value = rowIds.length;
  } else {
    if (!rowDocs) return [];
    // A row whose doc has not arrived yet counts once it does.
    rowIds = rowIds.filter((rowId) => rowDocs[rowId]);
    value = aggregateRows(rowIds, yField, rowDocs, aggregation);
  }

  if (value === null) return [];
  return [{ label: yField ? String(yField.get(YjsDatabaseKey.name) || '') : '', value, rowIds }];
}

/** A property a chart groups rows by: the X axis, or the Group by property (WP12). */
export interface ChartGroupAxis {
  field: YDatabaseField;
  fieldType: FieldType;
  dateCondition: DateGroupCondition;
  textGrouping: ChartTextGrouping;
  /** Number property: the three bucket keys (the Group by property always uses automatic ranges). */
  buckets: { size: number | null; min: number | null; max: number | null };
  /** Select property: the options in order (labels and ranks) and their colors. */
  options: ReadonlyArray<{ id: string; name: string }>;
  optionIdToColor: ReadonlyMap<string, SelectOptionColor>;
  /** Names of people, users and related rows. */
  names?: ChartGroupNameLookup;
  /** R-FORMAT axis mode with the property's number format, for range labels. */
  formatAxis?: (value: number) => string;
}

/** A group a property's rows map to, with its default-sort hint and colour metadata. */
export interface ChartFactGroup extends ChartSeriesCandidate {
  hint: ChartGroupHint;
}

export interface ComputeChartFactsInput {
  /** The effective aggregation (`effectiveChartAggregation`). */
  aggregation: ChartAggregationType;
  /** The Y field a value aggregation reads; a Count ignores it. */
  yField: YDatabaseField | null;
  rowOrders: ChartRowOrders | null | undefined;
  rowDocs: ChartRowDocs | null | undefined;
  labels: ChartLabels;
  /** The Intl locale of the date labels (`useAppLocale`); the group keys and their order never depend on it. */
  locale: string;
  x: ChartGroupAxis | null;
  /** The effective Group by property, or `null`. */
  sub: ChartGroupAxis | null;
}

/** What the series builder reads from the rows: one fact per row and the groups of both properties. */
export interface ChartFacts {
  rows: ChartRowFact[];
  /** The X groups in the order the rows first show them (`sortChartGroups` orders them). */
  xGroups: ChartFactGroup[];
  /** The Group by groups, or `null` without a Group by. */
  subGroups: ChartFactGroup[] | null;
}

export const EMPTY_CHART_FACTS: ChartFacts = Object.freeze({ rows: [], xGroups: [], subGroups: null }) as ChartFacts;

/** Reads every row's groups for one property: the values first, so a Number property can place its ranges. */
function groupRowsBy(
  rows: ChartRowOrders,
  rowDocs: ChartRowDocs,
  axis: ChartGroupAxis,
  labels: ChartLabels,
  locale: string,
  now: dayjs.Dayjs
): { keys: string[][]; groups: ChartFactGroup[] } {
  const values = rows.map((row) => readChartCellValue(row.id, axis.field, axis.fieldType, rowDocs));
  const buckets =
    axis.fieldType === FieldType.Number
      ? resolveNumberBuckets(
          values.flatMap((value) => (value.kind === 'number' ? [value.value] : [])),
          axis.buckets
        )
      : null;
  const field: ChartGroupField = {
    type: axis.fieldType,
    name: String(axis.field.get(YjsDatabaseKey.name) || ''),
    options: axis.options,
  };
  const context: ChartGroupContext = {
    dateCondition: axis.dateCondition,
    textGrouping: axis.textGrouping,
    labels,
    names: axis.names,
    now,
    locale,
    buckets,
    formatAxis: axis.formatAxis,
  };
  const isSelect = axis.fieldType === FieldType.SingleSelect || axis.fieldType === FieldType.MultiSelect;
  const groups = new Map<string, ChartFactGroup>();
  const keys = values.map((value) =>
    chartGroupRefs(value, field, context).map((ref) => {
      if (!groups.has(ref.key)) {
        const group: ChartFactGroup = { key: ref.key, label: ref.label, hint: ref.hint, isEmpty: ref.key === EMPTY_GROUP_KEY };
        const optionColor = isSelect ? axis.optionIdToColor.get(ref.key) : undefined;

        // Colors are assigned by the series builder from this metadata.
        if (optionColor) group.optionColor = optionColor;
        if (axis.fieldType === FieldType.Checkbox && !group.isEmpty) {
          group.checkboxState = ref.key === CHECKBOX_CHECKED_KEY ? 'checked' : 'unchecked';
        }

        groups.set(ref.key, group);
      }

      return ref.key;
    })
  );

  return { keys, groups: [...groups.values()] };
}

/**
 * Pure transform: row orders + row docs + the grouping settings → one fact
 * per loaded row (its X keys, its Group by keys and its Y cell) and the
 * groups of both properties, unsorted. `buildChartSeries` turns the facts
 * into the drawn series; sort, hidden groups, cumulative, colours and the
 * caps are its inputs, not these, so they never re-read the cells.
 */
export function computeChartFacts({
  aggregation,
  yField,
  rowOrders,
  rowDocs,
  labels,
  locale,
  x,
  sub,
}: ComputeChartFactsInput): ChartFacts {
  if (!rowOrders || !rowDocs || !x) return EMPTY_CHART_FACTS;

  const rows = rowOrders.filter((row) => rowDocs[row.id]);
  // Captured once, so every row buckets against the same day.
  const now = dayjs();
  const xKeys = groupRowsBy(rows, rowDocs, x, labels, locale, now);
  const subKeys = sub ? groupRowsBy(rows, rowDocs, sub, labels, locale, now) : null;
  const readsY = aggregation !== ChartAggregationType.Count && yField !== null;
  const yType = yField ? fieldTypeOf(yField) : null;

  return {
    rows: rows.map((row, index) => ({
      id: row.id,
      x: xKeys.keys[index],
      sub: subKeys ? subKeys.keys[index] : [],
      y: readsY && yField && yType !== null ? readChartYCell(row.id, yField, yType, rowDocs) : null,
    })),
    xGroups: xKeys.groups,
    subGroups: subKeys ? subKeys.groups : null,
  };
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
