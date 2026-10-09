import * as Y from 'yjs';

import {
  GROUP_CALCULATION_SUPPORTED_FIELD_TYPES,
  GROUP_CALCULATION_TO_AGGREGATION,
  GROUP_CALCULATION_VALID_TYPES_BY_FIELD_TYPE,
} from '@/application/database-yjs/board-group-calculation.constants';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { extent } from '@/application/database-yjs/chart-config/aggregate';
import { type ChartFormatYField, formatChartValue } from '@/application/database-yjs/chart-format';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { parseChecklistFlexible } from '@/application/database-yjs/fields/checklist/parse';
import { getFieldDateTimeFormats } from '@/application/database-yjs/fields/date/utils';
import { parseNumberTypeOptions } from '@/application/database-yjs/fields/number/parse';
import { parseCheckboxValue } from '@/application/database-yjs/fields/text/utils';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';

export {
  GROUP_CALCULATION_SUPPORTED_FIELD_TYPES,
  GROUP_CALCULATION_TO_AGGREGATION,
  GROUP_CALCULATION_VALID_TYPES_BY_FIELD_TYPE,
};

/**
 * A board's column calculation (WP09 §1.6): `layout_settings["1"].group_calculation`
 * = `{type, field_id}`. Absent, unreadable or Count all = the card count.
 */
export interface BoardGroupCalculation {
  type: CalculationType;
  fieldId: string;
}

/** The persisted key and the "Count all" value writers store (never a key deletion). */
export const GROUP_CALCULATION_KEY = 'group_calculation';
export const GROUP_CALCULATION_COUNT_ALL = Object.freeze({ type: CalculationType.Count, field_id: '' });

/** Every CalculationType a board column can show (the union of the valid types). */
const KNOWN_GROUP_CALCULATION_TYPES: ReadonlySet<number> = new Set(
  Object.values(GROUP_CALCULATION_VALID_TYPES_BY_FIELD_TYPE).flat()
);

/** Whether a field type offers board column calculations. */
export function isGroupCalculationFieldType(fieldType: FieldType | number | undefined): boolean {
  return fieldType !== undefined && GROUP_CALCULATION_SUPPORTED_FIELD_TYPES.includes(Number(fieldType));
}

/** The calculations a column can show for a field type, in menu order (Count all is separate). */
export function validGroupCalculationTypes(fieldType: FieldType | number | undefined): CalculationType[] {
  if (fieldType === undefined) return [];
  return [...(GROUP_CALCULATION_VALID_TYPES_BY_FIELD_TYPE[String(Number(fieldType))] ?? [])] as CalculationType[];
}

/** The R-FORMAT aggregation of a calculation (`calculation_to_aggregation`). */
export function calculationTypeToAggregation(type: CalculationType | number): number | undefined {
  return GROUP_CALCULATION_TO_AGGREGATION[String(Number(type))];
}

/** A whole integer from a JS number or a native integer (`bigint`, a yrs `Any::BigInt`). */
function readWholeInteger(value: unknown): number | undefined {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return undefined;
}

function readEntry(raw: unknown, key: string): unknown {
  if (raw instanceof Y.Map) return raw.get(key);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return (raw as Record<string, unknown>)[key];
  return undefined;
}

/**
 * The effective calculation of a stored `group_calculation` (a plain object or
 * a `Y.Map`), or `undefined` for the card count: any other shape, an unknown
 * type, Count all, an empty or non-string field id, a field that is gone, or a
 * calculation the field's type does not offer (desktop `BoardGroupCalculation::
 * from_layout_any` + `supports`). It never rewrites what it cannot read.
 *
 * @param resolveFieldType - The field type of a field id (`undefined` for a missing field); without
 *   it the field is not checked.
 */
export function readBoardGroupCalculation(
  raw: unknown,
  resolveFieldType?: (fieldId: string) => FieldType | number | undefined
): BoardGroupCalculation | undefined {
  const type = readWholeInteger(readEntry(raw, 'type'));
  const fieldId = readEntry(raw, 'field_id');

  if (type === undefined || !KNOWN_GROUP_CALCULATION_TYPES.has(type)) return undefined;
  if (typeof fieldId !== 'string' || fieldId === '') return undefined;
  if (resolveFieldType) {
    const fieldType = resolveFieldType(fieldId);

    if (!isGroupCalculationFieldType(fieldType) || !validGroupCalculationTypes(fieldType).includes(type)) {
      return undefined;
    }
  }

  return { type: type as CalculationType, fieldId };
}

