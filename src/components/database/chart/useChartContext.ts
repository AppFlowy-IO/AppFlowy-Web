import { createContext, useContext } from 'react';

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
  /** Computed chart data */
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
  /** Callback when a chart element is clicked (for drill-down) */
  onElementClick?: (item: ChartDataItem) => void;
}

const defaultContext: ChartContextValue = {
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
};

export const ChartContext = createContext<ChartContextValue>(defaultContext);

export function useChartContext() {
  const context = useContext(ChartContext);

  if (!context) {
    throw new Error('useChartContext must be used within a ChartProvider');
  }

  return context;
}

export default useChartContext;
