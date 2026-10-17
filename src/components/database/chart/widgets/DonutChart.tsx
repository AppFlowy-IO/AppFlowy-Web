import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pie, PieChart, type SectorProps } from 'recharts';

import { ChartAggregationType, ChartClickItem, ChartDataItem } from '@/application/database-yjs/chart.type';

import { ChartNoValidData } from './ChartNoValidData';
import { ChartTitle, useChartAggregationLabel } from './ChartTitle';
import { CHART_TOOLTIP_WIDTH, ChartIndicatorDot, PositionedChartTooltip } from './ChartTooltip';
import { chartDataEqual, resolveChartItemColor, resolveChartItemTextColor } from './chartUtils';
import { useElementSize } from './useElementSize';

interface DonutChartWidgetProps {
  data: ChartDataItem[];
  onSliceClick?: (item: ChartClickItem) => void;
  aggregationType?: ChartAggregationType;
}

// Ring geometry from desktop's `_DonutChartContentState`.
const INNER_RADIUS = 70; // `_centerSpaceRadius`
const RING_WIDTH = 40; // `_pieRadius`
const HOVER_GROWTH = 5; // the hovered section is `_pieRadius + 5` wide
const SECTION_GAP = 2; // `_sectionsSpace`

// Leader geometry from desktop's `_SectionLeader`.
const LEADER_START_RADIUS = INNER_RADIUS + RING_WIDTH + 1;
const LEADER_RADIAL_LENGTH = 40;
const LEADER_HORIZONTAL_LENGTH = 20;
const LEADER_SINGLE_LINE_LENGTH = 50;
const SAME_LINE_EPSILON = 0.5;
const LABEL_WIDTH = 96;
const LABEL_HEIGHT = 36;
const LABEL_EDGE_MARGIN = 4;
const TOOLTIP_GAP = 8;

const polarX = (cx: number, radius: number, angle: number) => cx + radius * Math.cos(angle);
const polarY = (cy: number, radius: number, angle: number) => cy + radius * Math.sin(angle);
const polarPoint = (cx: number, cy: number, radius: number, angle: number) =>
  `${polarX(cx, radius, angle)},${polarY(cy, radius, angle)}`;

/**
 * SVG path of one ring section between the screen angles `start` < `end`
 * (radians, clockwise from 3 o'clock). Like fl_chart's `sectionsSpace`, each
 * section gives up half of the gap along both straight edges, so neighbors are
 * split by a band of constant width (not a wedge); a lone section is a full ring.
 */
function donutSectionPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number) {
  const sweep = end - start;

  if (sweep >= 2 * Math.PI - 1e-6) {
    // Outer circle clockwise, inner circle counter-clockwise: the nonzero rule leaves the hole empty.
    return [
      `M${cx + outer},${cy}`,
      `A${outer},${outer} 0 1 1 ${cx - outer},${cy}`,
      `A${outer},${outer} 0 1 1 ${cx + outer},${cy}`,
      `M${cx + inner},${cy}`,
      `A${inner},${inner} 0 1 0 ${cx - inner},${cy}`,
      `A${inner},${inner} 0 1 0 ${cx + inner},${cy}`,
      'Z',
    ].join(' ');
  }

  const halfGap = SECTION_GAP / 2;
  // Radius where the two inset edges meet; closer to the center the gap eats the whole section.
  const apexRadius = sweep >= Math.PI ? 0 : halfGap / Math.sin(sweep / 2);

  if (apexRadius >= outer) return '';

  const outerInset = Math.asin(halfGap / outer);
  const outerArc = `A${outer},${outer} 0 ${sweep - 2 * outerInset > Math.PI ? 1 : 0} 1 ${polarPoint(
    cx,
    cy,
    outer,
    end - outerInset
  )}`;

  if (apexRadius > inner) {
    return `M${polarPoint(cx, cy, apexRadius, start + sweep / 2)} L${polarPoint(
      cx,
      cy,
      outer,
      start + outerInset
    )} ${outerArc} Z`;
  }

  const innerInset = Math.asin(halfGap / inner);
  const innerArc = `A${inner},${inner} 0 ${sweep - 2 * innerInset > Math.PI ? 1 : 0} 0 ${polarPoint(
    cx,
    cy,
    inner,
    start + innerInset
  )}`;

  return [
    `M${polarPoint(cx, cy, inner, start + innerInset)}`,
    `L${polarPoint(cx, cy, outer, start + outerInset)}`,
    outerArc,
    `L${polarPoint(cx, cy, inner, end - innerInset)}`,
    innerArc,
    'Z',
  ].join(' ');
}

