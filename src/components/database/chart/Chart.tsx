import { useCallback, useEffect, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { useDatabaseContext, useDatabaseViewId } from '@/application/database-yjs';
import { resolveNumberColor } from '@/application/database-yjs/chart-config';
import { ChartType, resolveChartStyle } from '@/application/database-yjs/chart.type';
import ChartProvider from '@/components/database/chart/ChartProvider';
import {
  ChartErrorState,
  ChartLoadingState,
  ChartNoDataState,
  ChartNoFieldState,
} from '@/components/database/chart/ChartStates';
import { useChartContext } from '@/components/database/chart/useChartContext';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';
import DonutChartWidget from '@/components/database/chart/widgets/DonutChart';
import HorizontalBarChartWidget from '@/components/database/chart/widgets/HorizontalBarChart';
import LineChartWidget from '@/components/database/chart/widgets/LineChart';
import NumberChartWidget from '@/components/database/chart/widgets/NumberChart';
import { cn } from '@/lib/utils';

function NumberChartContent() {
  const { numberItem: item, settings, numberTitle, format, onItemClick } = useChartContext();
  const config = resolveChartStyle(settings);
  // No rows is "No data" too: the card shows no caption and no color then.
  const value = item && item.rowIds.length > 0 ? item.value : null;

  return (
    <NumberChartWidget
      item={item}
      onItemClick={onItemClick}
      // The custom title when one is set, otherwise the generated one (it titles the drill-down too).
      title={numberTitle}
      showTitle={config.showTitle}
      color={resolveNumberColor(value, config.numberColor, config.numberConditionalColor)}
      valueText={item ? format(item.value, 'card') : ''}
    />
  );
}

function ChartContent({ fill }: { fill: boolean }) {
  const { chartType, seriesData, isLoading, loadError, retry, hasGroupableFields, onItemClick } = useChartContext();

  if (isLoading) {
    return <ChartLoadingState fill={fill} />;
  }

  if (loadError) {
    return <ChartErrorState fill={fill} onRetry={retry} />;
  }

  // Number chart has no x-axis, so it needs neither groupable fields nor
  // grouped data; it renders its own empty state when no rows match.
  if (chartType === ChartType.Number) {
    return <NumberChartContent />;
  }

  // The database has no field a chart can group by (`CHART_X_FIELD_TYPES`).
  if (!hasGroupableFields) {
    return <ChartNoFieldState fill={fill} />;
  }

  if (seriesData.categories.length === 0) {
    return <ChartNoDataState fill={fill} variant={chartType === ChartType.Donut ? 'donut' : undefined} />;
  }

  // Every bar, line and donut chart draws the series build (WP12); the
  // truncation caption is the last line of its frame.
  switch (chartType) {
    case ChartType.HorizontalBar:
      return <HorizontalBarChartWidget data={seriesData} fill={fill} onItemClick={onItemClick} />;
    case ChartType.Line:
      return <LineChartWidget data={seriesData} fill={fill} onItemClick={onItemClick} />;
    case ChartType.Donut:
      return <DonutChartWidget data={seriesData} fill={fill} onItemClick={onItemClick} />;
    case ChartType.Bar:
    default:
      return <BarChartWidget data={seriesData} fill={fill} onItemClick={onItemClick} />;
  }
}

export function Chart() {
  const viewId = useDatabaseViewId();
  const { onRendered, paddingStart, isDashboardWidget } = useDatabaseContext();
  // A dashboard widget fills its card; the chart frame applies the card insets
  // (`chart.insetWidget`), so the widget's content padding is not added here.
  const fill = Boolean(isDashboardWidget);
  // Bumped by Retry after a render error: remounts the provider, which loads the rows again.
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    onRendered?.();
  }, [onRendered]);

  // Use same padding as DatabaseTabs for alignment
  const horizontalPadding = paddingStart === undefined ? 96 : paddingStart;

  const renderError = useCallback(
    ({ resetErrorBoundary }: { resetErrorBoundary: () => void }) => (
      <ChartErrorState
        fill={fill}
        onRetry={() => {
          setRetryKey((key) => key + 1);
          resetErrorBoundary();
        }}
      />
    ),
    [fill]
  );

  return (
    <div
      data-testid="database-chart"
      className={cn(
        `database-chart relative chart-${viewId} flex w-full flex-1 flex-col`,
        fill ? 'h-full min-h-0 overflow-hidden' : 'items-start justify-start overflow-y-auto overflow-x-hidden'
      )}
      style={fill ? undefined : { paddingLeft: horizontalPadding, paddingRight: horizontalPadding }}
    >
      {/* A chart exception shows "Couldn't load this chart" instead of reaching `DatabaseViews`' fallback. */}
      <ErrorBoundary fallbackRender={renderError} resetKeys={[viewId, retryKey]}>
        <ChartProvider key={retryKey}>
          <ChartContent fill={fill} />
        </ChartProvider>
      </ErrorBoundary>
    </div>
  );
}

export default Chart;
