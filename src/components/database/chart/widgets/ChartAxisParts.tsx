import { memo } from 'react';

import { CHART_DATA_LABEL_OFFSET } from '@/application/database-yjs/chart-scale';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { cn } from '@/lib/utils';

const { hoverBandRadius } = DASHBOARD_CHART_GEOMETRY;

/** Ticks, data labels and outside labels share the 12/16/400 chart text style; the color comes from `currentColor`. */
const TEXT_CLASS = 'fill-current text-xs font-normal';

/** The props Recharts passes to a custom axis tick. */
interface RechartsTickProps {
  x?: number;
  y?: number;
  className?: string;
  payload?: { value?: unknown; index?: number };
}

/** A category label as the layout fitted it. */
export interface CategoryTickLabel {
  /** The full label, kept in `<title>` and `data-label`. */
  label: string;
  /** What is drawn: the label, or its truncated form ending in "…". */
  text: string;
}

export interface CategoryTickProps extends RechartsTickProps {
  /** One entry per category, from the chart layout; `null` for a label that was thinned out. */
  ticks: ReadonlyArray<CategoryTickLabel | null>;
  /** Bottom axis only: the labels are drawn at −45°. */
  rotated?: boolean;
  /** `bottom` for vertical bars and lines, `left` for horizontal bars (right-aligned in the label column). */
  orientation: 'bottom' | 'left';
}

/**
 * A category label (WP10 §2.1): horizontal, or −45° and truncated to 80px
 * with "…", or nothing when thinned. `<title>` keeps the full label. Which
 * labels show and how they are truncated is decided once, in the layout; the
 * tick only draws.
 */
export function CategoryTick({ x = 0, y = 0, payload, className, ticks, rotated = false, orientation }: CategoryTickProps) {
  const tick = ticks[payload?.index ?? -1];

  if (!tick) return null;
  const common = {
    className: cn(className, TEXT_CLASS, 'text-chart-tick'),
    'data-label': tick.label,
    'data-parity-id': 'dash-chart-tick-label',
    'data-testid': 'chart-category-label',
  };

  if (orientation === 'left') {
    return (
      <text {...common} data-rotated='false' dominantBaseline='central' textAnchor='end' x={x} y={y}>
        <title>{tick.label}</title>
        {tick.text}
      </text>
    );
  }

  if (rotated) {
    return (
      <text
        {...common}
        data-rotated='true'
        dominantBaseline='hanging'
        textAnchor='end'
        transform={`translate(${x}, ${y}) rotate(-45)`}
        x={0}
        y={0}
      >
        <title>{tick.label}</title>
        {tick.text}
      </text>
    );
  }

  return (
    <text {...common} data-rotated='false' dominantBaseline='hanging' textAnchor='middle' x={x} y={y}>
      <title>{tick.label}</title>
      {tick.text}
    </text>
  );
}

export interface ValueTickProps extends RechartsTickProps {
  format: (value: number) => string;
  /** `left` for the Y axis of vertical charts, `bottom` for the X axis of horizontal bars. */
  orientation: 'left' | 'bottom';
}

/** A value-axis tick: R-FORMAT `axis`, 12/16 secondary, right-aligned before the plot (or under it). */
export function ValueTick({ x = 0, y = 0, payload, className, format, orientation }: ValueTickProps) {
  const value = Number(payload?.value ?? 0);

  return (
    <text
      className={cn(className, TEXT_CLASS, 'text-chart-tick')}
      data-parity-id='dash-chart-tick-label'
      data-testid='chart-value-tick'
      data-value={value}
      dominantBaseline={orientation === 'left' ? 'central' : 'hanging'}
      textAnchor={orientation === 'left' ? 'end' : 'middle'}
      x={x}
      y={y}
    >
      {format(value)}
    </text>
  );
}

/** What a data label sits on: a bar's rectangle, or a line point. */
export interface DataLabelTarget {
  index: number;
  value: number;
  label: string;
  text: string;
  /** Bar rectangle (height and width may be negative for negative values) or the point (0 × 0). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A data label 4px past the value end: above a positive bar or point, below
 * a negative one; for horizontal bars right of a positive bar, left of a
 * negative one. `series` names the labelled bar of a grouped chart (`''` for
 * a stack total and a single series).
 */
export function DataLabel({
  target,
  layout,
  series,
}: {
  target: DataLabelTarget;
  layout: 'vertical' | 'horizontal';
  series?: string;
}) {
  const common = {
    className: cn(TEXT_CLASS, 'text-chart-data-label'),
    'data-category': target.label,
    'data-label': target.label,
    'data-parity-id': 'dash-chart-data-label',
    'data-series': series ?? '',
    'data-testid': 'chart-data-label',
  };

  if (layout === 'horizontal') {
    const end = target.value >= 0 ? Math.max(target.x, target.x + target.width) : Math.min(target.x, target.x + target.width);

    return (
      <text
        {...common}
        dominantBaseline='central'
        textAnchor={target.value >= 0 ? 'start' : 'end'}
        x={target.value >= 0 ? end + CHART_DATA_LABEL_OFFSET : end - CHART_DATA_LABEL_OFFSET}
        y={target.y + target.height / 2}
      >
        {target.text}
      </text>
    );
  }

  const end = target.value >= 0 ? Math.min(target.y, target.y + target.height) : Math.max(target.y, target.y + target.height);

  return (
    <text
      {...common}
      dominantBaseline={target.value >= 0 ? 'auto' : 'hanging'}
      textAnchor='middle'
      x={target.x + target.width / 2}
      y={target.value >= 0 ? end - CHART_DATA_LABEL_OFFSET : end + CHART_DATA_LABEL_OFFSET}
    >
      {target.text}
    </text>
  );
}

export interface CategoryAnchorRect {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function CategoryAnchorsImpl({ rects }: { rects: readonly CategoryAnchorRect[] }) {
  return (
    <g className='chart-category-anchors' pointerEvents='none'>
      {rects.map((rect, index) => (
        <rect
          data-label={rect.label}
          data-testid='chart-category-anchor'
          fill='transparent'
          height={Math.max(0, rect.height)}
          key={`${rect.label}-${index}`}
          width={Math.max(0, rect.width)}
          x={rect.x}
          y={rect.y}
        />
      ))}
    </g>
  );
}

/**
 * Transparent bands over each category slot (pointer events off). The BDD
 * steps locate a category through them, also when its label is thinned out.
 *
 * Rendered through a Recharts `<Customized>`, which passes the whole chart
 * state as props on every pointer move. Only `rects` (the memoized layout's
 * array) is compared, so the bands are not rebuilt per move.
 */
export const CategoryAnchors = memo(CategoryAnchorsImpl, (previous, next) => previous.rects === next.rects);

/**
 * The hover band of a line chart: the full category slot over the plot
 * height, behind the line (Recharts passes the cursor's `points`).
 */
export function HoverBandCursor({
  points,
  slot,
  top,
  height,
}: {
  points?: { x: number; y: number }[];
  slot: number;
  top: number;
  height: number;
}) {
  const x = points?.[0]?.x;

  if (x === undefined) return null;
  return (
    <rect
      className='recharts-tooltip-cursor'
      fill='var(--chart-hover-band)'
      height={height}
      pointerEvents='none'
      rx={hoverBandRadius}
      width={slot}
      x={x - slot / 2}
      y={top}
    />
  );
}
