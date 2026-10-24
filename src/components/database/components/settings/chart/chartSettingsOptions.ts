import { ChartAggregationType, ChartType } from '@/application/database-yjs/chart.type';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import { ReactComponent as ChartBarIcon } from '@/assets/icons/chart_bar.svg';
import { ReactComponent as ChartDonutIcon } from '@/assets/icons/chart_donut.svg';
import { ReactComponent as ChartHorizontalBarIcon } from '@/assets/icons/chart_horizontal_bar.svg';
import { ReactComponent as ChartLineIcon } from '@/assets/icons/chart_line.svg';

// Order matches desktop's `ChartTypeGrid`. `slug` feeds the data-testids.
export const CHART_TYPE_OPTIONS = [
  { type: ChartType.Bar, slug: 'bar', labelKey: 'chart.barChart', fallback: 'Bar', Icon: ChartBarIcon },
  {
    type: ChartType.HorizontalBar,
    slug: 'horizontal-bar',
    labelKey: 'chart.horizontalBarChart',
    fallback: 'Horizontal Bar',
    Icon: ChartHorizontalBarIcon,
  },
  { type: ChartType.Line, slug: 'line', labelKey: 'chart.lineChart', fallback: 'Line', Icon: ChartLineIcon },
  { type: ChartType.Donut, slug: 'donut', labelKey: 'chart.donutChart', fallback: 'Donut', Icon: ChartDonutIcon },
] as const;

export type ChartTypeOption = (typeof CHART_TYPE_OPTIONS)[number];

// Order matches desktop's `_buildAggregationItems` in chart_layout_setting.dart.
export const AGGREGATION_OPTIONS = [
  { type: ChartAggregationType.Count, slug: 'count', labelKey: 'chart.tooltip.count', fallback: 'Count' },
  {
    type: ChartAggregationType.CountUnique,
    slug: 'count-values',
    labelKey: 'chart.tooltip.countValues',
    fallback: 'Count values',
  },
  { type: ChartAggregationType.Sum, slug: 'sum', labelKey: 'chart.tooltip.sum', fallback: 'Sum' },
  { type: ChartAggregationType.Average, slug: 'average', labelKey: 'chart.tooltip.average', fallback: 'Average' },
  { type: ChartAggregationType.Min, slug: 'min', labelKey: 'chart.tooltip.min', fallback: 'Min' },
  { type: ChartAggregationType.Max, slug: 'max', labelKey: 'chart.tooltip.max', fallback: 'Max' },
  { type: ChartAggregationType.Median, slug: 'median', labelKey: 'chart.tooltip.median', fallback: 'Median' },
] as const;

// Order matches desktop's `ChartDateConditionList`.
export const DATE_CONDITION_OPTIONS = [
  {
    value: DateGroupCondition.Relative,
    slug: 'relative',
    labelKey: 'chart.dateGrouping.relative',
    fallback: 'Relative',
  },
  { value: DateGroupCondition.Day, slug: 'day', labelKey: 'chart.dateGrouping.day', fallback: 'Day' },
  { value: DateGroupCondition.Week, slug: 'week', labelKey: 'chart.dateGrouping.week', fallback: 'Week' },
  { value: DateGroupCondition.Month, slug: 'month', labelKey: 'chart.dateGrouping.month', fallback: 'Month' },
  { value: DateGroupCondition.Year, slug: 'year', labelKey: 'chart.dateGrouping.year', fallback: 'Year' },
] as const;

/**
 * Mirrors desktop's `_isPremiumChartType`: only the basic Bar chart is free.
 * On AppFlowy-hosted instances without a Pro plan, the other three are gated
 * behind an upgrade prompt. Self-hosted instances have every chart type
 * (`useSubscriptionPlan` reports `isPro = true` there).
 */
export function isPremiumChartType(type: ChartType): boolean {
  return type === ChartType.HorizontalBar || type === ChartType.Line || type === ChartType.Donut;
}
