import { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import type { RowOrdersHydration } from '@/application/database-yjs';
import { cn } from '@/lib/utils';

const ROWS_LOADING_DOT_COLORS = ['#00b5ff', '#e3006d', '#f7931e'] as const;

/** The three bouncing dots every view shows while it reads its rows. */
export const rowsLoadingDots = (
  <div className={'flex h-full items-center gap-1.5'}>
    {ROWS_LOADING_DOT_COLORS.map((color, index) => (
      <span
        key={color}
        className={'h-1.5 w-1.5 animate-bounce rounded-full'}
        style={{
          animationDelay: `${index * 120}ms`,
          animationDuration: '900ms',
          backgroundColor: color,
        }}
      />
    ))}
  </div>
);

export interface RowsLoadingRowProps {
  /** How far the view got; with it the row counts "Loading rows… N/M". */
  hydration?: RowOrdersHydration;
  testId: string;
  /** The test id of the count. */
  progressTestId?: string;
}

/**
 * The loading row of a view that lists its rows (the grid): for a view still
 * reading its rows it reports how many it read, so a slow, large source never
 * looks like an empty result.
 */
export function RowsLoadingRow({ hydration, testId, progressTestId }: RowsLoadingRowProps) {
  const { t } = useTranslation();

  return (
    <div
      data-testid={testId}
      data-loaded-row-count={hydration?.ready}
      data-total-row-count={hydration?.total}
      className={'flex h-9 w-full items-center justify-center gap-2'}
      aria-label={'Loading rows'}
      role={'status'}
    >
      {rowsLoadingDots}
      {hydration ? (
        <span className={'text-xs text-text-tertiary'} data-testid={progressTestId}>
          {t('grid.row.loadingRowsProgress', {
            loaded: hydration.ready,
            total: hydration.total,
            defaultValue: 'Loading rows… {{loaded}}/{{total}}',
          })}
        </span>
      ) : null}
    </div>
  );
}

export interface RowsLoadingPillProps {
  testId: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The loading state of a view that places its rows (a calendar's month, a
 * timeline's lanes): a pill over the top of the view, so the empty month or
 * lane under it never reads as "no rows" while they load (LOADING-DESIGN:
 * skeleton plus "Loading rows…"). It takes no room, so nothing moves when the
 * rows arrive.
 */
export function RowsLoadingPill({ testId, className, style }: RowsLoadingPillProps) {
  const { t } = useTranslation();

  return (
    <div
      data-testid={testId}
      className={cn(
        'pointer-events-none absolute left-1/2 top-2 z-10 flex h-8 -translate-x-1/2 items-center gap-2 rounded-full border border-border-primary bg-background-primary px-3 text-xs text-text-tertiary shadow-sm',
        className
      )}
      style={style}
      role={'status'}
    >
      {rowsLoadingDots}
      <span>{t('grid.row.loadingRows', { defaultValue: 'Loading rows…' })}</span>
    </div>
  );
}
