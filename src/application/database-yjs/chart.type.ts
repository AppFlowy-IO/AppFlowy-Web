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
  /**
   * Desktop's "Omit zero values" toggle, persisted as `show_empty_values`.
   * Despite the stored name, desktop's chart compute path and mobile settings
   * panel treat `true` as "hide the No {field} bucket", so the web does too.
   */
  omitEmptyValues: boolean;
  aggregationType: ChartAggregationType;
  yFieldId?: string;
  dateCondition: DateGroupCondition;
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
  /**
   * Fixed fill color: the option's tag fill color or a checkbox color. Left
   * undefined for every other category, which takes the palette color for its
   * index in the list a widget renders (`resolveChartItemColor`), like desktop.
   */
  color?: string;
  /**
   * Text color for labels drawn in the category's color (donut leader labels):
   * the option's tag text color. Falls back to the fill color.
   */
  textColor?: string;
  /** True for "No {field}" category */
  isEmptyCategory?: boolean;
}

/**
 * A chart item handed to a click handler: the widget that rendered it adds
 * the fill color it drew, so the drill-down popup needs no palette lookup.
 */
export type ChartClickItem = ChartDataItem & { color: string };

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
 * Checkbox-specific colors (desktop's `ChartColorUtils`)
 */
export const CHECKBOX_CHECKED_COLOR = '#5AD8A6'; // Green
export const CHECKBOX_UNCHECKED_COLOR = '#8F959E'; // Gray

/**
 * YJS keys for chart layout settings. These are the keys desktop writes: the
 * collab `ChartLayoutSetting` fields plus the `date_condition` and
 * `aggregation_type_pb` sidecars, which desktop only reads as BigInt.
 */
export const ChartLayoutKeys = {
  chartType: 'chart_type',
  xFieldId: 'x_field_id',
  showEmptyValues: 'show_empty_values',
  aggregationType: 'aggregation_type',
  aggregationTypePb: 'aggregation_type_pb',
  yFieldId: 'y_field_id',
  dateCondition: 'date_condition',
} as const;

/**
 * camelCase keys written by web builds that predate desktop key parity.
 * Read only, as a fallback for maps that have no desktop keys yet.
 */
export const LegacyChartLayoutKeys = {
  chartType: 'chartType',
  xFieldId: 'xFieldId',
  showEmptyValues: 'showEmptyValues',
  aggregationType: 'aggregationType',
  yFieldId: 'yFieldId',
  cumulative: 'cumulative',
  dateCondition: 'dateCondition',
} as const;

/**
 * Layout settings key for Chart (DatabaseViewLayout.Chart = 3)
 */
export const CHART_LAYOUT_SETTINGS_KEY = '3';

/**
 * Mirrors desktop's `parse_chart_aggregation_type_pb`: maps the
 * `aggregation_type_pb` sidecar to the full 7-variant enum and returns null
 * for unknown values so callers fall back to the downgraded typed value.
 */
export function parseChartAggregationTypePb(value: number): ChartAggregationType | null {
  if (!Number.isInteger(value) || value < ChartAggregationType.Count || value > ChartAggregationType.CountValues) {
    return null;
  }

  return value as ChartAggregationType;
}

/**
 * The collab-side `ChartAggregationType` only knows Count/Sum/Average/Min/Max.
 * Desktop downgrades Median and CountValues to Count before writing
 * `aggregation_type`; an out-of-range value there makes desktop's serde
 * decode fail and reset the whole chart setting to defaults.
 */
export function toCollabChartAggregationType(type: ChartAggregationType): ChartAggregationType {
  return type === ChartAggregationType.Median || type === ChartAggregationType.CountValues
    ? ChartAggregationType.Count
    : type;
}

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

/**
 * Field types that can feed a non-Count aggregation (desktop's
 * `_filterYAxisFields`).
 */
export const Y_AXIS_FIELD_TYPES: readonly FieldType[] = [FieldType.Number, FieldType.Checkbox, FieldType.DateTime];

export function isGroupableFieldType(fieldType: number): boolean {
  return (GROUPABLE_FIELD_TYPES as readonly number[]).includes(fieldType);
}

export function isDateGroupableFieldType(fieldType: number): boolean {
  return (DATE_GROUPABLE_FIELD_TYPES as readonly number[]).includes(fieldType);
}

export function isYAxisFieldType(fieldType: number): boolean {
  return (Y_AXIS_FIELD_TYPES as readonly number[]).includes(fieldType);
}
