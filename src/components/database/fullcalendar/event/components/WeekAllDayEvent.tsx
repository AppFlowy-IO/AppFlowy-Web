import { EventApi, EventContentArg } from '@fullcalendar/core';
import { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import { Column } from '@/application/database-yjs';
import CardField from '@/components/database/components/field/CardField';

import { EventIconButton } from './EventIconButton';

interface WeekAllDayEventProps {
  event: EventApi;
  eventInfo: EventContentArg;
  onClick?: (event: EventApi) => void;
  showLeftIndicator?: boolean;
  className?: string;
  rowId: string;
  showFields?: Column[];
}

export function WeekAllDayEvent({
  event,
  eventInfo,
  onClick,
  showLeftIndicator = true,
  className,
  rowId,
  showFields,
}: WeekAllDayEventProps) {
  const isEventStart = eventInfo.isStart;
  const isEventEnd = eventInfo.isEnd;

  const handleClick = () => {
    onClick?.(event);
  };

  const isMultiDay = event.start && event.end && event.start.toDateString() !== event.end.toDateString();

  const getDisplayContent = useCallback(() => {
    if (!isMultiDay || isEventStart) {
      return event.title || 'Untitled';
    }

    if (isEventEnd) {
      return `${event.title || 'Untitled'}`;
    } else {
      return `${event.title || 'Untitled'}`;
    }
  }, [isMultiDay, isEventStart, isEventEnd, event.title]);

  const getSegmentConfig = useCallback(() => {
    if (!isMultiDay) {
      return {
        className: 'rounded-200',
        leftArrow: false,
        rightArrow: false,
      };
    }

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
  }, [isMultiDay, isEventStart, isEventEnd]);

  const segmentConfig = getSegmentConfig();

  const renderAllDayEvent = useMemo(() => {
    return (
      <div className='flex h-full items-center gap-1 truncate'>
        <EventIconButton rowId={rowId} />
        <span className='min-w-[28px] flex-1 truncate font-semibold'>{getDisplayContent()}</span>
      </div>
    );
  }, [getDisplayContent, rowId]);

  const hideLine = segmentConfig.leftArrow;

  return (
    <div
      className={cn(
        'event-content relative flex h-full max-h-full min-h-[22px] w-full cursor-pointer flex-col items-center overflow-hidden text-xs font-medium hover:bg-other-colors-filled-event-hover',
        'bg-other-colors-filled-event text-other-colors-text-event',
        'transition-shadow duration-200',
        'flex border border-transparent pl-0.5',
        segmentConfig.leftArrow ? 'left-arrow pl-2' : 'pl-0.5',
        segmentConfig.rightArrow ? 'right-arrow pr-2.5' : 'pr-0.5',
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
        {showLeftIndicator && !hideLine && <div className='event-line h-4 w-[3px] rounded-200 bg-fill-theme-thick' />}
        <div className='event-inner flex h-full max-h-full w-full flex-1 flex-col justify-center overflow-hidden'>
          {renderAllDayEvent}
          {showFields && showFields.length > 0 && (
            <div className='event-properties mt-1 flex flex-col gap-1 w-full overflow-hidden px-1 pb-1'>
              {showFields.map((field) => (
                <CardField
                  key={field.fieldId}
                  rowId={rowId}
                  fieldId={field.fieldId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
