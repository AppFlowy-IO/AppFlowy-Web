import { RowId } from '@/application/types';

import { DateGroupCondition, FieldType } from './database.type';

/**
 * Chart type enum matching Flutter's ChartTypePB
 */
export enum ChartType {
  Bar = 0,
  Line = 1,
  HorizontalBar = 2,
  Donut = 3,
  /** Single KPI tile: one aggregated value over all filtered rows. */
  Number = 4,
}

/**
 * Display format for the Number chart value.
 * - `auto`: follow the Y field's number format (currency, percent, ...) when
 *   it is a Number field, otherwise a grouped decimal.
 * - `compact`: abbreviated notation (1.2K, 3.4M).
 * - `percent`: treat the value as a ratio (0.25 → 25%), like the Number
 *   field's Percent format.
 */
export type ChartNumberFormat = 'auto' | 'compact' | 'percent';

export const CHART_NUMBER_FORMATS: readonly ChartNumberFormat[] = ['auto', 'compact', 'percent'];

export const DEFAULT_CHART_NUMBER_FORMAT: ChartNumberFormat = 'auto';

export function parseChartNumberFormat(value: unknown): ChartNumberFormat {
  return (CHART_NUMBER_FORMATS as readonly unknown[]).includes(value)
    ? (value as ChartNumberFormat)
    : DEFAULT_CHART_NUMBER_FORMAT;
}

/**
 * Chart aggregation type enum matching Flutter's ChartAggregationTypePB
 */
export enum ChartAggregationType {
  Count = 0,
  Sum = 1,
  Average = 2,
  Min = 3,
  Max = 4,
  Median = 5,
  CountValues = 6,
}

/**
 * Chart layout settings matching Flutter's ChartLayoutSettingPB
 * Stored in YJS under layout_settings with key '3' (Chart layout enum value)
 */
export interface ChartLayoutSettings {
  chartType: ChartType;
  xFieldId: string;
  showEmptyValues: boolean;
  aggregationType: ChartAggregationType;
  yFieldId?: string;
  cumulative: boolean;
  dateCondition: DateGroupCondition;
  /** Number chart only: how the value is formatted. Defaults to `auto`. */
  numberFormat?: ChartNumberFormat;
  /** Number chart only: custom title. Empty/undefined uses the generated title. */
  titleText?: string;
}

/**
 * Computed chart data item for rendering
 */
export interface ChartDataItem {
  /** Category label (e.g., "Completed", "In Progress", "No Status") */
  label: string;
  /** Aggregated value (count/sum/avg/min/max) */
  value: number;
  /** Row IDs in this category (for drill-down) */
  rowIds: RowId[];
  /** Color from SelectOption or default palette */
  color?: string;
  /** True for "No {field}" category */
  isEmptyCategory?: boolean;
}

/**
 * Default color palette for charts (matching Flutter implementation)
 */
export const CHART_COLORS = [
  '#5B8FF9', // Blue
  '#5AD8A6', // Green
  '#5D7092', // Gray-blue
  '#F6BD16', // Yellow
  '#E86452', // Red
  '#6DC8EC', // Cyan
  '#945FB9', // Purple
  '#FF9845', // Orange
  '#1E9493', // Teal
  '#FF99C3', // Pink
];

/**
 * Color for empty category (No {field})
 */
export const EMPTY_VALUE_COLOR = '#BFBFBF';

/**
 * Checkbox-specific colors
 */
export const CHECKBOX_CHECKED_COLOR = '#5AD8A6'; // Green
export const CHECKBOX_UNCHECKED_COLOR = '#BFBFBF'; // Gray

/**
 * YJS keys for chart layout settings.
 * The base keys are the snake_case names of collab's `ChartLayoutSetting`,
 * which the server and desktop read and write (`date_condition` and
 * `cumulative` sit beside it the same way). `numberFormat` and `titleText`
 * are camelCase on every client.
 */
export const ChartLayoutKeys = {
  chartType: 'chart_type',
  xFieldId: 'x_field_id',
  showEmptyValues: 'show_empty_values',
  aggregationType: 'aggregation_type',
  yFieldId: 'y_field_id',
  cumulative: 'cumulative',
  dateCondition: 'date_condition',
  numberFormat: 'numberFormat',
  titleText: 'titleText',
} as const;

