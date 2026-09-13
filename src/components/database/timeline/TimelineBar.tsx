import dayjs from 'dayjs';
import { memo, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Column } from '@/application/database-yjs';
import { CardField } from '@/components/database/components/field/CardField';
import { EventIconButton } from '@/components/database/fullcalendar/event/components/EventIconButton';
import {
  calendarEventCompletionTime,
  useCalendarEventPast,
} from '@/components/database/fullcalendar/event/eventAppearance';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { TIMELINE_BAR_INSET, TIMELINE_ROW_HEIGHT } from './constants';
import { TimelineDragMode } from './hooks/useTimelineDrag';
import { TimelineRowModel } from './hooks/useTimelineRows';
import { BarRect, calendarDaysBetween, getBarSpan, ICON_ONLY_BAR_WIDTH } from './scale/geometry';

const CONTENT_GAP = 4;
const HANDLE_WIDTH = 8;
const PROGRESS_HANDLE_SIZE = 10;

export interface TimelineBarDragLabel {
  side: 'start' | 'end';
  text: string;
}

interface TimelineBarProps {
  row: TimelineRowModel;
  rect: BarRect;
  /** Non-primary properties shown as chips after the title. */
  propertyFields: Column[];
  editable: boolean;
  selected?: boolean;
  /** This bar is the one being dragged; its rect is the live preview. */
  dragging?: boolean;
  /** Another bar's drag is moving this one along (a dependent). */
  following?: boolean;
  dragLabel?: TimelineBarDragLabel;
  /** 0–100 when a progress field is bound. */
  progress?: number;
  /** Progress value while the progress handle is being dragged. */
  progressPreview?: number;
  /** Suppresses the hover card, e.g. during any drag. */
  hoverDisabled?: boolean;
  /** User-preference time formatter, owned by the view so bars don't subscribe individually. */
  formatTime: (date: Date) => string;
  /** A dependency field is bound: show the connector handle and accept link drops. */
  linkable?: boolean;
  /** Another bar's connector is being dragged over this one. */
  linkTarget?: boolean;
  onLinkPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpen?: (rowId: string) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>, mode: TimelineDragMode) => void;
}

