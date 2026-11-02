/** Shared readers of the WP11 parity fixtures for the chart-config tests. */
import dayjs from 'dayjs';

import { ChartType } from '../../chart-enums';
import { formatChartValue } from '../../chart-format';
import { DateGroupCondition, FieldType } from '../../database.type';
import { ChartCellValue, ChartGroupHint, ChartGroupLabels } from '../group-keys';

/** A FieldType or ChartTypePB name of the fixtures. */
export function fieldTypeOf(name: string): FieldType {
  const type = (FieldType as unknown as Record<string, number>)[name];

  if (type === undefined) throw new Error(`Unknown field type "${name}"`);
  return type as FieldType;
}

const CHART_TYPES: Record<string, ChartType> = {
  Bar: ChartType.Bar,
  Line: ChartType.Line,
  HorizontalBar: ChartType.HorizontalBar,
  Donut: ChartType.Donut,
  NumberChart: ChartType.Number,
};

export function chartTypeOf(name: string): ChartType {
  const type = CHART_TYPES[name];

  if (type === undefined) throw new Error(`Unknown chart type "${name}"`);
  return type;
}

export function dateConditionOf(name: string | undefined): DateGroupCondition {
  if (!name) return DateGroupCondition.Month;
  return (DateGroupCondition as unknown as Record<string, number>)[name] as DateGroupCondition;
}

/** `"Infinity"` / `"-Infinity"` ranks of the fixtures as numbers. */
export function decodeHint(hint: { rank?: number | string; tie?: string; label?: boolean }): ChartGroupHint {
  if (hint.label) return { label: true };
  const rank = hint.rank === 'Infinity' ? Infinity : hint.rank === '-Infinity' ? -Infinity : Number(hint.rank);

  return hint.tie === undefined ? { rank } : { rank, tie: hint.tie };
}

export interface FixtureLabels {
  checked: string;
  unchecked: string;
  noFieldValue: string;
  emptyFieldName: string;
  weekOf: string;
  relative: ChartGroupLabels['relative'];
  unknownPerson: string;
  unknownUser: string;
  untitled: string;
}

export function groupLabelsOf(labels: FixtureLabels): ChartGroupLabels {
  return {
    checked: labels.checked,
    unchecked: labels.unchecked,
    noFieldValue: (name) => (name ? labels.noFieldValue.replace('{field}', name) : labels.emptyFieldName),
    // The fixture names the placeholders; the app's translation has two positional `{}`.
    weekOfTemplate: labels.weekOf.replace('{start}', '{}').replace('{end}', '{}'),
    relative: labels.relative,
    unknownPerson: labels.unknownPerson,
    unknownUser: labels.unknownUser,
    untitled: labels.untitled,
  };
}

/** A fixture cell value as the abstract value grouping reads. */
export function cellValueOf(type: FieldType, value: unknown): ChartCellValue {
  if (value === null || value === undefined) return { kind: 'empty' };
  switch (type) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return { kind: 'select', ids: Array.isArray(value) ? (value as string[]) : [String(value)] };
    case FieldType.Checkbox:
      return { kind: 'checkbox', checked: value === true };
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return { kind: 'date', date: dayjs(String(value)) };
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return { kind: 'users', ids: Array.isArray(value) ? (value as string[]) : [String(value)] };
    case FieldType.Relation:
      return { kind: 'relation', ids: value as string[] };
    case FieldType.Number:
      return { kind: 'number', value: Number(value) };
    default:
      return { kind: 'text', text: String(value) };
  }
}

/** R-FORMAT axis mode in en-US for a Number X field (`group-keys.json` labels). */
export function axisFormatter(numberFormat = 0) {
  return (value: number) =>
    formatChartValue(value, { aggregation: 1, yField: { type: 'number', numberFormat }, mode: 'axis', locale: 'en-US' });
}