export type ChartLayoutField = keyof typeof ChartLayoutKeys;

/**
 * camelCase keys earlier web builds wrote instead of the collab names.
 * Readers fall back to them for charts saved by those builds, and writers
 * keep them in sync so those builds still see charts saved now.
 */
export const LEGACY_CHART_LAYOUT_KEYS: Partial<Record<ChartLayoutField, string>> = {
  chartType: 'chartType',
  xFieldId: 'xFieldId',
  showEmptyValues: 'showEmptyValues',
  aggregationType: 'aggregationType',
  yFieldId: 'yFieldId',
  dateCondition: 'dateCondition',
};

/** Reads a chart setting from its collab key, falling back to the legacy web key. */
export function readChartLayoutValue(map: { get(key: string): unknown }, field: ChartLayoutField): unknown {
  const value = map.get(ChartLayoutKeys[field]);
  const legacyKey = LEGACY_CHART_LAYOUT_KEYS[field];

  return value === undefined && legacyKey ? map.get(legacyKey) : value;
}

/** Writes a chart setting under its collab key and, while old web builds are around, its legacy key. */
export function writeChartLayoutValue(
  map: { set(key: string, value: unknown): unknown },
  field: ChartLayoutField,
  value: unknown
) {
  const legacyKey = LEGACY_CHART_LAYOUT_KEYS[field];

  map.set(ChartLayoutKeys[field], value);
  if (legacyKey) map.set(legacyKey, value);
}

/**
 * Projects the persisted chart map onto `ChartLayoutSettings`. Numbers may be
 * stored as JS numbers (web) or bigints (desktop), and are cast to the enum
 * types here so consumers don't have to project again.
 */
export function parseChartLayoutSettings(map: { get(key: string): unknown }): ChartLayoutSettings {
  const read = (field: ChartLayoutField) => readChartLayoutValue(map, field);
  // Persisted Yjs cells may be missing for fields that haven't been
  // explicitly written yet (e.g. only the aggregation was changed).
  // Apply desktop-parity defaults for those — most importantly
  // `showEmptyValues = true`, otherwise an empty grid renders "No data"
  // instead of a single "No <field>" bar after a partial write.
  const showEmptyRaw = read('showEmptyValues');
  // `DateGroupCondition.Relative` persists as `0`, so we must use an
  // undefined-only fallback — `|| 3` would silently coerce Relative back
  // to Month every time the chart loads.
  const dateConditionRaw = read('dateCondition');
  const yFieldId = read('yFieldId');

  return {
    chartType: Number(read('chartType') || 0) as ChartType,
    xFieldId: String(read('xFieldId') || ''),
    showEmptyValues: showEmptyRaw === undefined ? true : Boolean(showEmptyRaw),
    aggregationType: Number(read('aggregationType') || 0) as ChartAggregationType,
    yFieldId: yFieldId ? String(yFieldId) : undefined,
    cumulative: Boolean(read('cumulative')),
    dateCondition: (dateConditionRaw === undefined || dateConditionRaw === null
      ? DateGroupCondition.Month
      : Number(dateConditionRaw)) as DateGroupCondition,
    numberFormat: parseChartNumberFormat(read('numberFormat')),
    titleText: String(read('titleText') ?? ''),
  };
}

/**
 * Layout settings key for Chart (DatabaseViewLayout.Chart = 3)
 */
export const CHART_LAYOUT_SETTINGS_KEY = '3';

/**
 * Field types that can be used as X-axis (grouping) fields.
 * Mirrors desktop's `is_chart_groupable_field_type`.
 */
export const GROUPABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
];

/**
 * Field types that produce date buckets when used as X-axis.
 */
export const DATE_GROUPABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.DateTime,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
];

export function isGroupableFieldType(fieldType: number): boolean {
  return (GROUPABLE_FIELD_TYPES as readonly number[]).includes(fieldType);
}

export function isDateGroupableFieldType(fieldType: number): boolean {
  return (DATE_GROUPABLE_FIELD_TYPES as readonly number[]).includes(fieldType);
}