function renderSection(
  { cx = 0, cy = 0, innerRadius = 0, outerRadius = 0, startAngle = 0, endAngle = 0, fill }: SectorProps,
  hovered: boolean
) {
  // Recharts angles are degrees counter-clockwise; with `endAngle={-360}` the
  // sections run clockwise from 3 o'clock like desktop's fl_chart pie.
  const start = (-startAngle * Math.PI) / 180;
  const end = (-endAngle * Math.PI) / 180;
  const outer = outerRadius + (hovered ? HOVER_GROWTH : 0);

  return (
    <path
      data-testid='donut-chart-section'
      className='cursor-pointer'
      d={donutSectionPath(cx, cy, innerRadius, outer, Math.min(start, end), Math.max(start, end))}
      fill={fill}
      fillOpacity={hovered ? 0.8 : 1}
    />
  );
}

const renderIdleSection = (props: SectorProps) => renderSection(props, false);
const renderHoveredSection = (props: SectorProps) => renderSection(props, true);

interface DonutSection {
  item: ChartDataItem;
  /** Ring, leader line, legend dot and drill-down color. */
  color: string;
  /** Leader label and tooltip dot color (the option's tag text color). */
  textColor: string;
  /** Angular midpoint in radians, clockwise from 3 o'clock. */
  midAngle: number;
}

interface LeaderLayout {
  points: string;
  lineEndX: number;
  lineEndY: number;
  /** Right-half labels extend right from the line end, left-half ones extend left. */
  rightSide: boolean;
  labelTop: number;
  tooltipX: number;
}

/** Desktop's `_SectionLeader` geometry for a section centered at `midAngle`. */
function layoutLeader(midAngle: number, width: number, height: number): LeaderLayout {
  const cx = width / 2;
  const cy = height / 2;
  const rightSide = Math.cos(midAngle) >= 0;
  const direction = rightSide ? 1 : -1;
  const startX = polarX(cx, LEADER_START_RADIUS, midAngle);
  const startY = polarY(cy, LEADER_START_RADIUS, midAngle);
  const elbowX = polarX(cx, LEADER_START_RADIUS + LEADER_RADIAL_LENGTH, midAngle);
  const elbowY = polarY(cy, LEADER_START_RADIUS + LEADER_RADIAL_LENGTH, midAngle);
  // At 3 or 9 o'clock the radial segment adds no height, so desktop draws one straight line.
  const singleLine = Math.abs(startY - elbowY) < SAME_LINE_EPSILON;
  const lineEndX = singleLine
    ? startX + direction * LEADER_SINGLE_LINE_LENGTH
    : elbowX + direction * LEADER_HORIZONTAL_LENGTH;
  const lineEndY = singleLine ? startY : elbowY;
  const points = singleLine
    ? `${startX},${startY} ${lineEndX},${lineEndY}`
    : `${startX},${startY} ${elbowX},${elbowY} ${lineEndX},${lineEndY}`;

  return {
    points,
    lineEndX,
    lineEndY,
    rightSide,
    // Centered on the line end, then kept inside the chart's top and bottom edges.
    labelTop: Math.max(
      LABEL_EDGE_MARGIN,
      Math.min(lineEndY - LABEL_HEIGHT / 2, height - LABEL_HEIGHT - LABEL_EDGE_MARGIN)
    ),
    // Desktop's anchor beside the label; its left-half formula adds the gap, kept for parity.
    tooltipX: rightSide
      ? lineEndX + LABEL_WIDTH + TOOLTIP_GAP + CHART_TOOLTIP_WIDTH / 2
      : lineEndX - LABEL_WIDTH + TOOLTIP_GAP - CHART_TOOLTIP_WIDTH / 2,
  };
}

