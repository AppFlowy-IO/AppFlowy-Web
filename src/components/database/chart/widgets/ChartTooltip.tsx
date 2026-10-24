import { useTranslation } from 'react-i18next';

import { DASHBOARD_GEOMETRY, DASHBOARD_TYPOGRAPHY } from '@/application/database-yjs/dashboard-geometry';
import { ReactComponent as BulletedListIcon } from '@/assets/icons/bulleted_list.svg';

export interface ChartTooltipRow {
  color?: string;
  name: string;
  /** Already formatted (R-FORMAT `tooltip`, plus the share for donuts and percent bars). */
  value: string;
  /** The series a row of a grouped chart shows (WP12). */
  seriesKey?: string;
}

export interface ChartTooltipProps {
  /** Group title above the rows (WP12's multi-series charts: the category). */
  title?: string;
  rows: ChartTooltipRow[];
  /** Series rows left out after the first ten: a "+{n} more" row. */
  more?: number;
  /** The drill-down hint footer, shown when the chart opens a drill-down. */
  showDrilldownHint?: boolean;
  /** The category the tooltip describes (its label), as `data-category` for tests and the probes. */
  category?: string;
  /**
   * A mobile context (WP14 §1.4.6): the tooltip follows taps, so the hint
   * reads "Tap again to view data" instead of "Click to view data".
   */
  mobile?: boolean;
}

const { tooltip } = DASHBOARD_GEOMETRY;

/**
 * Chart tooltip (spec §8.8): a swatch, the name and the value per row, and
 * the drill-down hint. Presentational; `ChartTooltipLayer` positions it.
 */
export function ChartTooltip({
  title,
  rows,
  more = 0,
  showDrilldownHint = false,
  category,
  mobile = false,
}: ChartTooltipProps) {
  const { t } = useTranslation();

  return (
    <div
      data-testid='chart-tooltip'
      data-category={category}
      data-mobile={mobile ? 'true' : undefined}
      data-parity-id='dash-chart-tooltip'
      className='overflow-hidden border border-chart-tooltip-border bg-chart-tooltip-bg text-xs shadow-dash-tooltip'
      style={{
        borderRadius: tooltip.radius,
        maxWidth: tooltip.maxWidth,
        maxHeight: tooltip.maxHeight,
        lineHeight: `${DASHBOARD_TYPOGRAPHY.tooltip.lineHeight}px`,
      }}
    >
      {title ? (
        <div className='truncate px-3 pt-2.5 font-medium text-text-primary' data-testid='chart-tooltip-title'>
          {title}
        </div>
      ) : null}
      {rows.map((row, index) => (
        <div
          className='flex items-center'
          data-series={row.seriesKey}
          data-testid='chart-tooltip-row'
          key={`${row.seriesKey ?? row.name}-${index}`}
          style={{
            gap: tooltip.gap,
            padding: `${tooltip.rowPaddingBlock}px ${tooltip.rowPaddingInline}px`,
          }}
        >
          <span className='flex min-w-0 items-center gap-2'>
            <span
              className='shrink-0'
              style={{
                width: tooltip.swatch,
                height: tooltip.swatch,
                borderRadius: tooltip.swatchRadius,
                backgroundColor: row.color,
              }}
            />
            <span className='truncate text-text-secondary' data-testid='chart-tooltip-name'>
              {row.name}
            </span>
          </span>
          <span className='ml-auto whitespace-nowrap tabular-nums text-text-tertiary' data-testid='chart-tooltip-value'>
            {row.value}
          </span>
        </div>
      ))}
      {more > 0 ? (
        <div
          className='text-text-tertiary'
          data-testid='chart-tooltip-more'
          style={{ padding: `${tooltip.rowPaddingBlock}px ${tooltip.rowPaddingInline}px` }}
        >
          {t('chart.settings.moreSeries', { n: more, defaultValue: `+${more} more` })}
        </div>
      ) : null}
      {showDrilldownHint ? (
        <>
          <div className='mx-3 h-px bg-chart-tooltip-border' data-parity-id='dash-chart-tooltip__divider' />
          <div
            className='flex items-center gap-1.5 p-3 text-text-secondary'
            data-parity-id='dash-chart-tooltip__footer'
            data-testid='chart-tooltip-footer'
          >
            <BulletedListIcon className='h-3.5 w-3.5 shrink-0' />
            <span>
              {mobile
                ? t('chart.tooltip.tapAgainToView', { defaultValue: 'Tap again to view data' })
                : t('chart.tooltip.clickToView', { defaultValue: 'Click to view data' })}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default ChartTooltip;
