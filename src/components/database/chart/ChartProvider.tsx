import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChartLayoutSetting, useDatabaseViewId } from '@/application/database-yjs';
import { ChartXFieldKind, resolveCategoryColors } from '@/application/database-yjs/chart-colors';
import { ChartGroupSummary } from '@/application/database-yjs/chart-config';
import {
  ChartDataItem,
  ChartType,
  isDateGroupableFieldType,
  resolveChartStyle,
} from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { ChartDrillTarget, numberChartDrillTarget, toDrillTarget } from '@/application/database-yjs/drill-query';
import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';
import { clearChartGroups, setChartGroups } from '@/components/database/chart/chartGroupsRegistry';
import { ChartDrillDialog } from '@/components/database/chart/drill/ChartDrillDialog';
import { useChartData, useChartFormatter } from '@/components/database/chart/hooks';
import { effectiveGroupStyle } from '@/components/database/chart/hooks/chartGroupBy';
import { ChartColorPainter, hasSeriesGroupBy, paintChartColor } from '@/components/database/chart/hooks/chartSeries';
import { ChartContext, ChartContextValue } from '@/components/database/chart/useChartContext';
import { getChartSeriesTitle, getNumberChartTitle } from '@/components/database/chart/widgets/numberChartUtils';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';

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
    seriesData,
    numberItem,
    groupByField,
    isLoading,
    xAxisField,
    fieldType,
    hasGroupableFields,
    effectiveAggregation,
    yFieldName,
    yFormatField,
    loadError,
    retry,
    allGroups,
  } = useChartData({ settings });
  const viewId = useDatabaseViewId();
  const isDark = Boolean(useContext(ThemeModeContext)?.isDark);
  const style = resolveChartStyle(settings);
  const chartType = settings?.chartType ?? ChartType.Bar;

  // The series builder resolves colours to a hex and an opacity step; they are
  // painted for the theme here. `useChartData` keeps the previous build while
  // its content is the same, so rows hydrating in batches neither re-render
  // the chart, restart its entry animation nor drop its tooltip. The widgets
  // and the hover below rely on that and compare the build by reference.
  const paint = useCallback<ChartColorPainter>((color) => paintChartColor(color, isDark), [isDark]);
  const hasGroupBy = hasSeriesGroupBy(seriesData);
  const groupStyle = effectiveGroupStyle(chartType, hasGroupBy, style.groupStyle);

  // The Groups page shows each group's swatch: the color it is drawn with,
  // or (hidden, or split by a Group by) the color it would get, from the same assignment.
  const groupSummaries = useMemo<ChartGroupSummary[]>(() => {
    if (allGroups.length === 0) return allGroups;
    const drawn = new Map(
      seriesData.categories.flatMap((category) => {
        const color = paint(category.color);

        return color === undefined ? [] : [[category.key, color] as const];
      })
    );
    const asItems = allGroups.map<ChartDataItem>((group) => ({
      label: group.label,
      value: group.count,
      rowIds: [],
      key: group.key,
      isEmptyCategory: group.isEmpty,
      optionColor: group.optionColor,
      checkboxState: group.checkboxState,
    }));
    const every = resolveCategoryColors(asItems, { theme: style.colorTheme, xFieldKind: xFieldKind(fieldType), isDark });

    return allGroups.map((group, index) => ({ ...group, color: drawn.get(group.key) ?? every[index]?.color }));
  }, [allGroups, seriesData, paint, style.colorTheme, fieldType, isDark]);

  // The last list this chart published: unmounting clears it only if no other
  // chart of the same view has published since.
  const publishedGroupsRef = useRef<ChartGroupSummary[] | undefined>(undefined);

  useEffect(() => {
    if (!viewId) return;
    publishedGroupsRef.current = groupSummaries;
    setChartGroups(viewId, groupSummaries);
  }, [viewId, groupSummaries]);
  useEffect(() => {
    if (!viewId) return;
    return () => clearChartGroups(viewId, publishedGroupsRef.current);
  }, [viewId]);

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
  const titleText = settings?.titleText;
  const numberTitle = useMemo(
    () => getNumberChartTitle(t, { aggregation: effectiveAggregation, yFieldName, titleText }),
    [t, effectiveAggregation, yFieldName, titleText]
  );
  const mobile = useMobileContext();

  // The open drill-down (WP13): what was clicked and the dialog title.
  const [drill, setDrill] = useState<{ target: ChartDrillTarget; title: string } | null>(null);

  // A category or segment drills into its keys, titled by the category; the
  // Number card into its counted rows, titled by its caption.
  const handleItemClick = useCallback(
    (item: ChartDataItem) => {
      setDrill(
        chartType === ChartType.Number
          ? { target: numberChartDrillTarget(numberTitle, item.rowIds), title: numberTitle }
          : { target: toDrillTarget(item), title: item.label }
      );
    },
    [chartType, numberTitle]
  );

  const handleCloseDrill = useCallback(() => {
    setDrill(null);
  }, []);

  const contextValue = useMemo<ChartContextValue>(
    () => ({
      chartType,
      settings,
      seriesData,
      numberItem,
      groupByField,
      hasGroupBy,
      groupStyle,
      paint,
      isLoading,
      xAxisField,
      effectiveAggregation,
      hasGroupableFields,
      style,
      format,
      seriesLabel,
      numberTitle,
      mobile,
      loadError,
      retry,
      isDark,
      onItemClick: handleItemClick,
    }),
    [
      chartType,
      settings,
      seriesData,
      numberItem,
      groupByField,
      hasGroupBy,
      groupStyle,
      paint,
      isLoading,
      xAxisField,
      effectiveAggregation,
      hasGroupableFields,
      style,
      format,
      seriesLabel,
      numberTitle,
      mobile,
      loadError,
      retry,
      isDark,
      handleItemClick,
    ]
  );

  return (
    <ChartContext.Provider value={contextValue}>
      {children}
      {drill ? <ChartDrillDialog onClose={handleCloseDrill} target={drill.target} title={drill.title} /> : null}
    </ChartContext.Provider>
  );
}

export default ChartProvider;
