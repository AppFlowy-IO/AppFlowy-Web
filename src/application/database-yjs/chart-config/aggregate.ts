/**
 * Chart aggregations 0–16 (WP11 §1.9), pinned by
 * `dashboard-parity/aggregations.json` on web, desktop Dart and (numeric
 * arms) Rust.
 */
import { ChartAggregationType, ChartType } from '../chart-enums';
import { FieldType } from '../database.type';

/**
 * A Y cell reduced to what the aggregations read.
 * - Number: `number`; tokens `[canonicalNumber]`; empty without a number.
 * - Checkbox: `checked`, `number` 0/1 (legacy sums); tokens `["checked"]` or
 *   `["unchecked"]`; empty when unchecked.
 * - Dates: `timestamp` (seconds) and `number` in days since the epoch (legacy
 *   sums); tokens `[String(timestamp)]`; empty without a date.
 * - Selects, people, relations: their ids; text and URL: the trimmed text.
 */
export interface ChartYCell {
  empty: boolean;
  tokens: readonly string[];
  number?: number;
  timestamp?: number;
  checked?: boolean;
}

const SECONDS_PER_DAY = 86400;

const DATE_TYPES: ReadonlySet<number> = new Set([FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime]);

/** The Y types a chart aggregates (`CHART_Y_FIELD_TYPES`, repeated so this module stays dependency free). */
const Y_TYPES: ReadonlySet<number> = new Set([
  FieldType.Number,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.RichText,
  FieldType.URL,
  FieldType.Person,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
  FieldType.Relation,
]);

const NUMBER_AGGREGATIONS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 16]);
const DATE_AGGREGATIONS: ReadonlySet<number> = new Set([13, 14, 15]);
/** Aggregations that hide the Decimal places row: counts and dates. */
const NO_DECIMALS: ReadonlySet<number> = new Set([0, 6, 7, 8, 13, 14, 15]);
const CUMULATIVE_AGGREGATIONS: ReadonlySet<number> = new Set([0, 1, 7, 8]);
const CUMULATIVE_CHARTS: ReadonlySet<number> = new Set([ChartType.Bar, ChartType.HorizontalBar, ChartType.Line]);

export const MAX_CHART_AGGREGATION = 16;

export function isDateYFieldType(type: number | null | undefined): boolean {
  return type !== null && type !== undefined && DATE_TYPES.has(type);
}

function readAggregation(agg: unknown): number | null {
  const value = typeof agg === 'bigint' ? Number(agg) : agg;

  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_CHART_AGGREGATION
    ? value
    : null;
}

/** Whether the Calculate menu offers `agg` for a Y property of `yType` (no legacy combinations). */
export function isAggregationValidFor(agg: number, yType: number | null): boolean {
  if (agg === ChartAggregationType.Count) return true;
  if (yType === null || !Y_TYPES.has(yType)) return false;
  if (NUMBER_AGGREGATIONS.has(agg)) return yType === FieldType.Number;
  if (agg === 6 || agg === 7 || agg === 8) return true;
  if (agg === 9 || agg === 10) return yType !== FieldType.Checkbox;
  if (agg === 11 || agg === 12) return yType === FieldType.Checkbox;
  if (DATE_AGGREGATIONS.has(agg)) return DATE_TYPES.has(yType);
  return false;
}

/** Old charts still compute these combinations the way they always did. */
function isLegacyCombination(agg: number, yType: number): boolean {
  const legacySum = agg === 1 || agg === 2 || agg === 5;

  if (legacySum) return yType === FieldType.Checkbox || DATE_TYPES.has(yType);
  return agg === 6 && (yType === FieldType.Number || yType === FieldType.Checkbox || DATE_TYPES.has(yType));
}

/**
 * What a chart computes, formats and titles (the one rule; WP11 §1.9):
 * no usable Y property counts rows; Min / Max over a date read as Earliest /
 * Latest; legacy combinations stay; any other combination the Y type cannot
 * compute, and any unknown integer, counts rows. The stored value is never
 * rewritten.
 */
export function effectiveChartAggregation(agg: unknown, yType: number | null | undefined): ChartAggregationType {
  const value = readAggregation(agg);
  const type = yType !== null && yType !== undefined && Y_TYPES.has(yType) ? yType : null;

  if (value === null || value === 0 || type === null) return ChartAggregationType.Count;
  if (DATE_TYPES.has(type) && value === 3) return ChartAggregationType.Earliest;
  if (DATE_TYPES.has(type) && value === 4) return ChartAggregationType.Latest;
  if (isAggregationValidFor(value, type) || isLegacyCombination(value, type)) return value as ChartAggregationType;
  return ChartAggregationType.Count;
}

/** The aggregation a newly picked Y property starts with: the current one when it fits, else the type's default. */
export function defaultAggregationFor(yType: number, current: unknown = 0): ChartAggregationType {
  const value = readAggregation(current);

  if (value !== null && value !== 0 && isAggregationValidFor(value, yType)) return value as ChartAggregationType;
  if (yType === FieldType.Number) return ChartAggregationType.Sum;
  if (yType === FieldType.Checkbox) return ChartAggregationType.PercentChecked;
  if (DATE_TYPES.has(yType)) return ChartAggregationType.Latest;
  return ChartAggregationType.CountNotEmpty;
}

export interface ChartCalculateMenu {
  count: ChartAggregationType[];
  percent: ChartAggregationType[];
  more: ChartAggregationType[];
}

