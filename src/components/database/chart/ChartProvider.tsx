import React, { useCallback, useMemo, useState } from 'react';

import { ChartAggregationType, ChartDataItem, ChartType } from '@/application/database-yjs/chart.type';
import { useChartData, useChartSettings } from '@/components/database/chart/hooks';
import { ChartContext, ChartContextValue } from '@/components/database/chart/useChartContext';
import ChartRowListPopup from './ChartRowListPopup';

interface ChartProviderProps {
  children: React.ReactNode;
}

export function ChartProvider({ children }: ChartProviderProps) {
  const settings = useChartSettings();
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
