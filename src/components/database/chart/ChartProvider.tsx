import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChartLayoutSetting } from '@/application/database-yjs';
import { ChartXFieldKind, resolveCategoryColors } from '@/application/database-yjs/chart-colors';
import {
  ChartDataItem,
  ChartType,
  isDateGroupableFieldType,
  resolveChartStyle,
} from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { useChartData, useChartFormatter } from '@/components/database/chart/hooks';
import { ChartContext, ChartContextValue } from '@/components/database/chart/useChartContext';
import { chartDataEqual } from '@/components/database/chart/widgets/chartUtils';
import { getChartSeriesTitle } from '@/components/database/chart/widgets/numberChartUtils';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';

import ChartRowListPopup from './ChartRowListPopup';

interface ChartProviderProps {
  children: React.ReactNode;
}

/** What the X property is, for colors: option colors apply to selects, checkbox colors to checkboxes. */
function xFieldKind(fieldType: FieldType | null): ChartXFieldKind {
  if (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect) return 'select';
  if (fieldType === FieldType.Checkbox) return 'checkbox';
  if (fieldType !== null && isDateGroupableFieldType(fieldType)) return 'date';
  return 'other';
}

export function ChartProvider({ children }: ChartProviderProps) {
  const { t } = useTranslation();
  // `useChartLayoutSetting` returns `ChartLayoutSettings | null` directly
  // (cast inside the hook), and skips equal updates via shallow compare on
  // the chart-relevant fields. So this reference is stable across unrelated
  // Yjs writes.
  const settings = useChartLayoutSetting();
  const {
    chartData,
    isLoading,
    xAxisField,
    fieldType,
    hasGroupableFields,
    effectiveAggregation,
    yFieldName,
    yFormatField,
    loadError,
    retry,
  } = useChartData({ settings });
  const isDark = Boolean(useContext(ThemeModeContext)?.isDark);
  const style = resolveChartStyle(settings);

  // Colors come from the item metadata at render time, so a theme change never recomputes the data.
  // This is the one place chart data is compared by content: the same content keeps the same array,
  // so rows hydrating in batches neither re-render the chart, restart its entry animation nor drop
  // its tooltip. The widgets and the hover below rely on that and compare the array by reference.
  const coloredDataRef = useRef<ChartDataItem[]>(chartData);
  const coloredData = useMemo(() => {
    const next = resolveCategoryColors(chartData, {
      theme: style.colorTheme,
      xFieldKind: xFieldKind(fieldType),
      isDark,
    });

    if (chartDataEqual(coloredDataRef.current, next)) return coloredDataRef.current;
    coloredDataRef.current = next;
    return next;
  }, [chartData, style.colorTheme, fieldType, isDark]);
  const format = useChartFormatter({
    aggregation: effectiveAggregation,
    yField: yFormatField,
    decimalPlaces: style.decimalPlaces,
    numberFormat: settings?.numberFormat,
  });
  const seriesLabel = useMemo(
    () => getChartSeriesTitle(t, { aggregation: effectiveAggregation, yFieldName }),
    [t, effectiveAggregation, yFieldName]
  );

  // Drill-down state
  const [drillDownItem, setDrillDownItem] = useState<ChartDataItem | null>(null);

  const handleItemClick = useCallback((item: ChartDataItem) => {
    setDrillDownItem(item);
  }, []);

  const handleCloseDrillDown = useCallback(() => {
    setDrillDownItem(null);
  }, []);

  const contextValue = useMemo<ChartContextValue>(
    () => ({
      chartType: settings?.chartType ?? ChartType.Bar,
      settings,
      chartData: coloredData,
      isLoading,
      xAxisField,
      effectiveAggregation,
      hasGroupableFields,
      style,
      format,
      seriesLabel,
      loadError,
      retry,
      isDark,
      onItemClick: handleItemClick,
    }),
    [
      settings,
      coloredData,
      isLoading,
      xAxisField,
      effectiveAggregation,
      hasGroupableFields,
      style,
      format,
      seriesLabel,
      loadError,
      retry,
      isDark,
      handleItemClick,
    ]
  );

  return (
    <ChartContext.Provider value={contextValue}>
      {children}
      {drillDownItem && <ChartRowListPopup open={!!drillDownItem} onClose={handleCloseDrillDown} item={drillDownItem} />}
    </ChartContext.Provider>
  );
}

export default ChartProvider;
