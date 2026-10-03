import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { cn } from '@/lib/utils';

export interface NumberChartProps {
  /** The single aggregated item; `rowIds` holds every counted row. */
  item: ChartDataItem | null;
  /** Resolved title (custom or generated). */
  title: string;
  /** The value as the chart's formatter prints it in `card` mode. */
  valueText: string;
  /** Opens the drill-down; receives the item relabelled with the title. */
  onItemClick?: (item: ChartDataItem) => void;
}

/**
 * Notion-style "Number" chart: a KPI tile that shows one big aggregated value.
 * Font size follows the container width so it reads well in both a full page
 * and a small dashboard widget.
 */
function NumberChart({ item, title, valueText, onItemClick }: NumberChartProps) {
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
      className='flex h-full min-h-[120px] w-full flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center'
      style={{ containerType: 'inline-size' }}
    >
      {isEmpty ? (
        <div data-testid='number-chart-empty' className='text-sm text-text-secondary'>
          {t('chart.number.emptyState', { defaultValue: 'No rows to count' })}
        </div>
      ) : (
        <button
          type='button'
          data-parity-id='dash-number-value'
          data-testid='number-chart-value'
          disabled={!clickable}
          onClick={clickable ? handleClick : undefined}
          title={clickable ? t('chart.tooltip.clickToView', { defaultValue: 'Click to view data' }) : undefined}
          className={cn(
            'max-w-full truncate rounded-300 px-2 font-semibold tabular-nums leading-tight text-text-primary',
            clickable ? 'cursor-pointer hover:bg-fill-content-hover' : 'cursor-default disabled:opacity-100'
          )}
          style={{ fontSize: 'clamp(1.75rem, 14cqw, 4.5rem)' }}
        >
          {valueText}
        </button>
      )}
      {title && (
        <div
          data-parity-id='dash-number-caption'
          data-testid='number-chart-title'
          className='max-w-full truncate text-sm text-text-secondary'
        >
          {title}
        </div>
      )}
    </div>
  );
}

export default memo(NumberChart);
