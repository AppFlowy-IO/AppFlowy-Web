import { memo } from 'react';

import { CHART_ALL_SERIES_KEY, ChartSeriesData } from '@/application/database-yjs/chart.type';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { ChartSeriesStyle } from '@/components/database/chart/hooks/chartGroupBy';

const { bar } = DASHBOARD_CHART_GEOMETRY;

/** What every segment of one chart shares; one object per data, style and colours. */
export interface SeriesBarMeta {
  data: ChartSeriesData;
  style: ChartSeriesStyle;
  /** `vertical`: bars grow up (vertical bar chart); `horizontal`: bars grow right. */
  orientation: 'vertical' | 'horizontal';
  /** Stacked and percent bars: per category, the series carrying the rounded positive and negative value ends. */
  outermost: { positive: Array<number | null>; negative: Array<number | null> } | null;
  /** Per category: the single-series fill. */
  categoryFills: ReadonlyArray<string | undefined>;
  /** Per series: the fill with a Group by. */
  seriesFills: readonly string[];
  /** R-FORMAT `tooltip` text of a raw value, for the segment's accessible name. */
  formatValue: (value: number) => string;
}

/** The props Recharts passes to a custom bar shape (the segment's rectangle and its category index). */
interface RechartsBarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
}

export interface SeriesBarShapeProps extends RechartsBarShapeProps {
  seriesIndex: number;
  meta: SeriesBarMeta;
}

interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

/** A rectangle path with its own radius per corner (Recharts' radius rounds a whole edge pair). */
export function roundedRectPath(x: number, y: number, width: number, height: number, radii: CornerRadii): string {
  const { topLeft, topRight, bottomRight, bottomLeft } = radii;
  const arc = (radius: number, toX: number, toY: number) =>
    radius > 0 ? ` A ${radius} ${radius} 0 0 1 ${toX} ${toY}` : '';

  return [
    `M ${x + topLeft} ${y}`,
    ` L ${x + width - topRight} ${y}`,
    arc(topRight, x + width, y + topRight),
    ` L ${x + width} ${y + height - bottomRight}`,
    arc(bottomRight, x + width - bottomRight, y + height),
    ` L ${x + bottomLeft} ${y + height}`,
    arc(bottomLeft, x, y + height - bottomLeft),
    ` L ${x} ${y + topLeft}`,
    arc(topLeft, x + topLeft, y),
    ' Z',
  ].join('');
}

/** Which ends of the segment are rounded: the value end of a single or grouped bar, the outermost segment of a stack. */
function roundedEnds(meta: SeriesBarMeta, categoryIndex: number, seriesIndex: number, value: number) {
  if (meta.style === 'stacked' || meta.style === 'percent') {
    return {
      positive: meta.outermost?.positive[categoryIndex] === seriesIndex,
      negative: meta.outermost?.negative[categoryIndex] === seriesIndex,
    };
  }

  return { positive: value > 0, negative: value < 0 };
}

/**
 * One bar or stack segment (WP12 §2.3). It rounds only the value end (2px) of
 * a single or grouped bar and of the outermost segment of each side of a
 * stack, outlines stacked and percent segments with a 1px card-coloured
 * stroke, and draws nothing at zero size, so "N bars" counts only drawn bars.
 * The test and parity attributes name the category, the series and the raw
 * value.
 */
function SeriesBarShapeImpl({ x = 0, y = 0, width = 0, height = 0, index = 0, seriesIndex, meta }: SeriesBarShapeProps) {
  const series = meta.data.series[seriesIndex];
  const category = meta.data.categories[index];

  if (!series || !category || !width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const value = series.values[index] ?? 0;
  const left = Math.min(x, x + width);
  const top = Math.min(y, y + height);
  const w = Math.abs(width);
  const h = Math.abs(height);
  const radius = Math.max(
    0,
    Math.min(bar.radius, meta.orientation === 'vertical' ? w / 2 : h / 2, meta.orientation === 'vertical' ? h : w)
  );
  const ends = roundedEnds(meta, index, seriesIndex, value);
  const radii: CornerRadii = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };

  if (meta.orientation === 'vertical') {
    if (ends.positive) radii.topLeft = radii.topRight = radius;
    if (ends.negative) radii.bottomLeft = radii.bottomRight = radius;
  } else {
    if (ends.positive) radii.topRight = radii.bottomRight = radius;
    if (ends.negative) radii.topLeft = radii.bottomLeft = radius;
  }

  const stacked = meta.style === 'stacked' || meta.style === 'percent';
  const single = series.key === CHART_ALL_SERIES_KEY;
  const fill = single ? meta.categoryFills[index] : meta.seriesFills[seriesIndex];
  const valueText = meta.formatValue(value);

  return (
    <path
      aria-label={single ? `${category.label}: ${valueText}` : `${category.label}, ${series.label}: ${valueText}`}
      className='recharts-rectangle'
      d={roundedRectPath(left, top, w, h, radii)}
      data-category={category.label}
      data-parity-id={stacked ? 'dash-chart-bar-segment' : 'dash-chart-bar'}
      data-series={single ? '' : series.label}
      data-series-index={seriesIndex}
      data-testid='chart-bar-segment'
      data-value={value}
      fill={fill}
      height={height}
      role='img'
      stroke={stacked ? 'var(--dash-card-bg)' : undefined}
      strokeWidth={stacked ? 1 : undefined}
      width={width}
      x={x}
      y={y}
    />
  );
}

export const SeriesBarShape = memo(SeriesBarShapeImpl);

export default SeriesBarShape;