/** One row of a column, as the calculation reads it. Timestamps are in seconds. */
export interface BoardGroupCalculationRow {
  cell?: YDatabaseCell;
  createdAt?: number | string;
  lastModified?: number | string;
}

export type BoardGroupCalculationResult =
  | { kind: 'none' }
  | { kind: 'number'; value: number }
  | { kind: 'date'; timestampMs: number };

const NONE: BoardGroupCalculationResult = Object.freeze({ kind: 'none' });

function toSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const seconds = Number(value);

  return Number.isFinite(seconds) ? seconds : undefined;
}

/** What the calculation needs from one cell, by the field's type (desktop's handlers). */
interface CellReading {
  /** `handle_is_empty`; a missing cell is empty except where the service injects one. */
  empty: boolean;
  /** `handle_numeric_cell`. */
  numeric?: number;
  /** A date in seconds (date fields, row timestamps). */
  timestamp?: number;
  checked?: boolean;
  /** The value Count unique compares (`handle_stringify_cell`; sorted ids for multi-select). */
  uniqueKey?: string;
}

function readCell(fieldType: FieldType, field: YDatabaseField, row: BoardGroupCalculationRow): CellReading {
  // CreatedTime and LastEditedTime come from the row, never from a cell.
  if (fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime) {
    const timestamp = toSeconds(fieldType === FieldType.CreatedTime ? row.createdAt : row.lastModified);

    return timestamp === undefined ? { empty: true } : { empty: false, timestamp, uniqueKey: String(timestamp) };
  }

  const data = row.cell ? parseYDatabaseCellToCell(row.cell, field).data : undefined;

  switch (fieldType) {
    case FieldType.Checkbox: {
      // A missing checkbox counts as unchecked (`calculate_rows_while_open`).
      const checked = parseCheckboxValue(data as string | number | boolean | undefined);

      return { empty: false, checked, uniqueKey: checked ? 'Yes' : 'No' };
    }

    case FieldType.Number: {
      const text = data === undefined || data === null ? '' : String(data).trim();

      if (!text) return { empty: true };
      const numeric = Number(text);

      return Number.isFinite(numeric)
        ? { empty: false, numeric, uniqueKey: String(numeric) }
        : { empty: false, uniqueKey: text };
    }

    case FieldType.DateTime: {
      const timestamp = toSeconds(data);

      return timestamp === undefined ? { empty: true } : { empty: false, timestamp, uniqueKey: String(timestamp) };
    }

    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      const ids = typeof data === 'string' ? data.split(',').filter(Boolean) : [];

      if (ids.length === 0) return { empty: true };
      return { empty: false, uniqueKey: [...ids].sort().join(',') };
    }

    case FieldType.Checklist: {
      const parsed = typeof data === 'string' ? parseChecklistFlexible(data) : null;
      const options = parsed?.options ?? [];

      if (options.length === 0) return { empty: true };
      return {
        empty: false,
        uniqueKey: JSON.stringify(
          options.map((option) => [option.name, Boolean(parsed?.selectedOptionIds?.includes(option.id))])
        ),
      };
    }

    default: {
      const text = typeof data === 'string' || typeof data === 'number' ? String(data) : '';

      return text.trim() ? { empty: false, uniqueKey: text } : { empty: true };
    }
  }
}