function SectionLeader({
  section,
  layout,
  total,
  chartWidth,
}: {
  section: DonutSection;
  layout: LeaderLayout;
  total: number;
  chartWidth: number;
}) {
  const { item, color, textColor } = section;
  const percentage = ((item.value / total) * 100).toFixed(1);

  return (
    <div data-testid='donut-chart-leader' className='pointer-events-none absolute inset-0'>
      <svg aria-hidden className='absolute inset-0 h-full w-full overflow-visible'>
        <polyline points={layout.points} fill='none' stroke={color} strokeWidth={1} />
      </svg>
      <div
        className='absolute flex flex-col items-center'
        style={{
          top: layout.labelTop,
          width: LABEL_WIDTH,
          ...(layout.rightSide ? { left: layout.lineEndX } : { right: chartWidth - layout.lineEndX }),
        }}
      >
        <span className='max-w-full truncate text-xs font-medium leading-[18px]' style={{ color: textColor }}>
          {item.label}
        </span>
        <span
          data-testid='donut-chart-leader-value'
          className='mt-0.5 max-w-full truncate text-xs leading-[18px]'
          style={{ color: textColor, opacity: 0.7 }}
        >
          {`${Math.trunc(item.value)} (${percentage}%)`}
        </span>
      </div>
    </div>
  );
}

/**
 * Desktop's `_DonutChartContent`: the ring with the total in its hole and a
 * leader + label per section, above a legend row.
 */
