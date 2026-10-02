import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cell, Customized, Pie, PieChart } from 'recharts';

import { formatShare } from '@/application/database-yjs/chart-format';
import {
  computeDonutGeometry,
  DonutLabelLayout,
  layoutDonutLabels,
  TextMeasurer,
} from '@/application/database-yjs/chart-scale';
import { ChartDataItem, ChartType } from '@/application/database-yjs/chart.type';
import { DASHBOARD_TYPOGRAPHY } from '@/application/database-yjs/dashboard-geometry';
import { ChartNoDataState } from '@/components/database/chart/ChartStates';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { ChartFrame, ChartFrameTooltip } from './ChartFrame';
import { chartDataEqual, chartItemKey } from './chartUtils';
import { useChartMeasure } from './measureText';
import { useChartA11yRows, useChartLegend } from './useChartFrameModels';
import { useChartHover } from './useChartHover';
import { useReducedMotion } from './useReducedMotion';

interface DonutChartWidgetProps {
  data: ChartDataItem[];
  onSliceClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone 400px height. */
  fill?: boolean;
}

/** The props Recharts passes to a Pie `label` renderer. */
interface PieLabelProps {
  index?: number;
}

const { donutTotal, donutCaption, donutOutsideLabel } = DASHBOARD_TYPOGRAPHY;

/** Entry animation of the slices (WP10 §2.5: the Recharts bar timing). */
const ENTRY_ANIMATION_MS = 400;

/** The largest font size, at most `size`, at which `text` fits `maxWidth` (the measurer is 12px). */
function fitFontSize(text: string, size: number, maxWidth: number, measure: TextMeasurer) {
  const width = (measure(text) * size) / 12;

  return width > maxWidth && width > 0 ? Math.max(12, (size * maxWidth) / width) : size;
}

/** One slice's outside label with its leader, and the anchor tests point at (always drawn). */
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
 * Donut chart (WP10 §2.2): positive values only, a thin ring with 1px gaps
 * in the card color starting at 12 o'clock, the rounded total in the centre,
 * outside labels with leaders, a paginated category legend.
 */
function DonutChartWidgetImpl({ data, onSliceClick, fill = false }: DonutChartWidgetProps) {
  const { t } = useTranslation();
  const { style, format } = useChartContext();
  const { measure10, measure12 } = useChartMeasure();
  const reducedMotion = useReducedMotion();
  // Slices, shares and the total come from the positive values only.
  const slices = useMemo(() => data.filter((item) => item.value > 0), [data]);
  const total = useMemo(() => slices.reduce((sum, item) => sum + item.value, 0), [slices]);
  const { hover, show, clear, frameHandlers } = useChartHover(slices);
  const legend = useChartLegend(ChartType.Donut, style.legendPosition, slices);
  const rows = useChartA11yRows(data, format);
  const hovered = hover ? slices[hover.index] : undefined;
  const tooltip: ChartFrameTooltip | null =
    hover && hovered
      ? {
          clientX: hover.clientX,
          clientY: hover.clientY,
          rows: [
            {
              color: hovered.color,
              name: hovered.label,
              value: `${format(hovered.value, 'tooltip')} (${formatShare(hovered.value, total)})`,
            },
          ],
          showDrilldownHint: Boolean(onSliceClick),
        }
      : null;

  const handleClick = useCallback(
    (_: unknown, index: number) => {
      const item = slices[index];

      if (item) onSliceClick?.(item);
    },
    [slices, onSliceClick]
  );

  if (slices.length === 0) {
    return <ChartNoDataState fill={fill} variant='donut' />;
  }

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={frameHandlers}
      legend={legend}
      rows={rows}
      testId='donut-chart-widget'
      tooltip={tooltip}
    >
      {({ width, height, legendHeight }) => {
        const geometry = computeDonutGeometry(width, height + legendHeight, legendHeight, style.showDataLabels);
        const cx = width / 2;
        const cy = height / 2;
        const labels = layoutDonutLabels(
          slices.map((item) => ({ name: item.label, value: item.value, valueText: format(item.value, 'label') })),
          { cx, cy, outer: geometry.outer, inner: geometry.inner, labelsOn: geometry.labelsOn },
          { width, height },
          measure10
        );
        const totalText = format(total, 'center');
        const totalFont = fitFontSize(totalText, geometry.totalFont, 1.6 * geometry.inner, measure12);
        const renderLabel = ({ index = 0 }: PieLabelProps) =>
          labels[index] ? <SliceLabel label={slices[index].label} layout={labels[index]} /> : null;

        return (
          <div className='relative h-full w-full'>
            <PieChart height={height} width={width}>
              <Pie
                // Recharts' bar timing (400ms from the start) instead of the slower pie default.
                animationBegin={0}
                animationDuration={ENTRY_ANIMATION_MS}
                cursor={onSliceClick ? 'pointer' : undefined}
                cx={cx}
                cy={cy}
                data={slices}
                dataKey='value'
                endAngle={-270}
                innerRadius={geometry.inner}
                isAnimationActive={!reducedMotion}
                label={renderLabel}
                labelLine={false}
                nameKey='label'
                onClick={handleClick}
                onMouseEnter={(_: unknown, index: number, event?: { clientX?: number; clientY?: number }) =>
                  show(index, event)
                }
                onMouseLeave={clear}
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
              <Customized
                component={
                  <circle
                    cx={cx}
                    cy={cy}
                    data-parity-id='dash-donut-ring'
                    data-testid='chart-donut-ring'
                    fill='none'
                    pointerEvents='none'
                    r={geometry.outer}
                    stroke='none'
                  />
                }
              />
            </PieChart>
            {geometry.showTotal ? (
              <div
                className='pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center'
                style={{ left: cx, top: cy, maxWidth: 1.6 * geometry.inner, gap: 2 }}
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
      }}
    </ChartFrame>
  );
}

// Memoized with content-equality so Yjs hydration micro-batches don't rebuild
// the recharts SVG. `onSliceClick` is `useCallback`-stable in `ChartProvider`.
export const DonutChartWidget = memo(DonutChartWidgetImpl, (prev, next) => {
  return prev.onSliceClick === next.onSliceClick && prev.fill === next.fill && chartDataEqual(prev.data, next.data);
});

export default DonutChartWidget;
