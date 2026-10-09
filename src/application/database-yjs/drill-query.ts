/**
 * The chart drill-down query (WP13 §3.1–§3.2, §3.7): the clicked category as
 * filters on the source database, the chips that describe it, the drill
 * table's columns and the filter merge of "Save as view". Pure: no React.
 * Desktop has the same rules in `drill_query.dart`; both are pinned by
 * `dashboard-parity/drill-queries.json`.
 */
import { nanoid } from 'nanoid';

import { FieldId, RowId } from '@/application/types';

import { CHART_ALL_SERIES_KEY, ChartDataItem, EMPTY_CATEGORY_KEY } from './chart.type';
import type { DashboardExtraFilter } from './dashboard-global-filters';
import { DateGroupCondition, FieldType, FieldVisibility, FilterType } from './database.type';
import { CheckboxFilterCondition } from './fields/checkbox/checkbox.type';
import { DateFilterCondition } from './fields/date/date.type';
import { NumberFilterCondition } from './fields/number/number.type';
import { PersonFilterCondition } from './fields/person/person.type';
import { RelationFilterCondition } from './fields/relation/relation.type';
import { SelectOptionFilterCondition } from './fields/select-option/select_option.type';
import { TextFilterCondition } from './fields/text/text.type';

/** What a chart click drills into (WP13 §3.1). */
export interface ChartDrillTarget {
  /** R-GROUPKEY of the clicked category; '' for the Number chart. */
  xKey: string;
  /** The category label as drawn (title and pill). */
  xLabel: string;
  /** The "No {field}" category. */
  xIsEmpty: boolean;
  /** WP12 stacked or grouped segment. */
  subGroupKey?: string;
  subGroupLabel?: string;
  subGroupIsEmpty?: boolean;
  /** The clicked cell's rows at click time; used only by the row-set fallback. */
  rowIds: RowId[];
}

/** The drill target of a chart item (rules 8.1). */
export function toDrillTarget(item: ChartDataItem): ChartDrillTarget {
  const subGroupKey =
    item.seriesKey === undefined || item.seriesKey === CHART_ALL_SERIES_KEY ? undefined : item.seriesKey;

  return {
    xKey: item.categoryKey ?? item.key ?? (item.isEmptyCategory ? EMPTY_CATEGORY_KEY : ''),
    xLabel: item.label,
    xIsEmpty: !!item.isEmptyCategory,
    subGroupKey,
    subGroupLabel: subGroupKey === undefined ? undefined : item.seriesLabel,
    subGroupIsEmpty: subGroupKey === undefined ? undefined : subGroupKey === EMPTY_CATEGORY_KEY,
    rowIds: item.rowIds,
  };
}

/** The Number chart's drill target: no category, the counted rows. */
export function numberChartDrillTarget(title: string, rowIds: RowId[]): ChartDrillTarget {
  return { xKey: '', xLabel: title, xIsEmpty: false, rowIds };
}

/** The property a category key belongs to: the chart's X field or its Group by field. */
export interface DrillGroupField {
  id: FieldId;
  name: string;
  type: FieldType;
  /** Date fields: how the chart buckets them (Month when absent). */
  dateCondition?: DateGroupCondition;
  /** Number fields: the resolved range size of the axis; a range key needs it. */
  numberBucketSize?: number | null;
}

/** The filters of one category part, or the row-set fallback. */
export type DrillPart = { kind: 'filters'; nodes: DashboardExtraFilter[] } | { kind: 'rows' };

/** The whole category of a drill (both parts), WP13 §3.1. */
export type DrillCategory = { kind: 'filters'; nodes: DashboardExtraFilter[] } | { kind: 'rows' } | { kind: 'none' };

export interface DrillCategoryChip {
  kind: 'category' | 'subgroup' | 'rows';
  text: string;
  /** The field the pill describes (its type icon); absent for the rows chip. */
  fieldId?: FieldId;
}

const ROWS: DrillPart = Object.freeze({ kind: 'rows' }) as DrillPart;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const YEAR_KEY = /^(\d{4})$/;

