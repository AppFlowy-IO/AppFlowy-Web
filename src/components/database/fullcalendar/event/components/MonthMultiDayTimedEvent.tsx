import { EventApi, EventContentArg } from '@fullcalendar/core';
import dayjs from 'dayjs';
import { useCallback } from 'react';

import { useTimeFormat } from '@/components/database/fullcalendar/hooks';
import { cn } from '@/lib/utils';

import { EventIconButton } from './EventIconButton';

interface MonthMultiDayTimedEventProps {
  event: EventApi;
  eventInfo: EventContentArg;
  onClick?: (event: EventApi) => void;
  showLeftIndicator?: boolean;
  className?: string;
  rowId: string;
}

export function MonthMultiDayTimedEvent({
  event,
  eventInfo,
  onClick,
  showLeftIndicator = true,
  className,
  rowId,
}: MonthMultiDayTimedEventProps) {
  const { formatTimeDisplay } = useTimeFormat();
  const isEventStart = eventInfo.isStart;
  const isEventEnd = eventInfo.isEnd;

  // Check if event is in the past - use end time if available, otherwise start time
  const eventTime = event.end || event.start;
  const isPastEvent = eventTime && dayjs(eventTime).isBefore(dayjs(), 'minute');

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

  const getSegmentConfig = useCallback(() => {
    if (isEventStart && !isEventEnd) {
      return {
        className: 'rounded-l-200',
        leftArrow: false,
        rightArrow: true,
      };
    } else if (isEventEnd && !isEventStart) {
      return {
        className: 'rounded-r-200',
        leftArrow: true,
        rightArrow: false,
      };
    } else if (!isEventStart && !isEventEnd) {
      return {
        className: '',
        leftArrow: true,
        rightArrow: true,
      };
    } else {
      return {
        className: 'rounded-200',
        leftArrow: false,
        rightArrow: false,
      };
    }
  }, [isEventStart, isEventEnd]);

  const segmentConfig = getSegmentConfig();

  return (
    <div
      className={cn(
        'event-content relative flex h-full max-h-full min-h-[22px] w-full cursor-pointer flex-col items-center overflow-hidden text-xs font-medium hover:bg-other-colors-filled-event-hover',
        isPastEvent
          ? 'bg-other-colors-filled-event/60 text-other-colors-text-event/60'
          : 'bg-other-colors-filled-event text-other-colors-text-event',
        'transition-shadow duration-200',
        'flex border border-transparent',
        segmentConfig.leftArrow ? 'left-arrow pl-2' : 'pl-1',
        segmentConfig.rightArrow ? 'right-arrow pr-2.5' : 'pr-1',
        'py-0',
        segmentConfig.className,
        className
      )}
      onClick={handleClick}
      style={{
        clipPath:
          segmentConfig.leftArrow && segmentConfig.rightArrow
            ? 'polygon(8px 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0% 50%)'
            : segmentConfig.leftArrow
            ? 'polygon(8px 0%, 100% 0%, 100% 100%, 8px 100%, 0% 50%)'
            : segmentConfig.rightArrow
            ? 'polygon(0% 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 0% 100%)'
            : undefined,
      }}
    >
      <div className='relative flex h-full max-h-full w-full flex-1 items-center gap-1 overflow-hidden'>
        {showLeftIndicator && !segmentConfig.leftArrow && (
          <div className='event-line h-4 w-1 rounded-200 bg-fill-theme-thick' />
        )}
        <div className='event-inner flex h-full max-h-full w-full flex-1 flex-col justify-center overflow-hidden'>
          <div className='flex h-full items-center gap-1 truncate'>
            {isEventStart && event.start && (
              <span className='time-slot shrink-0 text-xs font-normal text-other-colors-text-event'>
                {formatTimeDisplay(event.start)}
              </span>
            )}
            {isEventEnd && event.end && !isEventStart && (
              <span className='time-slot shrink-0 text-xs font-normal text-other-colors-text-event'>
                {formatTimeDisplay(event.end)}
              </span>
            )}
            <EventIconButton className='event-time-icon' rowId={rowId} />
            <span className='min-w-[28px] flex-1 truncate'>{getDisplayContent()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}