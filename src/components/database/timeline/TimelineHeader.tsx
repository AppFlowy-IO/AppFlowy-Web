import { memo } from 'react';

import { cn } from '@/lib/utils';

import { TIMELINE_HEADER_HEIGHT } from './constants';
import { BarRect, HeaderColumn, HeaderSegment } from './scale/geometry';
import { TimelineHeaderMode } from './scale/presets';

interface TimelineHeaderProps {
  mode: TimelineHeaderMode;
  segments: HeaderSegment[];
  columns: HeaderColumn[];
  canvasWidth: number;
  /** Span of the bar being dragged, echoed behind the column labels. */
  highlight?: BarRect | null;
  /** Width of the sticky sidebar corner that segment labels must stay clear of. */
  stickyOffset: number;
}

/**
 * One header row styled like the calendar's day header: `text-sm` labels,
 * today as the filled pill. Fine scales label every column; the Year scale
 * labels month segments instead, each pinned with `position: sticky` so the
 * current month stays readable while scrolling.
 */
export const TimelineHeader = memo(
  ({ mode, segments, columns, canvasWidth, highlight, stickyOffset }: TimelineHeaderProps) => {
    return (
      <div
        className='relative border-b border-border-primary'
        style={{ width: canvasWidth, height: TIMELINE_HEADER_HEIGHT }}
        data-testid='timeline-header'
      >
        {mode === 'segments'
          ? segments.map((segment) => (
              <div
                key={segment.start.getTime()}
                className='absolute top-0 flex h-full items-center border-l border-border-primary'
                style={{ left: segment.x, width: segment.width }}
              >
                <span
                  className='sticky whitespace-nowrap px-2 text-sm font-medium text-text-primary'
                  style={{ left: stickyOffset }}
                  data-testid='timeline-header-segment'
                >
                  {segment.label}
                </span>
              </div>
            ))
          : columns.map((column) => (
              <div
                key={column.index}
                className={cn(
                  'absolute top-0 flex h-full items-center justify-center text-sm text-text-primary',
                  column.isWeekend && 'bg-surface-container-layer-00'
                )}
                style={{ left: column.x, width: column.width }}
                data-testid={column.isToday ? 'timeline-header-today' : undefined}
              >
                {column.label ? (
                  <span
                    className={cn(
                      'relative z-[2] whitespace-nowrap',
                      column.isToday &&
                        'flex h-6 min-w-6 items-center justify-center rounded-300 bg-other-colors-filled-today px-1 font-medium text-text-inverse'
                    )}
                  >
                    {column.label}
                  </span>
                ) : null}
              </div>
            ))}
        {highlight ? (
          <div
            aria-hidden
            className='absolute inset-y-1 z-[1] rounded-300 bg-fill-theme-select'
            style={{ left: highlight.left, width: highlight.width }}
            data-testid='timeline-header-highlight'
          />
        ) : null}
      </div>
    );
  }
);

TimelineHeader.displayName = 'TimelineHeader';
