import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartAggregationType, ChartDataItem, ChartNumberFormat } from '@/application/database-yjs/chart.type';
import { NumberFormat } from '@/application/database-yjs/fields';
import { cn } from '@/lib/utils';

import { formatNumberChartValue } from './numberChartUtils';

export interface NumberChartProps {
  /** The single aggregated item; `rowIds` holds every counted row. */
  item: ChartDataItem | null;
  /** Resolved title (custom or generated). */
  title: string;
  numberFormat: ChartNumberFormat;
  aggregationType: ChartAggregationType;
  /** Y field number format when the Y field is a Number field. */
  fieldNumberFormat?: NumberFormat | null;
  /** Drill-down; receives the item relabelled with the title. */
  onClick?: (item: ChartDataItem) => void;
}

/**
 * Notion-style "Number" chart: a KPI tile that shows one big aggregated value.
 * Font size follows the container width so it reads well in both a full page
 * and a small dashboard widget.
 */
function NumberChart({ item, title, numberFormat, aggregationType, fieldNumberFormat, onClick }: NumberChartProps) {
  const { t } = useTranslation();
  const isEmpty = !item || item.rowIds.length === 0;

  // One call on hoisted formatters: cheaper than a memo's dependency compare.
  const formatted = item ? formatNumberChartValue(item.value, { numberFormat, aggregationType, fieldNumberFormat }) : '';

  const clickable = !isEmpty && !!onClick;

  const handleClick = useCallback(() => {
    if (!item || !onClick) return;
    onClick({ ...item, label: title });
  }, [item, onClick, title]);

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
          {formatted}
        </button>
      )}
      {title && (
        <div data-testid='number-chart-title' className='max-w-full truncate text-sm text-text-secondary'>
          {title}
        </div>
      )}
    </div>
  );
}

export default memo(NumberChart);
