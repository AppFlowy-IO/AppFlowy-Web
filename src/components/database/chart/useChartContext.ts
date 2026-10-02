import { createContext, useContext } from 'react';

import {
  ChartExtendedSettings,
  DEFAULT_CHART_EXTENDED_SETTINGS,
} from '@/application/database-yjs/chart-extended-settings';
import { ChartValueMode, formatChartValue } from '@/application/database-yjs/chart-format';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  ChartType,
} from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { NumberFormat, SelectOption } from '@/application/database-yjs/fields';
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
  /** X-axis field type */
  fieldType: FieldType | null;
  /** Aggregation type */
  aggregationType: ChartAggregationType;
  /** Select options for x-axis field (if applicable) */
  selectOptions: SelectOption[];
  /** Whether there are any groupable fields in the database */
  hasGroupableFields: boolean;
  /** Y field (only when the aggregation uses one) */
  yAxisField: YDatabaseField | null;
  /** Current Y field name */
  yFieldName: string;
  /** Y field number format when the Y field is a Number field */
  yNumberFormat: NumberFormat | null;
  /** Number chart only: aggregated value over all filtered rows */
  numberValue: number | null;
  /** The style settings (WP10), defaults applied */
  style: ChartExtendedSettings;
  /** R-FORMAT for this chart's aggregation, Y field, decimal places and language */
  format: (value: number, mode: ChartValueMode) => string;
  /** The single series' name ("Count all", "Sum of Amount"), for line legends */
  seriesLabel: string;
  /** Every row failed to load */
  loadError: boolean;
  /** Retry the rows that failed to load */
  retry: () => void;
  isDark: boolean;
  /** Callback when a chart element is clicked (for drill-down) */
  onElementClick?: (item: ChartDataItem) => void;
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
  fieldType: null,
  aggregationType: ChartAggregationType.Count,
  selectOptions: [],
  hasGroupableFields: false,
  yAxisField: null,
  yFieldName: '',
  yNumberFormat: null,
  numberValue: null,
  style: DEFAULT_CHART_EXTENDED_SETTINGS,
  format: defaultFormat,
  seriesLabel: '',
  loadError: false,
  retry: () => undefined,
  isDark: false,
};

export const ChartContext = createContext<ChartContextValue>(DEFAULT_CHART_CONTEXT);

export function useChartContext() {
  const context = useContext(ChartContext);

  if (!context) {
    throw new Error('useChartContext must be used within a ChartProvider');
  }

  return context;
}

export default useChartContext;
