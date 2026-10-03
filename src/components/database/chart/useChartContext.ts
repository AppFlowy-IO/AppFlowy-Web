import { createContext, useContext } from 'react';

import {
  ChartExtendedSettings,
  DEFAULT_CHART_EXTENDED_SETTINGS,
} from '@/application/database-yjs/chart-extended-settings';
import { ChartValueFormatter, ChartValueMode, formatChartValue } from '@/application/database-yjs/chart-format';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  ChartType,
} from '@/application/database-yjs/chart.type';
import { YDatabaseField } from '@/application/types';

export interface ChartContextValue {
  /** Current chart type */
  chartType: ChartType;
  /** Chart layout settings */
  settings: ChartLayoutSettings | null;
  /** Computed chart data, colored for the current theme */
  chartData: ChartDataItem[];
  /** Whether data is loading */
  isLoading: boolean;
  /** X-axis field */
  xAxisField: YDatabaseField | null;
  /**
   * What the chart computes, formats and titles: Count unless a value
   * aggregation has its Y field (`resolveEffectiveAggregation`). Resolved once,
   * in `useChartData`; nothing below the provider re-derives it.
   */
  effectiveAggregation: ChartAggregationType;
  /** Whether there are any groupable fields in the database */
  hasGroupableFields: boolean;
  /** The style settings (WP10), defaults applied */
  style: ChartExtendedSettings;
  /** R-FORMAT for this chart's aggregation, Y field, decimal places and language */
  format: ChartValueFormatter;
  /** The generated name of what the chart shows ("Count all", "Sum of Amount"): the line legend, the Number title */
  seriesLabel: string;
  /** The rows failed to load and the chart has none to show */
  loadError: boolean;
  /** Retry the rows that failed to load */
  retry: () => void;
  isDark: boolean;
  /** Opens the drill-down of a chart item */
  onItemClick?: (item: ChartDataItem) => void;
}

/** Outside a provider (tests, previews): a plain Sum in US English. */
function defaultFormat(value: number, mode: ChartValueMode) {
  return formatChartValue(value, { aggregation: ChartAggregationType.Sum, mode, locale: 'en-US' });
}

/** The value outside a provider; tests spread it to stub a chart. */
export const DEFAULT_CHART_CONTEXT: ChartContextValue = {
  chartType: ChartType.Bar,
  settings: null,
  chartData: [],
  isLoading: true,
  xAxisField: null,
  effectiveAggregation: ChartAggregationType.Count,
  hasGroupableFields: false,
  style: DEFAULT_CHART_EXTENDED_SETTINGS,
  format: defaultFormat,
  seriesLabel: '',
  loadError: false,
  retry: () => undefined,
  isDark: false,
};

export const ChartContext = createContext<ChartContextValue>(DEFAULT_CHART_CONTEXT);

/** The chart context; `DEFAULT_CHART_CONTEXT` outside a `ChartProvider`. */
export function useChartContext() {
  return useContext(ChartContext);
}

export default useChartContext;
