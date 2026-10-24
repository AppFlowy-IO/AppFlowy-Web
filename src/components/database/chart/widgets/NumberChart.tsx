import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartDataItem, ChartNumberColor } from '@/application/database-yjs/chart.type';
import { cn } from '@/lib/utils';

import { numberColorVar } from './numberChartUtils';

export interface NumberChartProps {
  /** The single aggregated item; `rowIds` holds every counted row. `null` is "No data". */
  item: ChartDataItem | null;
  /** Resolved title (custom or generated); it also labels the drill-down. */
  title: string;
  /** Whether the caption shows (`show_title`). */
  showTitle?: boolean;
  /** The value color (`resolveNumberColor`); `null` draws the default text color. */
  color?: ChartNumberColor | null;
  /** The value as the chart's formatter prints it in `card` mode. */
  valueText: string;
  /** Opens the drill-down; receives the item relabelled with the title. */
  onItemClick?: (item: ChartDataItem) => void;
}

/**
 * The value size: 16% of the card width, between 40 and 60px (desktop
 * `(w × 0.16).clamp(40, 60)`), line height 1.1. The root is the size
 * container and has no horizontal padding, so `cqw` measures the card width.
 */
const VALUE_SIZE_CLASS = '[font-size:clamp(40px,16cqw,60px)] leading-[1.1]';

/**
 * Notion-style "Number" chart: the caption (16/600) above one big aggregated
 * value. The value scales with the card width, uses tabular figures and the
 * static or dynamic number color. With no rows (or no value) the card shows
 * only "No data".
 */
function NumberChart({ item, title, showTitle = true, color = null, valueText, onItemClick }: NumberChartProps) {
  const { t } = useTranslation();
  const isEmpty = !item || item.rowIds.length === 0;
  const clickable = !isEmpty && !!onItemClick;

  const handleClick = useCallback(() => {
    if (!item || !onItemClick) return;
    onItemClick({ ...item, label: title });
  }, [item, onItemClick, title]);

  return (
    <div
      data-testid='number-chart'
      data-empty={isEmpty ? 'true' : 'false'}
      className='flex h-full min-h-[120px] w-full min-w-0 flex-1 flex-col items-center justify-center text-center'
      style={{ containerType: 'inline-size' }}
    >
      {isEmpty ? (
        <div data-testid='number-chart-empty' className='px-6 py-4 text-sm text-text-tertiary'>
          {t('chart.number.emptyState', { defaultValue: 'No data' })}
        </div>
      ) : (
        <div className='flex w-full min-w-0 flex-col items-center justify-center gap-1 px-6 py-4'>
          {showTitle && title ? (
            <div
              data-parity-id='dash-number-caption'
              data-testid='number-chart-title'
              className='max-w-full truncate text-base font-semibold text-chart-number-default'
            >
              {title}
            </div>
          ) : null}
          <button
            type='button'
            data-parity-id='dash-number-value'
            data-testid='number-chart-value'
            data-color={color ?? 'default'}
            disabled={!clickable}
            onClick={clickable ? handleClick : undefined}
            title={clickable ? t('chart.tooltip.clickToView', { defaultValue: 'Click to view data' }) : undefined}
            className={cn(
              'max-w-full truncate rounded-300 px-2 font-semibold tabular-nums',
              VALUE_SIZE_CLASS,
              clickable ? 'cursor-pointer hover:bg-dash-hover-fill' : 'cursor-default disabled:opacity-100'
            )}
            style={{ color: numberColorVar(color) }}
          >
            {valueText}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(NumberChart);
