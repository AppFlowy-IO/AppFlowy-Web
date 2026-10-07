/**
 * The chart settings panel as data (WP11 §1.1, §1.13), pinned by
 * `dashboard-parity/chart-panel.json` on both clients: which sections and
 * rows a chart shows, and which keys each panel action writes.
 */
import { ChartType } from '../chart-enums';
import { FieldType } from '../database.type';

import { defaultAggregationFor, effectiveChartAggregation, supportsCumulative, supportsDecimalPlaces } from './aggregate';
import { isChartDateFieldType } from './group-keys';

export type ChartPanelSectionId = 'type' | 'title' | 'x' | 'y' | 'data' | 'style';

export type ChartPanelRowId =
  | 'chart_type'
  | 'number_title'
  | 'number_title_input'
  | 'x_what'
  | 'x_date_grouping'
  | 'x_text_grouping'
  | 'x_buckets'
  | 'x_sort'
  | 'x_groups'
  | 'x_show_empty'
  | 'y_what'
  | 'y_calculate'
  | 'y_decimals'
  | 'y_group_by'
  | 'y_group_style'
  | 'y_cumulative'
  | 'number_format'
  | 'style_color'
  | 'style_data_labels'
  | 'style_legend'
  | 'number_color';

export interface ChartPanelRow {
  id: ChartPanelRowId;
  /** English text; the UI translates `labelKey` with it as the default. */
  label: string;
  labelKey: string;
  /** Shown but not actionable (the Number card's Calculate while What to show is Count all). */
  disabled?: boolean;
}

export interface ChartPanelSection {
  id: ChartPanelSectionId;
  /** Empty for a section without a header (the Number card's title). */
  title: string;
  titleKey: string;
  rows: ChartPanelRow[];
}

export interface ChartPanelInput {
  chartType: ChartType;
  /** The resolved X property's type; null without one. */
  xType: FieldType | null;
  /** The Y property's type; null for Count all (unset, deleted or not usable). */
  yType: FieldType | null;
  /** The stored `aggregation_type`. */
  aggregation: number;
  showTitle: boolean;
  /** Whether the chart has an effective Group by (WP12): bar charts then show the Group style row. */
  groupBy?: boolean;
}

const ROW_LABELS: Record<ChartPanelRowId, [string, string]> = {
  chart_type: ['chart.settings.chartType', 'Chart type'],
  number_title: ['chart.settings.chartTitle', 'Chart title'],
  number_title_input: ['chart.settings.chartTitle', 'Chart title'],
  x_what: ['chart.settings.whatToShow', 'What to show'],
  x_date_grouping: ['chart.settings.dateGrouping', 'Date grouping'],
  x_text_grouping: ['chart.settings.groupByText', 'Group by text'],
  x_buckets: ['chart.settings.ranges', 'Ranges'],
  x_sort: ['chart.settings.sortBy', 'Sort by'],
  x_groups: ['chart.settings.groups', 'Groups'],
  x_show_empty: ['chart.showEmptyValues', 'Show empty values'],
  y_what: ['chart.settings.whatToShow', 'What to show'],
  y_calculate: ['chart.settings.calculate', 'Calculate'],
  y_decimals: ['chart.settings.decimalPlaces', 'Decimal places'],
  y_group_by: ['chart.settings.groupBy', 'Group by'],
  y_group_style: ['chart.settings.groupStyle', 'Group style'],
  y_cumulative: ['chart.settings.cumulative', 'Cumulative'],
  number_format: ['chart.settings.format', 'Format'],
  style_color: ['chart.settings.color', 'Color'],
  style_data_labels: ['chart.settings.dataLabels', 'Data labels'],
  style_legend: ['chart.settings.legend', 'Legend'],
  number_color: ['chart.settings.color', 'Color'],
};

const SECTION_TITLES: Record<ChartPanelSectionId, [string, string]> = {
  type: ['chart.settings.chartType', 'Chart type'],
  title: ['', ''],
  x: ['chart.settings.xAxis', 'X axis'],
  y: ['chart.settings.yAxis', 'Y axis'],
  data: ['chart.settings.data', 'Data'],
  style: ['chart.settings.style', 'Style'],
};

