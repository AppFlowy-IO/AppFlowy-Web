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
  showEmptyValues: boolean;
  aggregationType: ChartAggregationType;
  yFieldId?: string;
  cumulative: boolean;
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
 * YJS keys for chart layout settings
 * These match the protobuf field names (camelCase)
 */
export const ChartLayoutKeys = {
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
