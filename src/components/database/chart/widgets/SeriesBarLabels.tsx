import { memo } from 'react';

import { ChartSeriesData } from '@/application/database-yjs/chart.type';

import { DataLabel } from './ChartAxisParts';
import { SeriesDataLabel } from './useCartesianChartModel';

/** The part of a Recharts axis the labels read: its scale (a band scale on the category axis). */
interface RechartsAxis {
  scale?: ((value: unknown) => number | undefined) & { bandwidth?: () => number };
}

type RechartsAxisMap = Record<string, RechartsAxis> | undefined;

/**
 * The props of `StackTotalLabels`. `<Customized>` passes the chart's own props
 * and state too (`data`, `layout`, the axis maps…), so none of these names
 * collides with them.
 */
export interface StackTotalLabelsProps {
  seriesData: ChartSeriesData;
  /** The stack totals of `seriesDataLabels` (series `null`), with their text. */
  totals: readonly SeriesDataLabel[];
  /** Per category, the layout's fitted label, or `null` when it is thinned out; `null` when labels are off. */
  visible: ReadonlyArray<string | null> | null;
  /** `vertical`: bars grow up; `horizontal`: bars grow right. */
  orientation: 'vertical' | 'horizontal';
  /** Passed by Recharts through `<Customized>`. */
  xAxisMap?: RechartsAxisMap;
  yAxisMap?: RechartsAxisMap;
}

function firstAxis(map: RechartsAxisMap): RechartsAxis | undefined {
  return map ? Object.values(map)[0] : undefined;
}

/**
 * The stack total labels (WP12 §2.6) of stacked and single-series bars,
 * drawn through a Recharts `<Customized>` with the chart's own scales: the
 * positive total 4px past the stack's positive end (also "0" for a category
 * whose values are all 0) and, when the category has negative values, the
 * negative total past its negative end. A single series labels each bar with
 * its value at the same place as a label on the bar.
 */
function StackTotalLabelsImpl({ seriesData, totals, visible, orientation, xAxisMap, yAxisMap }: StackTotalLabelsProps) {
  const categoryAxis = firstAxis(orientation === 'vertical' ? xAxisMap : yAxisMap);
  const valueAxis = firstAxis(orientation === 'vertical' ? yAxisMap : xAxisMap);
  const categoryScale = categoryAxis?.scale;
  const valueScale = valueAxis?.scale;

  if (!visible || !categoryScale || !valueScale) return null;
  const bandwidth = categoryScale.bandwidth?.() ?? 0;

  return (
    <g className='chart-stack-total-labels'>
      {totals.map((label) => {
        const category = seriesData.categories[label.categoryIndex];
        const start = category ? categoryScale(category.key) : undefined;
        const end = valueScale(label.value);

        if (!category || visible[label.categoryIndex] === null || start === undefined || end === undefined) return null;
        const center = start + bandwidth / 2;
        const target = {
          index: label.categoryIndex,
          value: label.value,
          label: category.label,
          text: label.text,
          x: orientation === 'vertical' ? center : end,
          y: orientation === 'vertical' ? end : center,
          width: 0,
          height: 0,
        };

        return <DataLabel key={`${category.key}-${label.side}`} layout={orientation} target={target} />;
      })}
    </g>
  );
}

/**
 * `<Customized>` hands the whole chart state over on every pointer move; the
 * labels draw again only when the labels or the axis scales change.
 */
export const StackTotalLabels = memo(
  StackTotalLabelsImpl,
  (previous, next) =>
    previous.seriesData === next.seriesData &&
    previous.totals === next.totals &&
    previous.visible === next.visible &&
    previous.orientation === next.orientation &&
    previous.xAxisMap === next.xAxisMap &&
    previous.yAxisMap === next.yAxisMap
);

/** The props Recharts passes to a `LabelList` content renderer. */
interface RechartsLabelProps {
  index?: number;
  value?: number | string | Array<number | string>;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
}

/**
 * The `LabelList` renderer of grouped bars (WP12 §2.6): each non-zero bar's
 * value at its value end, for the categories whose labels the layout kept.
 */
export function groupedBarLabelRenderer(
  data: ChartSeriesData,
  seriesIndex: number,
  texts: ReadonlyMap<string, string>,
  visible: ReadonlyArray<string | null> | null,
  orientation: 'vertical' | 'horizontal'
) {
  function GroupedBarLabel(props: RechartsLabelProps) {
    const index = props.index ?? 0;
    const category = data.categories[index];
    const series = data.series[seriesIndex];
    const value = series?.values[index] ?? 0;
    const text = texts.get(`${index}:${seriesIndex}`);

    if (!category || !series || value === 0 || text === undefined || !visible || visible[index] === null) return null;
    return (
      <DataLabel
        layout={orientation}
        series={series.label}
        target={{
          index,
          value,
          label: category.label,
          text,
          x: Number(props.x),
          y: Number(props.y),
          width: Number(props.width),
          height: Number(props.height),
        }}
      />
    );
  }

  return GroupedBarLabel;
}
