import React, { useCallback, useMemo, useState } from 'react';

import { useChartLayoutSetting } from '@/application/database-yjs';
import { ChartAggregationType, ChartDataItem, ChartType } from '@/application/database-yjs/chart.type';
import { useChartData } from '@/components/database/chart/hooks';
import { ChartContext, ChartContextValue } from '@/components/database/chart/useChartContext';

import ChartRowListPopup from './ChartRowListPopup';

interface ChartProviderProps {
  children: React.ReactNode;
}

export function ChartProvider({ children }: ChartProviderProps) {
  // `useChartLayoutSetting` returns `ChartLayoutSettings | null` directly
  // (cast inside the hook), and skips equal updates via shallow compare on
  // the chart-relevant fields. So this reference is stable across unrelated
  // Yjs writes.
  const settings = useChartLayoutSetting();
  const { chartData, isLoading, xAxisField, selectOptions, fieldType, hasGroupableFields } = useChartData({ settings });

  // Drill-down state
  const [drillDownItem, setDrillDownItem] = useState<ChartDataItem | null>(null);

  const handleElementClick = useCallback((item: ChartDataItem) => {
    setDrillDownItem(item);
  }, []);

  const handleCloseDrillDown = useCallback(() => {
    setDrillDownItem(null);
  }, []);

  const contextValue = useMemo<ChartContextValue>(() => ({
    chartType: settings?.chartType ?? ChartType.Bar,
    settings,
    chartData,
    isLoading,
    xAxisField,
    fieldType,
    aggregationType: settings?.aggregationType ?? ChartAggregationType.Count,
    selectOptions,
    hasGroupableFields,
    onElementClick: handleElementClick,
  }), [settings, chartData, isLoading, xAxisField, fieldType, selectOptions, hasGroupableFields, handleElementClick]);

  return (
    <ChartContext.Provider value={contextValue}>
      {children}
      {drillDownItem && (
        <ChartRowListPopup
          open={!!drillDownItem}
          onClose={handleCloseDrillDown}
          item={drillDownItem}
        />
      )}
    </ChartContext.Provider>
  );
}

export default ChartProvider;
