import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { CategoryLabelFit, TextMeasurer, truncateToWidth } from '@/application/database-yjs/chart-scale';
import { cn } from '@/lib/utils';

const { axis, hoverBandRadius } = DASHBOARD_CHART_GEOMETRY;

/** Ticks, data labels and outside labels share the 12/16/400 chart text style; the color comes from `currentColor`. */
const TEXT_CLASS = 'fill-current text-xs font-normal';

/** The props Recharts passes to a custom axis tick. */
interface RechartsTickProps {
  x?: number;
  y?: number;
  className?: string;
  payload?: { value?: unknown; index?: number };
}

export interface CategoryTickProps extends RechartsTickProps {
  /** Category key → full label. */
  labels: ReadonlyMap<string, string>;
  fit: CategoryLabelFit;
  measure: TextMeasurer;
  /** `bottom` for vertical bars and lines, `left` for horizontal bars (right-aligned in the label column). */
  orientation: 'bottom' | 'left';
  /** Horizontal bars: the label column width labels are truncated to. */
  maxWidth?: number;
}

/**
 * A category label (WP10 §2.1): horizontal, or −45° and truncated to 80px
 * with "…", or nothing when thinned. `<title>` keeps the full label.
 */
export function CategoryTick({ x = 0, y = 0, payload, className, labels, fit, measure, orientation, maxWidth }: CategoryTickProps) {
  const index = payload?.index ?? 0;
  const key = String(payload?.value ?? '');
  const label = labels.get(key) ?? key;

  if (!fit.shown.includes(index)) return null;
  const common = {
    className: cn(className, TEXT_CLASS, 'text-chart-tick'),
    'data-label': label,
    'data-parity-id': 'dash-chart-tick-label',
    'data-testid': 'chart-category-label',
  };

  if (orientation === 'left') {
    return (
      <text {...common} data-rotated='false' dominantBaseline='central' textAnchor='end' x={x} y={y}>
        <title>{label}</title>
        {truncateToWidth(label, maxWidth ?? Number.POSITIVE_INFINITY, measure)}
      </text>
    );
  }

  if (fit.mode === 'rotated') {
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
        <title>{label}</title>
        {truncateToWidth(label, axis.rotatedMaxLabel, measure)}
      </text>
    );
  }

  return (
    <text {...common} data-rotated='false' dominantBaseline='hanging' textAnchor='middle' x={x} y={y}>
      <title>{label}</title>
      {label}
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
 * negative one.
 */
export function DataLabel({ target, layout }: { target: DataLabelTarget; layout: 'vertical' | 'horizontal' }) {
  const common = {
    className: cn(TEXT_CLASS, 'text-chart-data-label'),
    'data-label': target.label,
    'data-parity-id': 'dash-chart-data-label',
    'data-testid': 'chart-data-label',
  };

  if (layout === 'horizontal') {
    const end = target.value >= 0 ? Math.max(target.x, target.x + target.width) : Math.min(target.x, target.x + target.width);

    return (
      <text
        {...common}
        dominantBaseline='central'
        textAnchor={target.value >= 0 ? 'start' : 'end'}
        x={target.value >= 0 ? end + 4 : end - 4}
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
      y={target.value >= 0 ? end - 4 : end + 4}
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

/**
 * Transparent bands over each category slot (pointer events off), so tests
 * can hover a category even when its label is thinned. Rendered through a
 * Recharts `<Customized>`, which passes chart props this component ignores.
 */
export function CategoryAnchors({ rects }: { rects: CategoryAnchorRect[] }) {
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
