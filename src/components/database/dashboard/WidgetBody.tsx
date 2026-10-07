import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
      className='absolute inset-x-0 bottom-0 z-10 flex h-9 items-center justify-center gap-2 border-t border-border-primary bg-dash-card-bg px-3 text-xs text-text-secondary'
      data-testid='dashboard-widget-rows-failed'
      role='status'
    >
      <span>{t('grid.row.rowsNotLoadedYet', { defaultValue: "Some rows haven't loaded yet" })}</span>
      {onRetry ? (
        <button
          type='button'
          className='rounded-200 px-2 py-0.5 font-medium text-text-action hover:bg-dash-hover-fill'
          onClick={onRetry}
        >
          {t('chart.state.retry', { defaultValue: 'Retry' })}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The widget card: the page color, radius 12, and a 1px ring drawn as a
 * shadow (never a border, so it takes no space), with a faint shadow in light
 * mode. The ring turns to the edit ring in Edit mode (`.dash-card`, see
 * `dashboard-tokens.css`). The same in View and Edit mode otherwise; the
 * content runs edge to edge. A failed row load adds its notice over the
 * bottom edge.
 *
 * Kept free of heavy imports: `DatabaseViews` loads it eagerly.
 */
export function WidgetBody({ children }: { children: ReactNode }) {
  const widget = useWidgetContextOptional();

  return (
    <div
      className='dash-card relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-400 bg-dash-card-bg'
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
