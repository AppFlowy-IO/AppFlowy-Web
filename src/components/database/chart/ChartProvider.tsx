import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChartLayoutSetting } from '@/application/database-yjs';
import { ChartXFieldKind, resolveCategoryColors } from '@/application/database-yjs/chart-colors';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartType,
  isDateGroupableFieldType,
  resolveChartStyle,
} from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { useChartData, useChartFormatter } from '@/components/database/chart/hooks';
import { ChartContext, ChartContextValue } from '@/components/database/chart/useChartContext';
import { chartDataEqual } from '@/components/database/chart/widgets/chartUtils';
import { getNumberChartTitle } from '@/components/database/chart/widgets/numberChartUtils';
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
    selectOptions,
    fieldType,
    hasGroupableFields,
    yAxisField,
    yFieldName,
    yNumberFormat,
    numberValue,
    loadError,
    retry,
  } = useChartData({ settings });
  const isDark = Boolean(useContext(ThemeModeContext)?.isDark);
  const style = resolveChartStyle(settings);
  const aggregationType = settings?.aggregationType ?? ChartAggregationType.Count;

  // Colors come from the item metadata at render time, so a theme change never recomputes the data.
  // The same content keeps the same array: rows hydrating in batches then neither re-render the
  // chart nor restart its entry animation.
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
    aggregationType,
    yAxisField,
    yNumberFormat,
    decimalPlaces: style.decimalPlaces,
    numberFormat: settings?.numberFormat,
  });
  const seriesLabel = useMemo(
    () => getNumberChartTitle(t, { aggregationType, yFieldName, hasYField: Boolean(yAxisField) }),
    [t, aggregationType, yFieldName, yAxisField]
  );

  // Drill-down state
  const [drillDownItem, setDrillDownItem] = useState<ChartDataItem | null>(null);

  const handleElementClick = useCallback((item: ChartDataItem) => {
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
      fieldType,
      aggregationType,
      selectOptions,
      hasGroupableFields,
      yAxisField,
      yFieldName,
      yNumberFormat,
      numberValue,
      style,
      format,
      seriesLabel,
      loadError,
      retry,
      isDark,
      onElementClick: handleElementClick,
    }),
    [
      settings,
      coloredData,
      isLoading,
      xAxisField,
      fieldType,
      aggregationType,
      selectOptions,
      hasGroupableFields,
      yAxisField,
      yFieldName,
      yNumberFormat,
      numberValue,
      style,
      format,
      seriesLabel,
      loadError,
      retry,
      isDark,
      handleElementClick,
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
