import { DateGroupCondition } from '@/application/database-yjs/database.type';

/** A date grouping the panel offers: its value, translation key and English fallback. */
export interface ChartDateConditionOption {
  value: DateGroupCondition;
  labelKey: string;
  fallback: string;
}

const MONTH: ChartDateConditionOption = {
  value: DateGroupCondition.Month,
  labelKey: 'chart.dateGrouping.month',
  fallback: 'Month',
};

/**
 * The date groupings of a date property, in the order the X axis and the
 * Group by pages list them (desktop keeps the same single list).
 */
export const CHART_DATE_CONDITIONS: readonly ChartDateConditionOption[] = [
  { value: DateGroupCondition.Relative, labelKey: 'chart.dateGrouping.relative', fallback: 'Relative' },
  { value: DateGroupCondition.Day, labelKey: 'chart.dateGrouping.day', fallback: 'Day' },
  { value: DateGroupCondition.Week, labelKey: 'chart.dateGrouping.week', fallback: 'Week' },
  MONTH,
  { value: DateGroupCondition.Year, labelKey: 'chart.dateGrouping.year', fallback: 'Year' },
];

/** The option of `value`; Month, the chart's default grouping, for a value the panel does not offer. */
export function chartDateConditionOption(value: number): ChartDateConditionOption {
  return CHART_DATE_CONDITIONS.find((option) => option.value === value) ?? MONTH;
}