/** A local calendar date (no time, no zone). */
interface LocalDate {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

/** A date range `[start, end)` of local calendar dates. */
export interface DrillDateRange {
  start: LocalDate;
  end: LocalDate;
}

/** Calendar arithmetic through the Date constructor, which normalises overflowing days and months. */
function localDate(year: number, month: number, day: number): LocalDate {
  const date = new Date(year, month - 1, day);

  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function addDays(date: LocalDate, days: number): LocalDate {
  return localDate(date.year, date.month, date.day + days);
}

function sameDate(a: LocalDate, b: LocalDate) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function compareDates(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Local midnight of a calendar date, in seconds (the content of a date filter). */
export function localMidnightSeconds(date: LocalDate): number {
  return Math.floor(new Date(date.year, date.month - 1, date.day).getTime() / 1000);
}

function parseDayKey(key: string): LocalDate | null {
  const match = DAY_KEY.exec(key);

  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };

  // `2026-02-31` is not a key any chart writes.
  return sameDate(localDate(date.year, date.month, date.day), date) ? date : null;
}

function parseMonthKey(key: string): LocalDate | null {
  const match = MONTH_KEY.exec(key);

  if (!match) return null;
  const month = Number(match[2]);

  return month >= 1 && month <= 12 ? { year: Number(match[1]), month, day: 1 } : null;
}

function monthRange(first: LocalDate): DrillDateRange {
  return { start: first, end: localDate(first.year, first.month + 1, 1) };
}

/** `[start, end)` of each relative bucket around today `t` (matches `relativeBucket`). */
const RELATIVE_BUCKET_DAYS: Readonly<Record<string, readonly [number, number]>> = {
  today: [0, 1],
  yesterday: [-1, 0],
  tomorrow: [1, 2],
  last_7_days: [-7, -1],
  next_7_days: [2, 8],
  last_30_days: [-30, -7],
  next_30_days: [8, 31],
};

/** The relative window: a month key whose range meets it holds rows of several buckets. */
const RELATIVE_WINDOW_DAYS: readonly [number, number] = [-30, 31];

/**
 * The `[start, end)` local dates of a date bucket key (weeks start on
 * Monday), or `null` when the key cannot be expressed as a range (an unknown
 * key, or a Relative-mode month that overlaps the ±30-day window): the
 * row-set fallback. The key's shape decides the range (`rel:` buckets, `YYYY`,
 * `YYYY-MM`, `YYYY-MM-DD`; a day key spans 7 days under Week); `rel-<bucket>`
 * is a legacy alias of `rel:<bucket>`.
 */
export function dateBucketRange(key: string, condition: DateGroupCondition, now: Date): DrillDateRange | null {
  const today = localDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const relative = /^rel[:-](.+)$/.exec(key);

  if (relative) {
    const days = Object.prototype.hasOwnProperty.call(RELATIVE_BUCKET_DAYS, relative[1])
      ? RELATIVE_BUCKET_DAYS[relative[1]]
      : undefined;

    return days ? { start: addDays(today, days[0]), end: addDays(today, days[1]) } : null;
  }

  const year = YEAR_KEY.exec(key);

  if (year) return { start: localDate(Number(year[1]), 1, 1), end: localDate(Number(year[1]) + 1, 1, 1) };

  const first = parseMonthKey(key);

  if (first) {
    const range = monthRange(first);

    if (condition !== DateGroupCondition.Relative) return range;
    // Farther dates fall back to their month; a month that meets the window
    // also holds rows of the relative buckets.
    const windowStart = addDays(today, RELATIVE_WINDOW_DAYS[0]);
    const windowEnd = addDays(today, RELATIVE_WINDOW_DAYS[1]);
    const intersects = compareDates(range.start, windowEnd) < 0 && compareDates(windowStart, range.end) < 0;

    return intersects ? null : range;
  }

  const day = parseDayKey(key);

  if (!day) return null;
  return { start: day, end: addDays(day, condition === DateGroupCondition.Week ? 7 : 1) };
}

/**
 * `x.toFixed(10)` without trailing zeros or a trailing `.`; `-0` is `0`. The
 * upper bound of a number range (`0.1 + 0.2` gives `0.3`, `10` gives `10`).
 */
export function canonicalDecimal(x: number): string {
  const fixed = x.toFixed(10);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;

  return trimmed === '-0' ? '0' : trimmed;
}

const NUMERIC = /^-?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;

/** The field types whose empty category cannot be expressed as a filter. */
const NO_EMPTY_FILTER_TYPES: ReadonlySet<FieldType> = new Set([
  FieldType.Checkbox,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
]);

function emptyCondition(type: FieldType): number | null {
  switch (type) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return SelectOptionFilterCondition.OptionIsEmpty;
    case FieldType.DateTime:
      return DateFilterCondition.DateStartIsEmpty;
    case FieldType.Person:
      return PersonFilterCondition.PersonIsEmpty;
    case FieldType.RichText:
    case FieldType.URL:
      return TextFilterCondition.TextIsEmpty;
    case FieldType.Number:
      return NumberFilterCondition.NumberIsEmpty;
    case FieldType.Relation:
      return RelationFilterCondition.RelationIsEmpty;
    default:
      return null;
  }
}

/**
 * The filters of one category key on `field` (WP13 §3.2), or the row-set
 * fallback. Node ids are `drill:{idPrefix}:{n}`.
 */
export function drillFiltersForGroupKey(
  field: DrillGroupField,
  key: string,
  now: Date,
  idPrefix: 'x' | 'sub' = 'x'
): DrillPart {
  const node = (condition: number, content: string, index = 0): DashboardExtraFilter => ({
    id: `drill:${idPrefix}:${index}`,
    filter_type: FilterType.Data,
    field_id: field.id,
    ty: field.type,
    condition,
    content,
  });
  const filters = (...nodes: DashboardExtraFilter[]): DrillPart => ({ kind: 'filters', nodes });

  if (key === EMPTY_CATEGORY_KEY) {
    if (NO_EMPTY_FILTER_TYPES.has(field.type)) return ROWS;
    const condition = emptyCondition(field.type);

    return condition === null ? ROWS : filters(node(condition, ''));
  }

  switch (field.type) {
    case FieldType.SingleSelect:
      return filters(node(SelectOptionFilterCondition.OptionIs, key));
    case FieldType.MultiSelect:
      return filters(node(SelectOptionFilterCondition.OptionContains, key));
    case FieldType.Checkbox:
      if (key === 'checked') return filters(node(CheckboxFilterCondition.IsChecked, ''));
      if (key === 'unchecked') return filters(node(CheckboxFilterCondition.IsUnChecked, ''));
      return ROWS;
    case FieldType.DateTime:
    case FieldType.LastEditedTime:
    case FieldType.CreatedTime: {
      const range = dateBucketRange(key, field.dateCondition ?? DateGroupCondition.Month, now);

      if (!range) return ROWS;
      // Charts group by the start date, so the End variants are never produced.
      return filters(
        node(
          DateFilterCondition.DateStartsOnOrAfter,
          JSON.stringify({ timestamp: localMidnightSeconds(range.start) }),
          0
        ),
        node(DateFilterCondition.DateStartsBefore, JSON.stringify({ timestamp: localMidnightSeconds(range.end) }), 1)
      );
    }

    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return filters(node(PersonFilterCondition.PersonContains, JSON.stringify([key])));
    case FieldType.RichText:
    case FieldType.URL:
      if (key.startsWith('t:')) return filters(node(TextFilterCondition.TextIs, key.slice(2)));
      if (key === 'l:#' || !key.startsWith('l:') || key.length === 2) return ROWS;
      return filters(node(TextFilterCondition.TextStartsWith, key.slice(2)));
    case FieldType.Number: {
      if (key.startsWith('n:lt:')) {
        const min = key.slice('n:lt:'.length);

        return NUMERIC.test(min) ? filters(node(NumberFilterCondition.LessThan, min)) : ROWS;
      }

      if (key.startsWith('n:ge:')) {
        const max = key.slice('n:ge:'.length);

        return NUMERIC.test(max) ? filters(node(NumberFilterCondition.GreaterThanOrEqualTo, max)) : ROWS;
      }

      if (!key.startsWith('n:')) return ROWS;
      const lower = key.slice(2);
      const size = field.numberBucketSize;

      if (!NUMERIC.test(lower) || typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return ROWS;
      return filters(
        node(NumberFilterCondition.GreaterThanOrEqualTo, lower, 0),
        node(NumberFilterCondition.LessThan, canonicalDecimal(Number(lower) + size), 1)
      );
    }

    default:
      // Relations and any other type: the clicked rows.
      return ROWS;
  }
}

/** `{field name}: {label}`, `{field name}: Empty` for the empty category. */
export function drillChipText(fieldName: string, label: string, isEmpty: boolean, emptyLabel: string): string {
  return `${fieldName}: ${isEmpty ? emptyLabel : label}`;
}

export interface DrillChipLabels {
  /** `chart.emptyValue`: "Empty". */
  empty: string;
  /** `chart.drilldown.selectedRows`: "Selected rows ({count})". */
  selectedRows: (count: number) => string;
}

export interface DrillCategoryResult {
  /** The category filters (both parts), AND-ed after the widget's global filters. */
  nodes: DashboardExtraFilter[];
  /** The row-set fallback: only these rows may show (rows can leave, none join). `null` without one. */
  rowAllowList: RowId[] | null;
  chips: DrillCategoryChip[];
  category: DrillCategory;
}

const NO_CATEGORY: DrillCategoryResult = Object.freeze({
  nodes: [],
  rowAllowList: null,
  chips: [],
  category: { kind: 'none' },
}) as DrillCategoryResult;

/**
 * The category of a drill target: the filters of its X key (and of the
 * clicked sub-group's key) with their read-only pills, or the row-set
 * fallback (one "Selected rows (n)" chip) when either part cannot be
 * expressed as filters. The Number chart and a missing X field have none.
 */
export function buildDrillCategory({
  target,
  xField,
  subGroupField,
  now,
  labels,
}: {
  target: ChartDrillTarget;
  xField: DrillGroupField | null;
  subGroupField?: DrillGroupField | null;
  now: Date;
  labels: DrillChipLabels;
}): DrillCategoryResult {
  const isNumberChart = target.xKey === '' && !target.xIsEmpty;

  if (isNumberChart || !xField) return NO_CATEGORY;
  const fallback = (): DrillCategoryResult => ({
    nodes: [],
    rowAllowList: target.rowIds,
    chips: [{ kind: 'rows', text: labels.selectedRows(target.rowIds.length) }],
    category: { kind: 'rows' },
  });
  const x = drillFiltersForGroupKey(xField, target.xIsEmpty ? EMPTY_CATEGORY_KEY : target.xKey, now, 'x');

  if (x.kind !== 'filters') return fallback();
  const nodes = [...x.nodes];
  const chips: DrillCategoryChip[] = [
    {
      kind: 'category',
      text: drillChipText(xField.name, target.xLabel, target.xIsEmpty, labels.empty),
      fieldId: xField.id,
    },
  ];

  if (target.subGroupKey !== undefined) {
    if (!subGroupField) return fallback();
    const subIsEmpty = Boolean(target.subGroupIsEmpty);
    const sub = drillFiltersForGroupKey(subGroupField, subIsEmpty ? EMPTY_CATEGORY_KEY : target.subGroupKey, now, 'sub');

    if (sub.kind !== 'filters') return fallback();
    nodes.push(...sub.nodes);
    chips.push({
      kind: 'subgroup',
      text: drillChipText(subGroupField.name, target.subGroupLabel ?? target.subGroupKey, subIsEmpty, labels.empty),
      fieldId: subGroupField.id,
    });
  }

  return { nodes, rowAllowList: null, chips, category: { kind: 'filters', nodes } };
}

/** A column of the drill table: the fields of `useFieldsSelector`, any visibility. */
export interface DrillColumnInput {
  fieldId: FieldId;
  isPrimary: boolean;
  visibility: FieldVisibility;
}

/** The primary field first, then the view's field order; only `AlwaysHidden` fields are left out. */
export function drillColumns<T extends DrillColumnInput>(columns: readonly T[]): T[] {
  const shown = columns.filter((column) => column.isPrimary || column.visibility !== FieldVisibility.AlwaysHidden);
  const primary = shown.filter((column) => column.isPrimary);

  return [...primary, ...shown.filter((column) => !column.isPrimary)];
}

/** A persisted filter node as plain JSON: `{id, filter_type, field_id, ty, condition, content, children}`. */
export type SavedFilterNode = Record<string, unknown>;

/** Global and category nodes as saved-filter nodes with fresh ids (`filter_type` 2). */
export function toSavedFilterNodes(
  extras: readonly DashboardExtraFilter[],
  genId: () => string = () => nanoid(6)
): SavedFilterNode[] {
  return extras.map((extra) => ({
    id: genId(),
    filter_type: FilterType.Data,
    field_id: extra.field_id,
    ty: extra.ty,
    condition: extra.condition,
    content: extra.content,
  }));
}

function filterTypeOf(node: SavedFilterNode | undefined): number | undefined {
  const value = node?.filter_type;

  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The filters "Save as view" writes (WP13 §3.7; golden `save_merge`): no
 * extras keeps the view; an empty or flat view takes the extras after its
 * filters; a single And root takes them as its last children; an Or root or
 * several top-level nodes go under a new And root with the extras.
 */
export function mergeFiltersForSave(
  view: readonly SavedFilterNode[],
  extras: readonly SavedFilterNode[],
  genId: () => string = () => nanoid(6)
): SavedFilterNode[] {
  if (extras.length === 0) return [...view];
  const first = filterTypeOf(view[0]);

  if (view.length === 0 || first === FilterType.Data || first === undefined) return [...view, ...extras];

  if (view.length === 1 && first === FilterType.And) {
    const root = view[0];
    const children = Array.isArray(root.children) ? (root.children as SavedFilterNode[]) : [];

    return [{ ...root, children: [...children, ...extras] }];
  }

  return [{ id: genId(), filter_type: FilterType.And, children: [...view, ...extras] }];
}
