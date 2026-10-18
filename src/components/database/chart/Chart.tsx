import { useEffect } from 'react';

import { useDatabaseContext, useDatabaseViewId } from '@/application/database-yjs';
import { ChartType } from '@/application/database-yjs/chart.type';
import ChartEmptyState from '@/components/database/chart/ChartEmptyState';
import ChartProvider from '@/components/database/chart/ChartProvider';
import { useChartContext } from '@/components/database/chart/useChartContext';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';
import DonutChartWidget from '@/components/database/chart/widgets/DonutChart';
import HorizontalBarChartWidget from '@/components/database/chart/widgets/HorizontalBarChart';
import LineChartWidget from '@/components/database/chart/widgets/LineChart';
import { Progress } from '@/components/ui/progress';

function ChartContent() {
  const { chartType, chartData, isLoading, hasGroupableFields, aggregationType, onElementClick } = useChartContext();

  // Loading state
  if (isLoading) {
    return (
      <div className="flex w-full items-start justify-center p-8">
        <Progress />
      </div>
    );
  }

  // Empty state: no groupable fields (SingleSelect, MultiSelect, Checkbox) in the database
  if (!hasGroupableFields) {
    return <ChartEmptyState type="no-field" />;
  }

  // Empty state: no data
  if (chartData.length === 0) {
    return <ChartEmptyState type="no-data" />;
  }

  // Render appropriate chart type
  switch (chartType) {
    case ChartType.HorizontalBar:
      return (
        <HorizontalBarChartWidget data={chartData} aggregationType={aggregationType} onBarClick={onElementClick} />
      );
    case ChartType.Line:
      return <LineChartWidget data={chartData} aggregationType={aggregationType} onPointClick={onElementClick} />;
    case ChartType.Donut:
      return <DonutChartWidget data={chartData} aggregationType={aggregationType} onSliceClick={onElementClick} />;
    case ChartType.Bar:
    default:
      return <BarChartWidget data={chartData} aggregationType={aggregationType} onBarClick={onElementClick} />;
  }
}

export function Chart() {
  const viewId = useDatabaseViewId();
  const { onRendered, paddingStart } = useDatabaseContext();

  useEffect(() => {
    onRendered?.();
  }, [onRendered]);

  // Use same padding as DatabaseTabs for alignment. The 20px bottom padding
  // keeps tilted category labels, which hang below the chart's SVG, from
  // being clipped when this scroll container is only as tall as the widget
  // (embedded blocks, published pages).
  const horizontalPadding = paddingStart === undefined ? 96 : paddingStart;

  return (
    <ChartProvider>
      <div
        data-testid="database-chart"
        className={`database-chart relative chart-${viewId} flex w-full flex-1 flex-col items-start justify-start overflow-y-auto overflow-x-hidden pb-5`}
        style={{
          paddingLeft: horizontalPadding,
          paddingRight: horizontalPadding,
        }}
      >
        <ChartContent />
      </div>
    </ChartProvider>
  );
}

export default Chart;