function median(sorted: number[]) {
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function numberResult(value: number | undefined): BoardGroupCalculationResult {
  return value === undefined || !Number.isFinite(value) ? NONE : { kind: 'number', value };
}

/**
 * A column's calculation over its effective rows, with the semantics of the
 * desktop `CalculationsService::calculate_with_numeric` (WP09 §1.6): numeric
 * aggregations over no number have no value, percents are of the column's
 * rows, Count empty is rows minus non-empty cells, a date range needs two
 * dates and is in days. `group-calculations.json` pins every case.
 */
export function computeBoardGroupCalculation({
  type,
  field,
  rows,
}: {
  type: CalculationType;
  field: YDatabaseField;
  rows: BoardGroupCalculationRow[];
}): BoardGroupCalculationResult {
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
  const total = rows.length;
  // One pass over the rows; the extents are loops too (a spread overflows the
  // call stack on a column of ~100k cards).
  let nonEmpty = 0;
  let checked = 0;
  let unchecked = 0;
  const uniqueKeys = new Set<string | undefined>();
  const numbers: number[] = [];
  const dates: number[] = [];

  for (const row of rows) {
    const reading = readCell(fieldType, field, row);

    if (!reading.empty) {
      nonEmpty += 1;
      uniqueKeys.add(reading.uniqueKey);
    }

    if (reading.checked === true) checked += 1;
    else if (reading.checked === false) unchecked += 1;
    if (reading.numeric !== undefined) numbers.push(reading.numeric);
    if (reading.timestamp !== undefined) dates.push(reading.timestamp);
  }

  const percentOf = (count: number) => (total === 0 ? NONE : numberResult((count / total) * 100));
  const sum = () => numbers.reduce((acc, value) => acc + value, 0);

  switch (type) {
    case CalculationType.Count:
      return numberResult(total);
    case CalculationType.CountEmpty:
      return numberResult(Math.max(total - nonEmpty, 0));
    case CalculationType.CountNonEmpty:
      return numberResult(nonEmpty);
    case CalculationType.PercentEmpty:
      return percentOf(Math.max(total - nonEmpty, 0));
    case CalculationType.PercentNotEmpty:
      return percentOf(nonEmpty);
    case CalculationType.CountUnique:
      return numberResult(uniqueKeys.size);
    case CalculationType.CountChecked:
      return numberResult(checked);
    case CalculationType.CountUnchecked:
      return numberResult(unchecked);
    case CalculationType.PercentChecked:
      return percentOf(checked);
    case CalculationType.PercentUnchecked:
      return percentOf(unchecked);
    case CalculationType.Sum:
      return numbers.length === 0 ? NONE : numberResult(sum());
    case CalculationType.Average:
      return numbers.length === 0 ? NONE : numberResult(sum() / numbers.length);
    case CalculationType.Median:
      return numbers.length === 0 ? NONE : numberResult(median([...numbers].sort((a, b) => a - b)));
    case CalculationType.Min:
      return numberResult(extent(numbers)?.[0]);
    case CalculationType.Max:
      return numberResult(extent(numbers)?.[1]);
    case CalculationType.NumberRange: {
      const range = numbers.length < 2 ? null : extent(numbers);

      return range ? numberResult(range[1] - range[0]) : NONE;
    }

    case CalculationType.DateEarliest: {
      const range = extent(dates);

      return range ? { kind: 'date', timestampMs: range[0] * 1000 } : NONE;
    }

    case CalculationType.DateLatest: {
      const range = extent(dates);

      return range ? { kind: 'date', timestampMs: range[1] * 1000 } : NONE;
    }

    case CalculationType.DateRange: {
      const range = dates.length < 2 ? null : extent(dates);

      return range ? numberResult((range[1] - range[0]) / 86400) : NONE;
    }

    default:
      return NONE;
  }
}

const DATE_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  FieldType.DateTime,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
]);

/** The field as R-FORMAT reads it: its kind and the one format that kind prints with. */
export function groupCalculationFormatField(field: YDatabaseField): ChartFormatYField {
  const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  if (type === FieldType.Number) return { type: 'number', numberFormat: parseNumberTypeOptions(field, type).format };
  if (type === FieldType.Checkbox) return { type: 'checkbox' };
  if (DATE_FIELD_TYPES.has(type)) {
    return { type: 'date', dateFormat: getFieldDateTimeFormats(getTypeOptions(field)).dateFormat };
  }

  return { type: 'other' };
}

const DAY_MS = 86_400_000;

/**
 * A column calculation as its header prints it: R-FORMAT in `tooltip` mode
 * (the full value, never compact) with the calculation's aggregation and the
 * field's number or date format. No value prints as `''`.
 */
export function formatBoardGroupCalculation(
  result: BoardGroupCalculationResult,
  {
    type,
    field,
    locale,
    timeZone,
    labels,
  }: {
    type: CalculationType;
    field: YDatabaseField;
    locale: string;
    timeZone?: string;
    labels?: { days: (count: number) => string };
  }
): string {
  if (result.kind === 'none') return '';
  const aggregation = calculationTypeToAggregation(type);

  if (aggregation === undefined) return '';
  const value = result.kind === 'date' ? result.timestampMs / DAY_MS : result.value;

  return formatChartValue(value, {
    aggregation,
    yField: groupCalculationFormatField(field),
    mode: 'tooltip',
    locale,
    timeZone,
    labels,
  });
}
