import { EventApi, EventContentArg } from '@fullcalendar/core';
import dayjs from 'dayjs';
import { useCallback, useMemo } from 'react';

import { useTimeFormat } from '@/components/database/fullcalendar/hooks';
import { cn } from '@/lib/utils';
import { Column } from '@/application/database-yjs';
import { EventPropertiesList } from './EventPropertiesList';

import { EventIconButton } from './EventIconButton';

interface WeekTimedEventProps {
  event: EventApi;
  eventInfo: EventContentArg;
  onClick?: (event: EventApi) => void;
  showLeftIndicator?: boolean;
  className?: string;
  rowId: string;
  showFields?: Column[];
}

export function WeekTimedEvent({ event, eventInfo, onClick, className, rowId, showFields }: WeekTimedEventProps) {
  const { formatTimeDisplay } = useTimeFormat();
  const isEventStart = eventInfo.isStart;
  const isEventEnd = eventInfo.isEnd;
  const isRange = event.extendedProps.isRange;

  const handleClick = () => {
    onClick?.(event);
  };

  const getDisplayContent = useCallback(() => {
    if (isEventStart) {
      return event.title || 'Untitled';
    }

    if (isEventEnd) {
      return `${event.title || 'Untitled'}`;
    } else {
      return `${event.title || 'Untitled'}`;
    }
  }, [isEventStart, isEventEnd, event.title]);

  const renderTimeEvent = useMemo(() => {
    const moreThanHalfHour = dayjs(event.end).diff(dayjs(event.start), 'minute') > 30;
    const isShortEvent = event.end && dayjs(event.end).diff(dayjs(event.start), 'minute') < 30;

    if (isShortEvent) {
      // For short events (< 30 minutes), use single line layout with minimum height
      return (
        <div className='relative flex min-h-[18px] items-center gap-1 py-0.5 text-xs text-other-colors-text-event'>
          <span
            className='event-title  shrink-0 truncate whitespace-nowrap font-medium'
            style={{
              fontSize: '11px',
              lineHeight: '1.2',
            }}
          >
            {getDisplayContent()},
          </span>
          <div className='time-slot flex items-center text-[10px] font-normal'>
            {isEventStart && event.start && <span className='shrink-0'>{formatTimeDisplay(event.start)}</span>}
            <span className='shrink-0'>
              {isEventStart && <span className='mx-0.5'>-</span>}
              {event.end && formatTimeDisplay(event.end)}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          'event-title relative flex pt-[1px] text-xs text-other-colors-text-event',
          moreThanHalfHour
            ? 'h-full max-h-full flex-col pt-[3px]'
            : 'flex-nowrap items-center gap-1 overflow-hidden truncate'
        )}
      >
        <div className={cn('flex min-w-fit items-center gap-1', moreThanHalfHour ? 'w-full' : 'truncate')}>
          <EventIconButton rowId={rowId} />
          <span
            className={cn(
              'event-title whitespace-nowrap  font-medium text-other-colors-text-event',
              moreThanHalfHour ? 'flex-shrink overflow-hidden break-words leading-tight' : 'truncate'
            )}
            style={
              moreThanHalfHour
                ? {
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.1',
                  }
                : undefined
            }
          >
            <span className='w-fit font-semibold'>{getDisplayContent()}</span>
            {moreThanHalfHour ? '' : ','}
          </span>
        </div>
        <div className='time-slot flex h-[16px] items-center text-xs font-normal text-other-colors-text-event-light'>
          {isEventStart && event.start && <span className='shrink-0'>{formatTimeDisplay(event.start)}</span>}
          {isRange && (
            <span className='shrink-0'>
              {isEventStart && <span className='mx-1'>-</span>}
              {event.end && formatTimeDisplay(event.end)}
            </span>
          )}
        </div>
        <EventPropertiesList rowId={rowId} showFields={moreThanHalfHour ? showFields : undefined} />
      </div>
    );
  }, [event.end, event.start, rowId, getDisplayContent, isEventStart, formatTimeDisplay, isRange, showFields]);

  const isShortEvent = event.end && dayjs(event.end).diff(dayjs(event.start), 'minute') < 30;
  const isCompactLayout = !event.end || isShortEvent;

  return (
    <div
      className={cn(
        'event-content  relative flex h-full max-h-full min-h-[22px] w-full cursor-pointer flex-col items-center overflow-hidden !bg-transparent text-xs font-medium hover:!bg-transparent',
        'text-text-primary',
        'transition-shadow duration-200',
        isCompactLayout ? 'min-h-[12px] py-0 pl-1.5 pr-1' : 'py-0 pl-1.5',
        isShortEvent && 'h-[12px]',
        className
      )}
      onClick={handleClick}
    >
      <div className='relative flex h-full max-h-full w-full flex-1 items-center gap-1 overflow-hidden'>
        <div className='event-inner flex h-full max-h-full w-full flex-1 flex-col justify-center overflow-hidden'>
          {renderTimeEvent}
        </div>
      </div>
    </div>
  );
}