/** frappe-style hover card: title, dates and duration (plus progress when bound). */
function BarHoverCard({ row, progress }: { row: TimelineRowModel; progress?: number }) {
  const { t } = useTranslation();

  if (!row.start) return null;
  const span = getBarSpan(row.start, row.end, row.allDay);
  const start = dayjs(span.start);
  const lastDay = dayjs(span.endExclusive).subtract(1, 'day');
  const dates = row.allDay
    ? lastDay.isSame(start, 'day')
      ? start.format('MMM D, YYYY')
      : `${start.format('MMM D')} – ${lastDay.format('MMM D, YYYY')}`
    : `${start.format('MMM D, h:mm A')} – ${dayjs(span.endExclusive).format('h:mm A')}`;
  const days = row.allDay ? calendarDaysBetween(span.start, span.endExclusive) : undefined;

  return (
    <div className='flex max-w-[280px] flex-col gap-0.5' data-testid='timeline-bar-hover-card'>
      <span className='font-medium'>{row.title || t('grid.row.titlePlaceholder', { defaultValue: 'Untitled' })}</span>
      <span className='text-text-secondary'>
        {dates}
        {days !== undefined ? ` · ${t('timeline.popup.duration', { count: days, defaultValue: `${days} days` })}` : ''}
      </span>
      {progress !== undefined ? (
        <span className='text-text-secondary'>
          {t('timeline.popup.progress', { percent: progress, defaultValue: `${progress}% complete` })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A row's bar. The title is drawn twice: a muted copy underneath the bar and
 * the real one clipped inside it. Where the bar is too short the muted copy
 * shows past its right edge, which is how Notion lets short bars stay readable.
 */
export const TimelineBar = memo(
  ({
    row,
    rect,
    propertyFields,
    editable,
    selected,
    dragging,
    following,
    dragLabel,
    progress,
    progressPreview,
    hoverDisabled,
    formatTime,
    linkable,
    linkTarget,
    onLinkPointerDown,
    onOpen,
    onPointerDown,
  }: TimelineBarProps) => {
    const { rowId, title } = row;
    const { t } = useTranslation();
    // Too narrow for text: show the icon-only chip and let the title spill past it.
    const iconOnly = rect.width < ICON_ONLY_BAR_WIDTH;
    const spilledLabelOffset = rect.width + CONTENT_GAP;
    const shownProgress = progressPreview ?? progress;
    const showProgress = shownProgress !== undefined;
    const highlighted = dragging || following || selected;
    // Like calendar cards, a bar whose span has ended fades unless it is being handled.
    const isPast = useCalendarEventPast(
      calendarEventCompletionTime({ start: row.start, end: row.end, allDay: row.allDay, isRange: row.isRange })
    );

    const bar = (
      <div
        role='button'
        tabIndex={0}
        aria-pressed={selected}
        onPointerDown={(event) => {
          if (editable) onPointerDown?.(event, 'move');
        }}
        onClick={(event) => {
          event.stopPropagation();
          // With editing on, the drag hook turns a still press into the open action.
          if (!editable) onOpen?.(rowId);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen?.(rowId);
          }
        }}
        className={cn(
          // The calendar's two card treatments: filled chip for all-day rows,
          // transparent time-prefixed card for timed rows.
          'event-content absolute inset-0 flex select-none flex-col items-center overflow-hidden rounded-200 border border-transparent text-xs font-medium',
          row.allDay
            ? 'bg-other-colors-filled-event text-other-colors-text-event hover:bg-other-colors-filled-event-hover'
            : 'time-event-content text-text-primary hover:bg-fill-content-hover',
          'transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick',
          editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          highlighted && (row.allDay ? 'bg-other-colors-filled-event-hover' : 'bg-fill-content-hover'),
          (highlighted || linkTarget) && 'ring-1 ring-fill-theme-thick',
          'py-0 pl-1 pr-1'
        )}
      >
        {showProgress ? (
          <div
            aria-hidden
            className='pointer-events-none absolute inset-y-0 left-0 bg-fill-theme-thick opacity-20'
            style={{ width: `${shownProgress}%` }}
            data-testid={`timeline-progress-${rowId}`}
          />
        ) : null}
        <div className='relative flex h-full max-h-full w-full flex-1 items-center gap-1 overflow-hidden'>
          <div className='event-line h-4 w-1 shrink-0 rounded-200 bg-fill-theme-thick' />
          <div
            className={cn(
              'event-inner flex h-full max-h-full w-full flex-1 flex-col justify-center overflow-hidden',
              isPast && !highlighted && 'opacity-50'
            )}
          >
            <div className='flex h-full items-center gap-1 truncate'>
              {!iconOnly && !row.allDay && row.start ? (
                <span className='time-slot shrink-0 text-xs font-normal text-text-primary'>{formatTime(row.start)}</span>
              ) : null}
              <div className={cn('flex w-full items-center gap-1 truncate', iconOnly && 'justify-center')}>
                <EventIconButton rowId={rowId} readOnly={!editable} />
                {iconOnly ? null : (
                  <span className='min-w-[28px] flex-1 truncate'>
                    {title || t('grid.row.titlePlaceholder', { defaultValue: 'Untitled' })}
                  </span>
                )}
                {iconOnly
                  ? null
                  : propertyFields.map((field) => (
                      <span key={field.fieldId} className='flex shrink-0 items-center whitespace-nowrap'>
                        <CardField rowId={rowId} fieldId={field.fieldId} />
                      </span>
                    ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );

    return (
      <div
        className='group/bar absolute'
        style={{
          left: rect.left,
          top: TIMELINE_BAR_INSET,
          height: TIMELINE_ROW_HEIGHT - TIMELINE_BAR_INSET * 2,
          width: rect.width,
        }}
        data-testid={`timeline-bar-${rowId}`}
        data-timeline-bar={rowId}
        data-dragging={dragging ? 'true' : undefined}
        data-selected={selected ? 'true' : undefined}
        data-link-target={linkTarget ? 'true' : undefined}
      >
        {iconOnly ? (
          <div
            aria-hidden
            className='pointer-events-none absolute top-0 flex h-full items-center whitespace-nowrap text-xs font-medium text-text-tertiary'
            style={{ left: spilledLabelOffset }}
          >
            {!row.allDay && row.start ? `${formatTime(row.start)} ` : ''}
            {title}
          </div>
        ) : null}

        {/* Keep the element structure stable: swapping the bar between a bare div
            and a Tooltip subtree would remount every visible bar on each press. */}
        <Tooltip delayDuration={350} disableHoverableContent>
          <TooltipTrigger asChild>{bar}</TooltipTrigger>
          {hoverDisabled ? null : (
            <TooltipContent side='top' align='start' className='text-xs'>
              <BarHoverCard row={row} progress={progress} />
            </TooltipContent>
          )}
        </Tooltip>

        {editable ? (
          <>
            <div
              aria-hidden
              data-testid={`timeline-handle-start-${rowId}`}
              className='absolute inset-y-0 left-0 z-[1] flex cursor-ew-resize items-center justify-center'
              style={{ width: HANDLE_WIDTH }}
              onPointerDown={(event) => onPointerDown?.(event, 'resize-start')}
            >
              <span className='h-3 w-0.5 rounded-full bg-fill-theme-thick opacity-0 transition-opacity group-hover/bar:opacity-100' />
            </div>
            <div
              aria-hidden
              data-testid={`timeline-handle-end-${rowId}`}
              className='absolute inset-y-0 right-0 z-[1] flex cursor-ew-resize items-center justify-center'
              style={{ width: HANDLE_WIDTH }}
              onPointerDown={(event) => onPointerDown?.(event, 'resize-end')}
            >
              <span className='h-3 w-0.5 rounded-full bg-fill-theme-thick opacity-0 transition-opacity group-hover/bar:opacity-100' />
            </div>
            {linkable ? (
              <button
                type='button'
                tabIndex={-1}
                aria-label={t('timeline.linkHandle', { defaultValue: 'Drag to add a dependency' })}
                title={t('timeline.linkHandle', { defaultValue: 'Drag to add a dependency' })}
                data-testid={`timeline-link-${rowId}`}
                className='absolute top-1/2 z-[3] flex h-4 w-4 -translate-y-1/2 cursor-crosshair items-center justify-center opacity-0 transition-opacity focus-visible:opacity-100 group-hover/bar:opacity-100'
                style={{ left: '100%', marginLeft: 2 }}
                onPointerDown={onLinkPointerDown}
                onClick={(event) => event.stopPropagation()}
              >
                <span className='h-2.5 w-2.5 rounded-full border-2 border-fill-theme-thick bg-background-primary' />
              </button>
            ) : null}
            {showProgress && !iconOnly ? (
              <div
                aria-hidden
                data-testid={`timeline-handle-progress-${rowId}`}
                className='absolute bottom-0 z-[2] flex cursor-col-resize items-end justify-center opacity-0 transition-opacity group-hover/bar:opacity-100'
                style={{
                  left: `calc(${shownProgress}% - ${PROGRESS_HANDLE_SIZE / 2}px)`,
                  width: PROGRESS_HANDLE_SIZE,
                  height: PROGRESS_HANDLE_SIZE,
                }}
                onPointerDown={(event) => onPointerDown?.(event, 'progress')}
              >
                <span className='h-2 w-2 rounded-full border border-background-primary bg-fill-theme-thick' />
              </div>
            ) : null}
          </>
        ) : null}

        {dragLabel ? (
          <div
            className={cn(
              'pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded-200 border border-border-primary bg-surface-layer-04 px-1.5 py-0.5 text-xs text-text-secondary shadow-sm',
              dragLabel.side === 'start' ? 'right-full mr-1.5' : 'left-full ml-1.5'
            )}
            data-testid='timeline-drag-label'
          >
            {dragLabel.text}
          </div>
        ) : null}
      </div>
    );
  }
);

TimelineBar.displayName = 'TimelineBar';