function row(id: ChartPanelRowId, extra?: Partial<ChartPanelRow>): ChartPanelRow {
  const [labelKey, label] = ROW_LABELS[id];

  return { id, label, labelKey, ...extra };
}

function section(id: ChartPanelSectionId, rows: ChartPanelRow[], titleOverride?: ChartPanelSectionId): ChartPanelSection {
  const [titleKey, title] = SECTION_TITLES[titleOverride ?? id];

  return { id, title, titleKey, rows };
}

/** The X grouping rows that apply to the X type: date grouping, text grouping or ranges. */
function xGroupingRows(xType: FieldType | null): ChartPanelRow[] {
  if (xType === null) return [];
  if (isChartDateFieldType(xType)) return [row('x_date_grouping')];
  if (xType === FieldType.RichText || xType === FieldType.URL) return [row('x_text_grouping')];
  if (xType === FieldType.Number) return [row('x_buckets')];
  return [];
}

/**
 * The Group by rows of the value section (WP12 §2.11): Group by for bar and
 * line charts, Group style for bar charts with an effective Group by.
 */
function groupByRows(chartType: ChartType, groupBy: boolean): ChartPanelRow[] {
  if (chartType === ChartType.Line) return [row('y_group_by')];
  if (chartType === ChartType.Bar || chartType === ChartType.HorizontalBar) {
    return groupBy ? [row('y_group_by'), row('y_group_style')] : [row('y_group_by')];
  }

  return [];
}

/** The sections and rows of the panel's root page for one chart. */
export function buildChartPanelModel(input: ChartPanelInput): ChartPanelSection[] {
  const { chartType, xType, yType, aggregation, showTitle, groupBy = false } = input;
  const effective = effectiveChartAggregation(aggregation, yType);
  const typeSection = section('type', [row('chart_type')]);
  const decimals = supportsDecimalPlaces(effective) ? [row('y_decimals')] : [];
  const calculate = yType !== null ? [row('y_calculate')] : [];
  const showEmpty = xType === FieldType.Checkbox ? [] : [row('x_show_empty')];

  if (chartType === ChartType.Number) {
    return [
      typeSection,
      section('title', [row('number_title'), ...(showTitle ? [row('number_title_input')] : [])]),
      section('data', [
        row('y_what'),
        row('y_calculate', yType === null ? { disabled: true } : undefined),
        row('number_format'),
        ...decimals,
      ]),
      section('style', [row('number_color')]),
    ];
  }

  if (chartType === ChartType.Donut) {
    return [
      typeSection,
      section('data', [
        row('x_what'),
        ...xGroupingRows(xType),
        row('y_what', { label: 'Each slice represents', labelKey: 'chart.settings.eachSliceRepresents' }),
        ...calculate,
        ...decimals,
        row('x_sort'),
        row('x_groups'),
        ...showEmpty,
      ]),
      section('style', [row('style_color'), row('style_legend')]),
    ];
  }

  const xRows = [row('x_what'), ...xGroupingRows(xType), row('x_sort'), row('x_groups'), ...showEmpty];
  const yRows = [
    row('y_what'),
    ...calculate,
    ...decimals,
    ...groupByRows(chartType, groupBy),
    ...(supportsCumulative(effective, chartType) ? [row('y_cumulative')] : []),
  ];
  const style = section('style', [row('style_color'), row('style_data_labels'), row('style_legend')]);

  // A horizontal bar draws values across: the value section comes first and is called "X axis".
  if (chartType === ChartType.HorizontalBar) {
    return [typeSection, section('y', yRows, 'x'), section('x', xRows, 'y'), style];
  }

  return [typeSection, section('x', xRows), section('y', yRows), style];
}

/** The stored keys `chartPatchFor` reads. */
export interface ChartPanelCurrent {
  x_sort?: string;
  aggregation_type?: number;
  /** The stored Group by property (WP12); picking it as X clears it. */
  group_by_field_id?: string;
}

