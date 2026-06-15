import { EventApi, EventContentArg } from '@fullcalendar/core';
import dayjs from 'dayjs';

import { useTimeFormat } from '@/components/database/fullcalendar/hooks';
import { cn } from '@/lib/utils';

import { EventIconButton } from './EventIconButton';

interface MonthTimedEventProps {
  event: EventApi;
  eventInfo: EventContentArg;
  onClick?: (event: EventApi) => void;
  showLeftIndicator?: boolean;
  className?: string;
  rowId: string;
}

export function MonthTimedEvent({ event, onClick, showLeftIndicator = true, className, rowId }: MonthTimedEventProps) {
  const { formatTimeDisplay } = useTimeFormat();
  const handleClick = () => {
    onClick?.(event);
  };


  // Check if event is in the past
  const isPastEvent = event.start && dayjs(event.start).isBefore(dayjs(), 'minute');

  return (
    <div
      className={cn(
        'event-content time-event-content relative flex h-full max-h-full min-h-[22px] w-full cursor-pointer flex-col items-center overflow-hidden text-xs font-medium text-text-primary hover:bg-fill-content-hover',
        isPastEvent ? 'fc-event-past' : '',
        'transition-shadow duration-200',
        'rounded-200',
        'py-0 pl-1 pr-1',
        className
      )}
      onClick={handleClick}
    >
      <div className='relative flex h-full max-h-full w-full flex-1 items-center gap-1 overflow-hidden'>
        {showLeftIndicator && <div className='event-line h-4 w-1 rounded-200 bg-fill-theme-thick' />}
        <div className='event-inner flex h-full max-h-full w-full flex-1 flex-col justify-center overflow-hidden'>
          <div className='flex h-full items-center gap-1 truncate'>
            {event.start && (
              <span className='time-slot shrink-0 text-xs font-normal text-text-primary'>
                {formatTimeDisplay(event.start)}
              </span>
            )}
            <div className='flex w-full items-center gap-1 truncate'>
              <EventIconButton className='event-time-icon' rowId={rowId} />
              <span className='min-w-full flex-1 truncate'>{event.title || 'Untitled'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}