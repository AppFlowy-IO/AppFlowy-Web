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
  ChartSeriesData,
  ChartType,
  EMPTY_CHART_SERIES_DATA,
} from '@/application/database-yjs/chart.type';
import { YDatabaseField } from '@/application/types';
import { ChartSeriesStyle } from '@/components/database/chart/hooks/chartGroupBy';
import { ChartColorPainter, paintChartColor } from '@/components/database/chart/hooks/chartSeries';
import { FALLBACK_INTL_LOCALE } from '@/i18n/intl-locale';

export interface ChartContextValue {
  /** Current chart type */
  chartType: ChartType;
  /** Chart layout settings */
  settings: ChartLayoutSettings | null;
  /** What bar, line and donut charts draw (WP12): categories and series, colours unpainted. */
  seriesData: ChartSeriesData;
  /** The Number chart's value; `null` while there is none (and for other charts). */
  numberItem: ChartDataItem | null;
  /** The effective Group by property, or `null`. */
  groupByField: YDatabaseField | null;
  /** Whether the chart splits its categories into Group by series. */
  hasGroupBy: boolean;
  /** What the series draw with: the group style of a bar chart with a Group by, `none` otherwise. */
  groupStyle: ChartSeriesStyle;
  /** Paints a series builder colour for the current theme. */
  paint: ChartColorPainter;
  /** Whether data is loading */
  isLoading: boolean;
  /** X-axis field */
  xAxisField: YDatabaseField | null;
  /**
   * What the chart computes, formats and titles: Count unless a value
   * aggregation has its Y field (`effectiveChartAggregation`). Resolved once,
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
  /** The Number chart's caption as the card shows it (`getNumberChartTitle`): the custom title, else `seriesLabel`. It titles its drill-down too. */
  numberTitle: string;
  /**
   * The mobile context (`useMobileContext`, WP14 §1.4.6): taps replace hover,
   * so a first tap shows a category's tooltip and a second tap drills.
   */
  mobile: boolean;
  /** The rows failed to load and the chart has none to show */
  loadError: boolean;
  /** Retry the rows that failed to load */
  retry: () => void;
  isDark: boolean;
  /** Opens the drill-down (`ChartDrillDialog`) of a chart item: a category, a segment, or the Number card's value */
  onItemClick?: (item: ChartDataItem) => void;
}

/** Outside a provider (tests, previews): a plain Sum in the fallback locale (`toIntlLocale` of no language). */
function defaultFormat(value: number, mode: ChartValueMode) {
  return formatChartValue(value, { aggregation: ChartAggregationType.Sum, mode, locale: FALLBACK_INTL_LOCALE });
}

/** The value outside a provider; tests spread it to stub a chart. */
export const DEFAULT_CHART_CONTEXT: ChartContextValue = {
  chartType: ChartType.Bar,
  settings: null,
  seriesData: EMPTY_CHART_SERIES_DATA,
  numberItem: null,
  groupByField: null,
  hasGroupBy: false,
  groupStyle: 'none',
  paint: (color) => paintChartColor(color, false),
  isLoading: true,
  xAxisField: null,
  effectiveAggregation: ChartAggregationType.Count,
  hasGroupableFields: false,
  style: DEFAULT_CHART_EXTENDED_SETTINGS,
  format: defaultFormat,
  seriesLabel: '',
  numberTitle: '',
  mobile: false,
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
