import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useWidgetContextOptional } from './WidgetContext';

/**
 * The rows of the view failed to load (LOADING-DESIGN R8): the design's
 * words, with a retry, over the bottom edge of the card. The nested database
 * stays as it is, so the rows that did arrive stay in view.
 */
function WidgetRowsLoadFailed({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      className='absolute inset-x-0 bottom-0 z-10 flex min-h-10 flex-wrap items-center justify-center gap-2 border-t border-border-primary bg-surface-primary px-3 py-1 text-xs leading-[18px] text-text-secondary'
      data-testid='dashboard-widget-rows-failed'
      role='status'
    >
      <span>{t('grid.row.rowsNotLoadedYet', { defaultValue: "Some rows haven't loaded yet" })}</span>
      {onRetry ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='!rounded-200 px-2 font-medium text-text-action focus-visible:ring-2 focus-visible:ring-border-theme-thick'
          onClick={onRetry}
        >
          {t('chart.state.retry', { defaultValue: 'Retry' })}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The content of the widget's shared card surface. The surrounding frame
 * owns its border, so the header and content read as one card without
 * changing the stored row geometry. A failed row load keeps arrived rows
 * visible and adds a retry at the bottom edge.
 *
 * Kept free of heavy imports: `DatabaseViews` loads it eagerly.
 */
export function WidgetBody({ children }: { children: ReactNode }) {
  const widget = useWidgetContextOptional();

  return (
    <div
      className={cn(
        'relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-primary',
        widget?.showWidgetTitles ? 'rounded-b-400' : 'rounded-400'
      )}
      data-editing={widget?.editing ? 'true' : 'false'}
      data-parity-id='dash-widget-card'
      data-testid='dashboard-widget-body'
    >
      {children}
      {widget?.rowsLoadFailed ? <WidgetRowsLoadFailed onRetry={widget.retryRowsLoad} /> : null}
    </div>
  );
}

export default WidgetBody;
