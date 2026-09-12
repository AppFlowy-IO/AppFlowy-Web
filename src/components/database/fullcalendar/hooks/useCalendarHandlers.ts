import { useCallback, useEffect, useState } from 'react';

import { CalendarLayout, useCalendarLayoutSetting, useDatabaseViewId, useReadOnly } from '@/application/database-yjs';
import { useUpdateCalendarSetting } from '@/application/database-yjs/dispatch';
import { Log } from '@/utils/log';

import { changeCalendarView } from '../calendarNavigation';
import { CalendarViewType, getCalendarDayCount, getCalendarDayView } from '../types';

import { useCalendarEvents } from './useCalendarEvents';

import type { CalendarApi, DatesSetArg, MoreLinkArg } from '@fullcalendar/core';

/**
 * Custom hook to manage calendar event handlers and state
 * Centralizes all calendar interaction logic
 */
export function useCalendarHandlers() {
  const setting = useCalendarLayoutSetting();
  const viewId = useDatabaseViewId();
  const readOnly = useReadOnly();
  const updateSetting = useUpdateCalendarSetting();
  const sharedView =
    !setting || (setting.layout !== CalendarLayout.WeekLayout && setting.layout !== CalendarLayout.DayLayout)
      ? CalendarViewType.DAY_GRID_MONTH
      : getCalendarDayView(setting.numberOfDays) ?? CalendarViewType.TIME_GRID_WEEK;
  // Read-only viewers can explore another mode without modifying shared data.
  const [localView, setLocalView] = useState<{ viewId: string; view: CalendarViewType }>();
  const currentView = readOnly && localView?.viewId === viewId ? localView.view : sharedView;

  useEffect(() => {
    setLocalView(undefined);
  }, [viewId, readOnly]);

  const [calendarTitle, setCalendarTitle] = useState('');
  const [morelinkInfo, setMorelinkInfo] = useState<MoreLinkArg | undefined>(undefined);
  const [, setCurrentDateRange] = useState<{ start: Date; end: Date } | null>(null);

  // Get calendar event handlers
  const { handleEventDrop, handleEventResize, handleSelect, handleAdd, updateEventTime } = useCalendarEvents();

  const handleViewChange = useCallback(
    (view: CalendarViewType, calendarApi: CalendarApi | null) => {
      if (view === currentView) return;
      if (readOnly) {
        setLocalView({ viewId, view });
      } else {
        const count = getCalendarDayCount(view);

        updateSetting({
          layout:
            count === undefined
              ? CalendarLayout.MonthLayout
              : count === 1
              ? CalendarLayout.DayLayout
              : CalendarLayout.WeekLayout,
          numberOfDays: count ?? null,
        });
      }

      changeCalendarView(calendarApi, view);
    },
    [currentView, readOnly, updateSetting, viewId]
  );

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
    closeMorePopover,
  };
}
