/**
 * FullCalendar view types enumeration
 */
export enum CalendarViewType {
  DAY_GRID_MONTH = 'dayGridMonth',
  TIME_GRID_WEEK = 'timeGridWeek',
  TIME_GRID_2_DAYS = 'timeGrid2Days',
  TIME_GRID_3_DAYS = 'timeGrid3Days',
  TIME_GRID_4_DAYS = 'timeGrid4Days',
  TIME_GRID_5_DAYS = 'timeGrid5Days',
  TIME_GRID_6_DAYS = 'timeGrid6Days',
  TIME_GRID_8_DAYS = 'timeGrid8Days',
}

export const CALENDAR_DAY_COUNTS = [2, 3, 4, 5, 6, 8] as const;

const calendarDayViews: Record<number, CalendarViewType> = {
  2: CalendarViewType.TIME_GRID_2_DAYS,
  3: CalendarViewType.TIME_GRID_3_DAYS,
  4: CalendarViewType.TIME_GRID_4_DAYS,
  5: CalendarViewType.TIME_GRID_5_DAYS,
  6: CalendarViewType.TIME_GRID_6_DAYS,
  7: CalendarViewType.TIME_GRID_WEEK,
  8: CalendarViewType.TIME_GRID_8_DAYS,
};

export function getCalendarDayView(count: number): CalendarViewType | undefined {
  return calendarDayViews[count];
}

export function getCalendarDayCount(view: string): number | undefined {
  if (view === CalendarViewType.TIME_GRID_WEEK) return 7;
  return CALENDAR_DAY_COUNTS.find((count) => calendarDayViews[count] === view);
}

export function isTimeGridView(view?: string): boolean {
  return view !== undefined && getCalendarDayCount(view) !== undefined;
}

// Custom ranges start on the focused date rather than a week boundary.
export const CALENDAR_CUSTOM_VIEWS = Object.fromEntries(
  CALENDAR_DAY_COUNTS.map((count) => [
    calendarDayViews[count],
    { type: 'timeGrid', duration: { days: count }, dateIncrement: { days: count }, dateAlignment: 'day' },
  ])
);
