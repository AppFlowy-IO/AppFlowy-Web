import { CalendarApi, EventContentArg, MoreLinkArg } from "@fullcalendar/core";
import { Draggable } from "@fullcalendar/interaction";
import { useEffect, useRef, useState } from 'react';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { dayCellContent } from '@/components/database/fullcalendar/utils/dayCellContent';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import EventWithPopover from './EventWithPopover';

export function MoreLinkPopoverContent({
  moreLinkInfo,
  calendar,
  onClose,
}: {
  moreLinkInfo: MoreLinkArg;
  calendar: CalendarApi;
  onClose: () => void;
}) {
  const { allSegs, date, view, hiddenSegs } = moreLinkInfo;
  const [hoverEvent, setHoverEvent] = useState<string | null>(null);

  const dragContainerRef = useRef<HTMLDivElement>(null);
  // Use dayCellContent for consistent date formatting
  const dateDisplay = dayCellContent({
    date,
    dayNumberText: date.getDate().toString(),
    isToday: new Date().toDateString() === date.toDateString(),
    isPopover: true,
  });

  useEffect(() => {
    const element = dragContainerRef.current;

    if (!element) return;

    // Create individual Draggable for this row with performance optimizations
    const draggable = new Draggable(element, {
      itemSelector: '.fc-event-draggable',
      eventData: function (eventEl) {
        return {
          title: eventEl.innerText,
          extendedProps: {
            rowId: eventEl.dataset.rowId,
          },
        };
      },
    });

    return () => {
      draggable.destroy();
    };
  }, []);

  useEffect(() => {
    if (hiddenSegs && hiddenSegs.length) {
      setHoverEvent(hiddenSegs[0].event.extendedProps.rowId);

      setTimeout(() => {
        setHoverEvent(null);
      }, 1000);
    }
  }, [hiddenSegs]);

  return (
    <>
      <div className='relative mb-2 px-3 pt-2 text-sm font-medium text-text-primary'>
        {dateDisplay}
        <div className='absolute right-1 top-1'>
          <Button variant='ghost' size='icon-sm' onClick={onClose}>
            <CloseIcon className='h-4 w-4' />
          </Button>
        </div>
      </div>
      <div
        ref={dragContainerRef}
        className='appflowy-scroller  flex max-h-[140px] flex-col gap-0.5 overflow-y-auto px-2 pb-2'
      >
        {allSegs.map((seg) => {
          // Construct EventContentArg-like object for EventWithPopover
          const eventInfo: EventContentArg = {
            event: seg.event,
            timeText: seg.event.allDay
              ? ''
              : seg.event.start
              ? seg.event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              : '',
            borderColor: seg.event.borderColor || '',
            backgroundColor: seg.event.backgroundColor || '',
            textColor: seg.event.textColor || '',
            isStart: seg.isStart,
            isEnd: seg.isEnd,
            isPast: seg.event.end ? seg.event.end < new Date() : false,
            isFuture: seg.event.start ? seg.event.start > new Date() : false,
            isToday: seg.event.start ? seg.event.start.toDateString() === new Date().toDateString() : false,
            view,
          } as EventContentArg;

          const event = calendar.getEventById(seg.event.id) || seg.event;

          return (
            <div
              key={seg.event.id}
              className={cn(
                'fc-event fc-event-draggable fc-popover-event w-full transform transition-all duration-200',
                hoverEvent === seg.event.extendedProps.rowId && 'event-hovered',
                event.classNames
              )}
              data-row-id={seg.event.extendedProps.rowId}
            >
              <EventWithPopover event={event} eventInfo={eventInfo} isWeekView={false} />
            </div>
          );
        })}
      </div>
    </>
  );
}
