import { useTranslation } from 'react-i18next';

import { ChartNoDataState } from '@/components/database/chart/ChartStates';
import { cn } from '@/lib/utils';

interface ChartEmptyStateProps {
  type: 'no-field' | 'no-data';
  /** Fill a dashboard widget card. */
  fill?: boolean;
  /** `no-data` only: draw the empty donut ring. */
  variant?: 'donut';
}

/**
 * Empty state of the chart view: no groupable field, or no data. Both use
 * the minimal chart state style (14/20 tertiary text in the unchanged card).
 */
export function ChartEmptyState({ type, fill, variant }: ChartEmptyStateProps) {
  const { t } = useTranslation();

  if (type === 'no-data') return <ChartNoDataState fill={fill} variant={variant} />;

  return (
    <div
      className={cn('flex w-full flex-1 flex-col items-center justify-center p-8 text-center', fill && 'h-full min-h-0')}
      data-testid='chart-no-field'
    >
      <p className='max-w-md text-sm text-text-tertiary'>
        {t('chart.emptyState.noField', 'No fields available for grouping')}
      </p>
    </div>
  );
}

export default ChartEmptyState;