/** One user action of the panel. */
export type ChartPanelAction =
  | { kind: 'chart_type'; value: number }
  | { kind: 'x_field'; value: string }
  | { kind: 'date_grouping'; value: number }
  | { kind: 'text_grouping'; value: string }
  | { kind: 'buckets'; size: number | null; min: number | null; max: number | null }
  | { kind: 'sort'; value: string }
  | { kind: 'hidden_groups'; value: string[] }
  | { kind: 'drop_groups'; value: string[] }
  | { kind: 'y_count_all' }
  | { kind: 'y_field'; value: string; fieldType: FieldType }
  | { kind: 'calculate'; value: number }
  | { kind: 'cumulative'; value: boolean }
  | { kind: 'show_empty'; value: boolean }
  | { kind: 'show_title'; value: boolean }
  | { kind: 'title_text'; value: string }
  | { kind: 'number_format'; value: string }
  | { kind: 'number_color'; value: string }
  | { kind: 'conditional_color'; value: Record<string, unknown> | null }
  | { kind: 'color_theme'; value: string }
  | { kind: 'show_data_labels'; value: boolean }
  | { kind: 'legend_position'; value: string }
  | { kind: 'decimal_places'; value: number | null }
  | { kind: 'group_by'; value: string }
  | { kind: 'group_by_date'; field: string; value: number }
  | { kind: 'group_style'; value: string };

/** Picking a new grouping clears what belonged to the old groups. */
function groupingReset(current: ChartPanelCurrent): Record<string, unknown> {
  return {
    hidden_groups: [],
    x_manual_order: [],
    ...(current.x_sort === 'manual' ? { x_sort: 'auto' } : {}),
  };
}

/**
 * The persisted keys one panel action writes, in one transaction (WP11 §1.13).
 * "Clear to default" is `null`.
 */
export function chartPatchFor(action: ChartPanelAction, current: ChartPanelCurrent): Record<string, unknown> {
  switch (action.kind) {
    case 'chart_type':
      return { chart_type: action.value };
    case 'x_field':
      // The Group by property cannot also be X: picking it as X clears the Group by in the same write.
      return {
        x_field_id: action.value,
        ...groupingReset(current),
        ...(current.group_by_field_id && current.group_by_field_id === action.value ? { group_by_field_id: '' } : {}),
      };
    case 'date_grouping':
      return { date_condition: action.value, ...groupingReset(current) };
    case 'text_grouping':
      return { x_text_grouping: action.value, ...groupingReset(current) };
    case 'buckets':
      return {
        x_number_bucket_size: action.size,
        x_number_bucket_min: action.min,
        x_number_bucket_max: action.max,
        ...groupingReset(current),
      };
    case 'sort':
      return { x_sort: action.value };
    case 'hidden_groups':
      return { hidden_groups: action.value };
    case 'drop_groups':
      return { x_sort: 'manual', x_manual_order: action.value };
    case 'y_count_all':
      return { aggregation_type: 0, y_field_id: '' };
    case 'y_field':
      return {
        y_field_id: action.value,
        aggregation_type: defaultAggregationFor(action.fieldType, current.aggregation_type ?? 0),
      };
    case 'calculate':
      return action.value === 0 ? { aggregation_type: 0, y_field_id: '' } : { aggregation_type: action.value };
    case 'cumulative':
      return { cumulative: action.value };
    case 'show_empty':
      return { show_empty_values: action.value };
    case 'show_title':
      return { show_title: action.value };
    case 'title_text':
      return { titleText: action.value };
    case 'number_format':
      return { numberFormat: action.value };
    case 'number_color':
      return { number_color: action.value };
    case 'conditional_color':
      return { number_conditional_color: action.value };
    case 'color_theme':
      return { color_theme: action.value };
    case 'show_data_labels':
      return { show_data_labels: action.value };
    case 'legend_position':
      return { legend_position: action.value };
    case 'decimal_places':
      return { decimal_places: action.value };
    case 'group_by':
      return { group_by_field_id: action.value };
    case 'group_by_date':
      // A date grouping of the Group by property writes only the grouping; of another property, both.
      return current.group_by_field_id === action.field
        ? { group_by_date_condition: action.value }
        : { group_by_field_id: action.field, group_by_date_condition: action.value };
    case 'group_style':
      return { group_style: action.value };
    default:
      return {};
  }
}
