import { memo } from 'react';

import { cn } from '@/lib/utils';

import { HeaderColumn } from './scale/geometry';

interface TimelineGridProps {
  columns: HeaderColumn[];
  /** Horizontal offset of the canvas inside the body (the sticky sidebar). */
  left: number;
  todayX: number;
  showToday: boolean;
}

/**
 * Weekend shading, gridlines and the today line behind the rows. Memoized so
 * drag steps and selection changes don't re-reconcile one div per column.
 */
export const TimelineGrid = memo(({ columns, left, todayX, showToday }: TimelineGridProps) => {
  return (
    <div className='pointer-events-none absolute inset-0 z-0' aria-hidden>
      {columns.map((column) =>
        column.isWeekend || column.gridLine ? (
          <div
            key={column.index}
            className={cn(
              'absolute inset-y-0',
              column.isWeekend && 'bg-surface-container-layer-00',
              column.gridLine && 'border-l border-border-primary'
            )}
            style={{ left: left + column.x, width: column.width }}
          />
        ) : null
      )}
      {showToday ? (
        <div
          className='absolute inset-y-0 w-px bg-other-colors-filled-today'
          style={{ left: left + todayX }}
          data-testid='timeline-today-line'
        />
      ) : null}
    </div>
  );
});

TimelineGrid.displayName = 'TimelineGrid';
