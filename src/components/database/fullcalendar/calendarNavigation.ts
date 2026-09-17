import { CalendarViewType, getCalendarDayCount } from './types';

import type { CalendarApi } from '@fullcalendar/core';

export function changeCalendarView(calendar: CalendarApi | null | undefined, view: CalendarViewType) {
  if (!calendar || calendar.view.type === view) return;

  const date = calendar.getDate();

  const updateView = () => {
    calendar.changeView(view, date);
    // changeView chooses a range but can leave getDate at its first day.
    // Keep the focused date without emitting an intermediate datesSet.
    calendar.gotoDate(date);
  };

  // CalendarApi omits this method from its public interface in FullCalendar 6.
  if ('batchRendering' in calendar && typeof calendar.batchRendering === 'function') {
    calendar.batchRendering(updateView);
  } else {
    updateView();
  }
}

/** Preserve the focused day when a later view change starts a custom range. */
export function navigateCalendar(calendar: CalendarApi | null | undefined, direction: -1 | 1) {
  if (!calendar) return;

  const date = calendar.getDate();
  const view = calendar.view.type;

  if (view === CalendarViewType.DAY_GRID_MONTH) {
    const month = date.getMonth() + direction;
    const lastDay = new Date(date.getFullYear(), month + 1, 0).getDate();

    calendar.gotoDate(new Date(date.getFullYear(), month, Math.min(date.getDate(), lastDay)));
    return;
  }

  const dayCount = getCalendarDayCount(view);

  if (dayCount !== undefined) {
    calendar.gotoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + direction * dayCount));
    return;
  }

  if (direction === -1) calendar.prev();
  else calendar.next();
}
