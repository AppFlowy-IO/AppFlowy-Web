import { useCallback, useMemo, useState } from 'react';

import { Log } from '@/utils/log';
import { useDatabaseContext, useDatabaseViewId } from '@/application/database-yjs';

import { CalendarViewType } from '../types';

import { useCalendarEvents } from './useCalendarEvents';

import type { CalendarApi, DatesSetArg, MoreLinkArg } from '@fullcalendar/core';

/**
 * Custom hook to manage calendar event handlers and state
 * Centralizes all calendar interaction logic
 */
export function useCalendarHandlers() {
  // Get current view from context
  const { calendarViewTypeMap } = useDatabaseContext();
  const viewId = useDatabaseViewId();
  const currentView: CalendarViewType = useMemo(() => {
    return calendarViewTypeMap?.get(viewId) || CalendarViewType.DAY_GRID_MONTH
  }, [calendarViewTypeMap, viewId]);

  const [calendarTitle, setCalendarTitle] = useState('');
  const [morelinkInfo, setMorelinkInfo] = useState<MoreLinkArg | undefined>(undefined);
  const [, setCurrentDateRange] = useState<{ start: Date; end: Date } | null>(null);

  // Get calendar event handlers
  const { handleEventDrop, handleEventResize, handleSelect, handleAdd, updateEventTime } = useCalendarEvents();

  // Handle view changes (month/week toggle)
  const handleViewChange = useCallback((view: CalendarViewType, calendarApi: CalendarApi | null) => {
    if (calendarApi) {
      // Switch view and adjust to today's date range
      calendarApi.changeView(view);
      
      // Navigate to today
      calendarApi.today();
    }
  }, []);

  // Handle calendar date range changes
  const handleDatesSet = useCallback((dateInfo: DatesSetArg, _calendarApi: CalendarApi | null) => {
    setCalendarTitle(dateInfo.view.title);
    setCurrentDateRange({
      start: dateInfo.start,
      end: dateInfo.end,
    });
  }, []);

  // Handle more link clicks (when there are too many events in a day)
  const handleMoreLinkClick = useCallback((moreLinkInfo: MoreLinkArg) => {
    Log.debug('📅 More link clicked:', moreLinkInfo);
    setMorelinkInfo(moreLinkInfo);

    return 'null'; // Prevent FullCalendar's native popover
  }, []);

  const closeMorePopover = useCallback(() => {
    setMorelinkInfo(undefined);
  }, []);

  return {
    currentView,
    calendarTitle,
    morelinkInfo,
    handleViewChange,
    handleDatesSet,
    handleMoreLinkClick,
    handleEventDrop,
    handleEventResize,
    handleSelect,
    handleAdd,
    updateEventTime,
    closeMorePopover
  };
}
