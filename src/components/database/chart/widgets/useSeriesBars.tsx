import { MouseEvent, ReactElement, useMemo } from 'react';
import { Bar, LabelList } from 'recharts';

import { ChartSeriesData } from '@/application/database-yjs/chart.type';
import { ChartSeriesStyle } from '@/components/database/chart/hooks/chartGroupBy';
import { outermostSegments, seriesDataKey } from '@/components/database/chart/hooks/chartSeries';

import { groupedBarLabelRenderer, StackTotalLabels } from './SeriesBarLabels';
import { SeriesBarMeta, SeriesBarShape } from './SeriesBarShape';
import { SeriesDataLabel } from './useCartesianChartModel';

export interface SeriesBarsOptions {
  data: ChartSeriesData;
  /** Per category, the single-series fill. */
  categoryFills: ReadonlyArray<string | undefined>;
  seriesStyle: ChartSeriesStyle;
  /** Per series, the fill with a Group by. */
  fills: readonly string[];
  labels: readonly SeriesDataLabel[];
  /** The layout's fitted label per category (`null` thinned out), or `null` when labels are off. */
  visibleLabels: ReadonlyArray<string | null> | null;
  orientation: 'vertical' | 'horizontal';
  barSize: number;
  clickable: boolean;
  /** Whether the bars animate: the chart decides (`useChartAnimation`, reduced motion and resizes included). */
  animate: boolean;
  /** A segment click; `event` identifies the click, which the band behind the segment sees too (`useChartHover.tap`). */
  onSegmentClick: (categoryIndex: number, seriesIndex: number, event?: MouseEvent) => void;
  formatValue: (value: number) => string;
}

/**
 * The Recharts `<Bar>` children of a bar chart (WP12 §2.3): stacked and
 * percent bars render series n−1 … 0 in one stack (series 0 last, so it is
 * drawn at the value end), grouped bars render series 0 … n−1 side by side,
 * a single series is one bar per category. Every segment is a
 * `SeriesBarShape`; a segment click opens its cell (the chart's own click
 * opens the band). Also returns the stack total labels, drawn through a
 * `<Customized>` by the chart (none for grouped and percent bars).
 */
export function useSeriesBars({
  data,
  categoryFills,
  seriesStyle,
  fills,
  labels,
  visibleLabels,
  orientation,
  barSize,
  clickable,
  animate,
  onSegmentClick,
  formatValue,
}: SeriesBarsOptions): { bars: ReactElement[]; stackLabels: ReactElement | null } {
  const stacked = seriesStyle === 'stacked' || seriesStyle === 'percent';
  const grouped = seriesStyle === 'grouped';
  const meta = useMemo<SeriesBarMeta>(
    () => ({
      data,
      style: seriesStyle,
      orientation,
      outermost: stacked ? outermostSegments(data, seriesStyle) : null,
      categoryFills,
      seriesFills: fills,
      formatValue,
    }),
    [data, seriesStyle, orientation, stacked, categoryFills, fills, formatValue]
  );
  const shapes = useMemo(
    () =>
      data.series.map((_, seriesIndex) => <SeriesBarShape key={seriesIndex} meta={meta} seriesIndex={seriesIndex} />),
    [data.series, meta]
  );
  const clickHandlers = useMemo(
    () =>
      data.series.map((_, seriesIndex) => (_entry: unknown, categoryIndex: number, event?: MouseEvent) => {
        // The segment answers the click first; the chart's band click then ignores it (`useChartHover.tap`),
        // and the click still reaches Recharts, which moves the hover band of a tapped mobile chart.
        onSegmentClick(categoryIndex, seriesIndex, event);
      }),
    [data.series, onSegmentClick]
  );
  const groupedRenderers = useMemo(() => {
    if (!grouped) return null;
    const texts = new Map(
      labels.flatMap((label) =>
        label.seriesIndex === null ? [] : [[`${label.categoryIndex}:${label.seriesIndex}`, label.text] as const]
      )
    );

    return data.series.map((_, seriesIndex) =>
      groupedBarLabelRenderer(data, seriesIndex, texts, visibleLabels, orientation)
    );
  }, [grouped, labels, data, visibleLabels, orientation]);
  const stackLabels = useMemo(
    () =>
      grouped || seriesStyle === 'percent' ? null : (
        <StackTotalLabels orientation={orientation} seriesData={data} totals={labels} visible={visibleLabels} />
      ),
    [grouped, seriesStyle, data, labels, orientation, visibleLabels]
  );

  const order = data.series.map((_, index) => index);

  if (stacked) order.reverse();
  const bars = order.map((seriesIndex) => {
    const renderer = groupedRenderers?.[seriesIndex];

    return (
      <Bar
        activeBar={false}
        barSize={barSize}
        cursor={clickable ? 'pointer' : undefined}
        dataKey={seriesDataKey(seriesIndex, seriesStyle)}
        fill={fills[seriesIndex] || undefined}
        isAnimationActive={animate}
        key={`series-${seriesIndex}`}
        onClick={clickable ? clickHandlers[seriesIndex] : undefined}
        shape={shapes[seriesIndex]}
        stackId={stacked ? 'stack' : undefined}
      >
        {renderer ? <LabelList content={renderer} dataKey={seriesDataKey(seriesIndex, seriesStyle)} /> : null}
      </Bar>
    );
  });

  return { bars, stackLabels };
}