function DonutChartContent({ data, onSliceClick, aggregationType }: DonutChartWidgetProps) {
  const { t } = useTranslation();
  const chartRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(chartRef);
  const aggregationLabel = useChartAggregationLabel(aggregationType);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total = useMemo(() => data.reduce((sum, item) => sum + item.value, 0), [data]);
  const sections = useMemo<DonutSection[]>(() => {
    let start = 0;

    return data.map((item, index) => {
      const sweep = (item.value / total) * 2 * Math.PI;
      const midAngle = start + sweep / 2;

      start += sweep;
      return {
        item,
        color: resolveChartItemColor(item, index),
        textColor: resolveChartItemTextColor(item, index),
        midAngle,
      };
    });
  }, [data, total]);
  const pieData = useMemo(
    () => sections.map(({ item, color }) => ({ label: item.label, value: item.value, fill: color })),
    [sections]
  );
  const leaders = useMemo(
    () => sections.map((section) => layoutLeader(section.midAngle, width, height)),
    [sections, width, height]
  );
  const hovered = hoveredIndex !== null && hoveredIndex < sections.length ? hoveredIndex : null;
  const hoveredSection = hovered === null ? undefined : sections[hovered];
  const hoveredLeader = hovered === null ? undefined : leaders[hovered];

  const handleSectionClick = (index: number) => {
    const section = sections[index];

    if (!section) return;
    // Desktop clears the hover once a section is tapped.
    setHoveredIndex(null);
    onSliceClick?.({ ...section.item, color: section.color });
  };

  const renderLeader = (index: number) => (
    <SectionLeader
      key={`${sections[index].item.label}-${index}`}
      section={sections[index]}
      layout={leaders[index]}
      total={total}
      chartWidth={width}
    />
  );

  return (
    <>
      <div ref={chartRef} className='relative min-h-0 flex-1 overflow-hidden'>
        {width > 0 && height > 0 && (
          <>
            <PieChart width={width} height={height} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Pie
                data={pieData}
                dataKey='value'
                nameKey='label'
                cx='50%'
                cy='50%'
                innerRadius={INNER_RADIUS}
                outerRadius={INNER_RADIUS + RING_WIDTH}
                startAngle={0}
                endAngle={-360}
                paddingAngle={0}
                isAnimationActive={false}
                // Recharts applies `inactiveShape` only while an index is active, so -1 means "none hovered".
                activeIndex={hovered ?? -1}
                activeShape={renderHoveredSection}
                inactiveShape={renderIdleSection}
                onMouseEnter={(_, index) => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={(_, index) => handleSectionClick(index)}
              />
            </PieChart>
            <div
              data-testid='donut-chart-center'
              className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center'
            >
              <span className='text-[32px] font-semibold leading-[39px] text-text-primary'>{Math.trunc(total)}</span>
              <span className='text-xl leading-7 text-text-secondary'>{t('chart.total')}</span>
              {aggregationLabel && (
                <ChartTitle
                  label={aggregationLabel}
                  orientation='horizontal'
                  className='text-xs leading-[18px] text-text-tertiary'
                />
              )}
            </div>
            {/* The hovered section's leader is drawn last so it sits above every other label. */}
            {sections.map((_, index) => (index === hovered ? null : renderLeader(index)))}
            {hovered !== null && renderLeader(hovered)}
            {hoveredSection && hoveredLeader && (
              <PositionedChartTooltip
                label={hoveredSection.item.label}
                value={hoveredSection.item.value}
                color={hoveredSection.textColor}
                anchor={{ x: hoveredLeader.tooltipX, y: hoveredLeader.lineEndY }}
                chartSize={{ width, height }}
                verticalGap={0}
              />
            )}
          </>
        )}
      </div>
      {/* Centered while it fits, scrolls horizontally from the first item once it doesn't. */}
      <div data-testid='donut-chart-legend' className='mt-4 w-full shrink-0 overflow-x-auto'>
        <div className='mx-auto flex w-max'>
          {sections.map(({ item, color }, index) => (
            <button
              key={`${item.label}-${index}`}
              type='button'
              data-testid='donut-chart-legend-item'
              className='flex items-center rounded-100 pr-5 hover:bg-fill-content-hover'
              onClick={() => onSliceClick?.({ ...item, color })}
            >
              <ChartIndicatorDot color={color} />
              <span className='ml-1.5 whitespace-nowrap text-xs font-medium leading-[18px] text-text-tertiary'>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Donut chart (desktop's `DatabaseDonutChart`). Only categories with a
 * positive, finite value get a section.
 */
function DonutChartWidgetImpl({ data, onSliceClick, aggregationType }: DonutChartWidgetProps) {
  // Unlike the other charts, desktop's donut `_validateData` also drops zeros.
  const validData = useMemo(() => data.filter((item) => Number.isFinite(item.value) && item.value > 0), [data]);

  if (validData.length === 0) {
    return (
      <div data-testid='donut-chart-widget' className='h-[400px] w-full'>
        <ChartNoValidData />
      </div>
    );
  }

  return (
    <div data-testid='donut-chart-widget' className='flex h-[400px] w-full flex-col py-6'>
      <DonutChartContent data={validData} onSliceClick={onSliceClick} aggregationType={aggregationType} />
    </div>
  );
}

// Memoized with content-equality so Yjs hydration micro-batches don't rebuild
// the recharts SVG. `onSliceClick` is `useCallback`-stable in `ChartProvider`.
export const DonutChartWidget = memo(DonutChartWidgetImpl, (prev, next) => {
  return (
    prev.onSliceClick === next.onSliceClick &&
    prev.aggregationType === next.aggregationType &&
    chartDataEqual(prev.data, next.data)
  );
});

export default DonutChartWidget;
