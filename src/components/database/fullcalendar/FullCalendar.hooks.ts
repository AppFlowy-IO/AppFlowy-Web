import { sortBy } from 'lodash-es';
import { useMemo } from 'react';

import { useCalendarEventsSelector, useCalendarLayoutSetting } from '@/application/database-yjs';
import { CalendarViewType, isTimeGridView } from '@/components/database/fullcalendar/types';
import { correctAllDayEndForDisplay } from '@/utils/time';

import { calendarEventCompletionTime } from './event/eventAppearance';

export function useFullCalendarSetup(newEventRowIds: Set<string>, openEventRowId: string | null, updateEventRowIds: Set<string>, currentView: CalendarViewType) {
  const layoutSetting = useCalendarLayoutSetting();
  const { events, emptyEvents } = useCalendarEventsSelector();

  // Convert events to FullCalendar format
  const fullCalendarEvents = useMemo(() => {
    const processedEvents = events.map((event) => {
      const isNewEvent = newEventRowIds.has(event.rowId);
      const isUpdateEvent = updateEventRowIds.has(event.rowId);
      const isOpenEvent = isNewEvent || isUpdateEvent || openEventRowId === event.rowId;
      const classNames = [];

      const isMultipleDayEvent = event.start && event.end && event.start.toDateString() !== event.end.toDateString();

      // Correct all-day event end time for FullCalendar display
      const end = event.allDay && event.end ? 
        correctAllDayEndForDisplay(event.end) : 
        event.end;

      if (isOpenEvent) {
        classNames.push('fc-event-open');
      }

      if (isNewEvent) {
        classNames.push('fc-event-new');
      }

      return {
        id: event.id,
        title: event.title,
        start: event.start,
        end: end,
        allDay: event.allDay,
        classNames,
        isMultipleDayEvent,
        extendedProps: {
          isActiveRow: isOpenEvent,
          isNew: isNewEvent,
          isUpdate: isUpdateEvent,
          rowId: event.rowId,
          includeTime: !event.allDay,
          start: event.start,
          end: end,
          isMultipleDayEvent,
          isRange: event.isRange,
          completionTime: calendarEventCompletionTime(event),
        },
      };
    });

    return sortBy(processedEvents, isTimeGridView(currentView) ? [] : ['allDay', 'isMultipleDayEvent', 'start', 'title']);
  }, [currentView, events, newEventRowIds, openEventRowId, updateEventRowIds]);

  return {
    events: fullCalendarEvents,
    emptyEvents,
    firstDayOfWeek: layoutSetting?.firstDayOfWeek || 0,
  };
}
