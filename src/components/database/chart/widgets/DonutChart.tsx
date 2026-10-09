import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cell, Customized, Pie, PieChart } from 'recharts';

import { formatShare } from '@/application/database-yjs/chart-format';
import {
  CHART_DONUT_CENTER_WIDTH_FACTOR,
  computeDonutGeometry,
  DonutLabelLayout,
  layoutDonutLabels,
  TextMeasurer,
} from '@/application/database-yjs/chart-scale';
import { ChartDataItem, ChartSeriesData, ChartType } from '@/application/database-yjs/chart.type';
import { DASHBOARD_TYPOGRAPHY } from '@/application/database-yjs/dashboard-geometry';
import { ChartNoDataState } from '@/components/database/chart/ChartStates';
import { toCategoryItems, toDrillItem, truncationCaptionCount } from '@/components/database/chart/hooks/chartSeries';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { ChartFrame } from './ChartFrame';
import { CHART_ENTRY_ANIMATION_MS, chartItemKey } from './chartUtils';
import { useChartMeasure } from './measureText';
import { useChartA11yRows, useChartItemTooltip, useChartLegend } from './useChartFrameModels';
import { useChartHover } from './useChartHover';
import { useChartAnimation } from './useReducedMotion';

interface DonutChartWidgetProps {
  /** The series build (WP12): a donut ignores Group by, so its one series is `__all__`. */
  data: ChartSeriesData;
  /** Opens the drill-down of the clicked slice. */
  onItemClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone 400px height. */
  fill?: boolean;
}

/** The props Recharts passes to a Pie `label` renderer. */
interface PieLabelProps {
  index?: number;
}

interface PointerLike {
  clientX?: number;
  clientY?: number;
}

const { donutTotal, donutCaption, donutOutsideLabel } = DASHBOARD_TYPOGRAPHY;

/** The largest font size, at most `size`, at which `text` fits `maxWidth` (the measurer is 12px). */
function fitFontSize(text: string, size: number, maxWidth: number, measure: TextMeasurer) {
  const width = (measure(text) * size) / 12;

  return width > maxWidth && width > 0 ? Math.max(12, (size * maxWidth) / width) : size;
}

/**
 * One slice's outside label with its leader, and the slice anchor (always
 * drawn): the BDD steps hover and click a slice at its `data-x` / `data-y`.
 */