/** The Calculate page: Count, Percent and More options, for a Y type on a chart type (a donut has fewer). */
export function calculateMenu(yType: number | null, chartType: ChartType): ChartCalculateMenu {
  if (yType === null) return { count: [ChartAggregationType.Count], percent: [], more: [] };
  const donut = chartType === ChartType.Donut;
  const count = [0, 7, 6, 8];
  const percent = donut ? [] : yType === FieldType.Checkbox ? [11, 12] : [9, 10];
  let more: number[] = [];

  if (yType === FieldType.Number) more = donut ? [1] : [1, 2, 5, 3, 4, 16];
  else if (DATE_TYPES.has(yType) && !donut) more = [13, 14, 15];
  return { count, percent, more } as ChartCalculateMenu;
}

/** Whether Cumulative applies: bar, horizontal bar and line charts of counts and sums. */
export function supportsCumulative(effectiveAgg: number, chartType: ChartType): boolean {
  return CUMULATIVE_CHARTS.has(chartType) && CUMULATIVE_AGGREGATIONS.has(effectiveAgg);
}

/** Whether the Decimal places row applies (not for counts or dates). */
export function supportsDecimalPlaces(effectiveAgg: number): boolean {
  return !NO_DECIMALS.has(effectiveAgg);
}

function numbersOf(cells: readonly ChartYCell[]): number[] {
  const numbers: number[] = [];

  cells.forEach((cell) => {
    if (typeof cell.number === 'number' && Number.isFinite(cell.number)) numbers.push(cell.number);
  });
  return numbers;
}

function timestampsOf(cells: readonly ChartYCell[]): number[] {
  const values: number[] = [];

  cells.forEach((cell) => {
    if (!cell.empty && typeof cell.timestamp === 'number' && Number.isFinite(cell.timestamp)) values.push(cell.timestamp);
  });
  return values;
}

/** Min and max in one pass (no spread, which overflows on large arrays); `null` for no values. */
export function extent(values: readonly number[]): [number, number] | null {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];

  for (let index = 1; index < values.length; index++) {
    if (values[index] < min) min = values[index];
    if (values[index] > max) max = values[index];
  }

  return [min, max];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * The value of `agg` over a group's cells (one per row). `null` is "no value":
 * the Number card shows "No data", grouped charts draw 0.
 */
export function aggregateChartCells(agg: number, cells: readonly ChartYCell[], rowCount = cells.length): number | null {
  const filled = () => cells.filter((cell) => !cell.empty).length;
  const percent = (part: number) => (rowCount > 0 ? (100 * part) / rowCount : 0);

  switch (agg) {
    case 0:
      return rowCount;
    case 1:
      return numbersOf(cells).reduce((sum, value) => sum + value, 0);
    case 2: {
      const numbers = numbersOf(cells);

      return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    }

    case 3:
      return extent(numbersOf(cells))?.[0] ?? null;
    case 4:
      return extent(numbersOf(cells))?.[1] ?? null;
    case 5:
      return median(numbersOf(cells));
    case 6: {
      const tokens = new Set<string>();

      cells.forEach((cell) => cell.tokens.forEach((token) => tokens.add(token)));
      return tokens.size;
    }

    case 7:
      return filled();
    case 8:
      return rowCount - filled();
    case 9:
      return percent(rowCount - filled());
    case 10:
      return percent(filled());
    case 11:
      return percent(cells.filter((cell) => cell.checked === true).length);
    case 12:
      return percent(rowCount - cells.filter((cell) => cell.checked === true).length);
    case 13:
      return extent(timestampsOf(cells))?.[0] ?? null;
    case 14:
      return extent(timestampsOf(cells))?.[1] ?? null;
    case 15: {
      const range = extent(timestampsOf(cells));

      return range ? (range[1] - range[0]) / SECONDS_PER_DAY : null;
    }

    case 16: {
      const range = extent(numbersOf(cells));

      return range ? range[1] - range[0] : null;
    }

    default:
      return rowCount;
  }
}

/**
 * An aggregate as the chart stores and formats it: Earliest and Latest are
 * computed in seconds and printed by R-FORMAT from days since the epoch.
 */
export function chartValueOfAggregate(agg: number, value: number | null): number | null {
  if (value === null) return null;
  return agg === ChartAggregationType.Earliest || agg === ChartAggregationType.Latest ? value / SECONDS_PER_DAY : value;
}

/** Label of every aggregation (WP11 §1.14): translation key and English fallback. */
export const CHART_AGGREGATION_META: Readonly<Record<number, { labelKey: string; fallback: string }>> = {
  0: { labelKey: 'chart.agg.countAll', fallback: 'Count all' },
  1: { labelKey: 'chart.agg.sum', fallback: 'Sum' },
  2: { labelKey: 'chart.agg.average', fallback: 'Average' },
  3: { labelKey: 'chart.agg.min', fallback: 'Min' },
  4: { labelKey: 'chart.agg.max', fallback: 'Max' },
  5: { labelKey: 'chart.agg.median', fallback: 'Median' },
  6: { labelKey: 'chart.agg.countUnique', fallback: 'Count unique values' },
  7: { labelKey: 'chart.agg.countValues', fallback: 'Count values' },
  8: { labelKey: 'chart.agg.countEmpty', fallback: 'Count empty' },
  9: { labelKey: 'chart.agg.percentEmpty', fallback: 'Percent empty' },
  10: { labelKey: 'chart.agg.percentNotEmpty', fallback: 'Percent not empty' },
  11: { labelKey: 'chart.agg.percentChecked', fallback: 'Percent checked' },
  12: { labelKey: 'chart.agg.percentUnchecked', fallback: 'Percent unchecked' },
  13: { labelKey: 'chart.agg.earliest', fallback: 'Earliest' },
  14: { labelKey: 'chart.agg.latest', fallback: 'Latest' },
  15: { labelKey: 'chart.agg.dateRange', fallback: 'Date range' },
  16: { labelKey: 'chart.agg.range', fallback: 'Range' },
};
