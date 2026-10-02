import { useCallback, useEffect, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import { useDatabaseContext, useDatabaseViewId } from '@/application/database-yjs';
import { resolveChartLocale } from '@/application/database-yjs/chart-format';
import {
  ChartAggregationType,
  ChartType,
  DEFAULT_CHART_NUMBER_FORMAT,
} from '@/application/database-yjs/chart.type';
import ChartEmptyState from '@/components/database/chart/ChartEmptyState';
import ChartProvider from '@/components/database/chart/ChartProvider';
import { ChartErrorState, ChartLoadingState } from '@/components/database/chart/ChartStates';
import { useChartContext } from '@/components/database/chart/useChartContext';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';
import DonutChartWidget from '@/components/database/chart/widgets/DonutChart';
import HorizontalBarChartWidget from '@/components/database/chart/widgets/HorizontalBarChart';
import LineChartWidget from '@/components/database/chart/widgets/LineChart';
import NumberChartWidget from '@/components/database/chart/widgets/NumberChart';
import { getNumberChartTitle } from '@/components/database/chart/widgets/numberChartUtils';
import { cn } from '@/lib/utils';

function NumberChartContent() {
  const { t, i18n } = useTranslation();
  const { chartData, settings, aggregationType, yAxisField, yFieldName, yNumberFormat, style, onElementClick } =
    useChartContext();

  const title = getNumberChartTitle(t, {
    titleText: settings?.titleText,
    aggregationType,
    yFieldName,
    hasYField: !!yAxisField,
  });
  const effectiveAggregation = yAxisField ? aggregationType : ChartAggregationType.Count;

  return (
    <NumberChartWidget
      item={chartData[0] ?? null}
      title={title}
      numberFormat={settings?.numberFormat ?? DEFAULT_CHART_NUMBER_FORMAT}
      aggregationType={effectiveAggregation}
      fieldNumberFormat={yNumberFormat}
      decimalPlaces={style.decimalPlaces}
      locale={resolveChartLocale(i18n?.language)}
      onClick={onElementClick}
    />
  );
}

function ChartContent({ fill }: { fill: boolean }) {
  const { chartType, chartData, isLoading, loadError, retry, hasGroupableFields, onElementClick } = useChartContext();

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

  // Empty state: no groupable fields (SingleSelect, MultiSelect, Checkbox) in the database
  if (!hasGroupableFields) {
    return <ChartEmptyState fill={fill} type="no-field" />;
  }

  // Empty state: no data
  if (chartData.length === 0) {
    return <ChartEmptyState fill={fill} type="no-data" variant={chartType === ChartType.Donut ? 'donut' : undefined} />;
  }

  // Render appropriate chart type
  switch (chartType) {
    case ChartType.Bar:
      return <BarChartWidget data={chartData} fill={fill} onBarClick={onElementClick} />;
    case ChartType.HorizontalBar:
      return <HorizontalBarChartWidget data={chartData} fill={fill} onBarClick={onElementClick} />;
    case ChartType.Line:
      return <LineChartWidget data={chartData} fill={fill} onPointClick={onElementClick} />;
    case ChartType.Donut:
      return <DonutChartWidget data={chartData} fill={fill} onSliceClick={onElementClick} />;
    default:
      return <BarChartWidget data={chartData} fill={fill} onBarClick={onElementClick} />;
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