function SliceLabel({ layout, label }: { layout: DonutLabelLayout; label: string }) {
  const [p1, p2, p3] = layout.leader;

  return (
    <g>
      <g
        data-label={label}
        data-testid='chart-donut-slice-anchor'
        data-x={layout.anchor.x.toFixed(2)}
        data-y={layout.anchor.y.toFixed(2)}
      />
      {layout.visible ? (
        <>
          <polyline
            fill='none'
            pointerEvents='none'
            points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`}
            stroke='var(--border-primary)'
            strokeWidth={1}
          />
          <text
            className='fill-current text-chart-outside-label'
            data-label={label}
            data-parity-id='dash-donut-outside-label'
            data-testid='chart-donut-outside-label'
            dominantBaseline='central'
            style={{ fontSize: donutOutsideLabel.size, lineHeight: `${donutOutsideLabel.lineHeight}px` }}
            textAnchor={layout.side === 'right' ? 'start' : 'end'}
            x={layout.textX}
            y={layout.textY}
          >
            {layout.text}
          </text>
        </>
      ) : null}
    </g>
  );
}

/**
 * The ring's outer circle, without paint: the visual parity probe measures
 * `dash-donut-ring` on it. Recharts renders it through `<Customized>`, which
 * adds the whole chart state to the element's props, so this component takes
 * only its own and none of them reaches the DOM.
 */
function DonutRingOutline({ centerX, centerY, radius }: { centerX: number; centerY: number; radius: number }) {
  return (
    <circle
      cx={centerX}
      cy={centerY}
      data-parity-id='dash-donut-ring'
      data-testid='chart-donut-ring'
      fill='none'
      pointerEvents='none'
      r={radius}
      stroke='none'
    />
  );
}

interface DonutPlotProps {
  /** The positive items, in display order. */
  slices: ChartDataItem[];
  total: number;
  width: number;
  /** The plot height; `legendHeight` is reserved below it. */
  height: number;
  legendHeight: number;
  clickable: boolean;
  onSliceClick: (_: unknown, index: number, event?: unknown) => void;
  onSliceEnter: (_: unknown, index: number, event?: PointerLike) => void;
  onSliceLeave: () => void;
}

/**
 * The ring, its outside labels and the total. Memoized: hovering a slice
 * changes none of its props, so neither the geometry nor the label layout
 * (which measures every label) runs again until the data or the size changes.
 */
const DonutPlot = memo(function DonutPlot({
  slices,
  total,
  width,
  height,
  legendHeight,
  clickable,
  onSliceClick,
  onSliceEnter,
  onSliceLeave,
}: DonutPlotProps) {
  const { t } = useTranslation();
  const { style, format } = useChartContext();
  const { measure10, measure12 } = useChartMeasure();
  // No animation while the widget box resizes, nor after it until the data changes (W21). Recharts
  // starts a pie whose animation turns back on from empty, so that first new data sweeps in.
  const animation = useChartAnimation(slices);
  const cx = width / 2;
  const cy = height / 2;
  const geometry = useMemo(
    () => computeDonutGeometry(width, height + legendHeight, legendHeight, style.showDataLabels),
    [width, height, legendHeight, style.showDataLabels]
  );
  const labels = useMemo(
    () =>
      layoutDonutLabels(
        slices.map((item) => ({ name: item.label, value: item.value, valueText: format(item.value, 'label') })),
        { cx, cy, outer: geometry.outer, inner: geometry.inner, labelsOn: geometry.labelsOn },
        { width, height },
        measure10
      ),
    [slices, format, cx, cy, geometry, width, height, measure10]
  );
  const renderLabel = useCallback(
    ({ index = 0 }: PieLabelProps) =>
      labels[index] ? <SliceLabel label={slices[index].label} layout={labels[index]} /> : null,
    [labels, slices]
  );
  const ring = useMemo(
    () => <DonutRingOutline centerX={cx} centerY={cy} radius={geometry.outer} />,
    [cx, cy, geometry.outer]
  );
  const centerWidth = CHART_DONUT_CENTER_WIDTH_FACTOR * geometry.inner;
  const totalText = format(total, 'center');
  const totalFont = fitFontSize(totalText, geometry.totalFont, centerWidth, measure12);

  return (
    <div className='relative h-full w-full'>
      <PieChart height={height} width={width}>
        <Pie
          // Recharts' bar timing (400ms from the start) instead of the slower pie default.
          animationBegin={0}
          animationDuration={CHART_ENTRY_ANIMATION_MS}
          cursor={clickable ? 'pointer' : undefined}
          cx={cx}
          cy={cy}
          data={slices}
          dataKey='value'
          endAngle={-270}
          innerRadius={geometry.inner}
          isAnimationActive={animation}
          label={renderLabel}
          labelLine={false}
          nameKey='label'
          onClick={onSliceClick}
          onMouseEnter={onSliceEnter}
          onMouseLeave={onSliceLeave}
          outerRadius={geometry.outer}
          paddingAngle={0}
          startAngle={90}
          stroke='var(--dash-card-bg)'
          strokeWidth={1}
        >
          {slices.map((item) => (
            <Cell fill={item.color} key={chartItemKey(item)} />
          ))}
        </Pie>
        <Customized component={ring} />
      </PieChart>
      {geometry.showTotal ? (
        <div
          className='pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center'
          style={{ left: cx, top: cy, maxWidth: centerWidth, gap: 2 }}
        >
          <div
            className='max-w-full truncate tabular-nums text-text-primary'
            data-parity-id='dash-donut-total'
            data-testid='chart-donut-total'
            data-value={total}
            style={{ fontSize: totalFont, lineHeight: 1.1, fontWeight: donutTotal.weight }}
          >
            {totalText}
          </div>
          {geometry.showCaption ? (
            <div
              className='max-w-full truncate text-text-secondary'
              data-parity-id='dash-donut-caption'
              data-testid='chart-donut-caption'
              style={{ fontSize: donutCaption.size, lineHeight: `${donutCaption.lineHeight}px` }}
            >
              {t('chart.total', { defaultValue: 'Total' })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

/**
 * Donut chart (WP10 §2.2): positive values only, a thin ring with 1px gaps
 * in the card color starting at 12 o'clock, the rounded total in the centre,
 * outside labels with leaders, a paginated category legend.
 */
function DonutChartWidgetImpl({ data, onItemClick, fill = false }: DonutChartWidgetProps) {
  const { style, format, paint, mobile } = useChartContext();
  // One item per category (its total and colour); slices, shares and the total come from the positive values only.
  const items = useMemo(() => toCategoryItems(data, paint), [data, paint]);
  const slices = useMemo(() => items.filter((item) => item.value > 0), [items]);
  const total = useMemo(() => slices.reduce((sum, item) => sum + item.value, 0), [slices]);
  const { hoveredIndex, pointer, show, leave, tap, frameHandlers } = useChartHover(slices, {
    mobile,
    chartType: ChartType.Donut,
  });
  const legend = useChartLegend(ChartType.Donut, style.legendPosition, slices);
  const rows = useChartA11yRows(items, format);
  const hovered = hoveredIndex === null ? undefined : slices[hoveredIndex];
  const tooltip = useChartItemTooltip(
    hovered,
    hovered ? `${format(hovered.value, 'tooltip')} (${formatShare(hovered.value, total)})` : undefined,
    hovered?.color,
    Boolean(onItemClick),
    mobile
  );

  // A slice click drills at once; in a mobile context the first tap shows its tooltip (`resolveChartTap`).
  const handleClick = useCallback(
    (_: unknown, index: number, event?: unknown) => {
      const slice = slices[index];
      const categoryIndex = slice ? data.categories.findIndex((category) => category.key === slice.key) : -1;

      tap(categoryIndex === -1 ? null : { index, key: data.categories[categoryIndex].key }, event, () => {
        const item = toDrillItem(data, { categoryIndex, seriesIndex: null }, paint);

        if (item) onItemClick?.(item);
      });
    },
    [slices, data, paint, onItemClick, tap]
  );
  const handleEnter = useCallback((_: unknown, index: number, event?: PointerLike) => show(index, event), [show]);

  if (slices.length === 0) {
    return <ChartNoDataState fill={fill} variant='donut' />;
  }

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={frameHandlers}
      legend={legend}
      pointer={pointer}
      rows={rows}
      testId='donut-chart-widget'
      tooltip={tooltip}
      truncationCount={truncationCaptionCount(data)}
    >
      {({ width, height, legendHeight }) => (
        <DonutPlot
          clickable={Boolean(onItemClick)}
          height={height}
          legendHeight={legendHeight}
          onSliceClick={handleClick}
          onSliceEnter={handleEnter}
          onSliceLeave={leave}
          slices={slices}
          total={total}
          width={width}
        />
      )}
    </ChartFrame>
  );
}

// `ChartProvider` hands over a new `data` array only when the content changed
// and a stable `onItemClick`, so the default shallow comparison is enough.
export const DonutChartWidget = memo(DonutChartWidgetImpl);

export default DonutChartWidget;
