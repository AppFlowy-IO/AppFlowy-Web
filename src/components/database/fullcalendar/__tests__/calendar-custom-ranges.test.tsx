/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { act, cleanup, render, renderHook } from '@testing-library/react';

import { navigateCalendar } from '../calendarNavigation';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useCalendarHandlers } from '../hooks/useCalendarHandlers';
import { useCalendarStickyWeekHeader } from '../hooks/useCalendarStickyWeekHeader';
import { useCurrentTimeIndicator } from '../hooks/useCurrentTimeIndicator';
import { StickyWeekHeader } from '../StickyWeekHeader';
import { CALENDAR_CUSTOM_VIEWS, CALENDAR_DAY_COUNTS, CalendarViewType, getCalendarDayView } from '../types';

import type { DateSelectArg } from '@fullcalendar/core';

const mockCreateCalendarEvent = jest.fn().mockResolvedValue('new-event');
const mockUpdateCell = jest.fn();
const mockLayoutSetting = { fieldId: 'date', use24Hour: true };

jest.mock('@/application/database-yjs', () => ({
  CalendarLayout: jest.requireActual('@/application/database-yjs/database.type').CalendarLayout,
  useReadOnly: () => true,
  useDatabaseContext: () => ({}),
  useDatabaseViewId: () => 'calendar',
  useCalendarLayoutSetting: () => mockLayoutSetting,
  useCreateCalendarEvent: () => mockCreateCalendarEvent,
  useUpdateStartEndTimeCell: () => mockUpdateCell,
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCalendarSetting: () => jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn() } }));

const today = new Date(2026, 2, 18, 12);
let calendar: Calendar;
let container: HTMLDivElement;

function dateAfter(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(today);
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  calendar = new Calendar(container, {
    plugins: [dayGridPlugin, timeGridPlugin],
    initialView: CalendarViewType.DAY_GRID_MONTH,
    initialDate: new Date(2026, 11, 29),
    now: today,
    firstDay: 1,
    views: CALENDAR_CUSTOM_VIEWS,
    headerToolbar: false,
  });
  calendar.render();
});

afterEach(() => {
  cleanup();
  calendar.destroy();
  container.remove();
  jest.useRealTimers();
});

test.each(CALENDAR_DAY_COUNTS)('%s-day ranges retain their anchor and navigate without gaps across years', (count) => {
  const view = getCalendarDayView(count)!;
  const anchor = calendar.getDate();
  const { result } = renderHook(() => useCalendarHandlers());
  const changeView = jest.spyOn(calendar, 'changeView');
  const navigateToday = jest.spyOn(calendar, 'today');

  act(() => result.current.handleViewChange(view, calendar));

  expect(changeView).toHaveBeenCalledTimes(1);
  expect(navigateToday).not.toHaveBeenCalled();
  expect(calendar.view.currentStart).toEqual(anchor);
  expect(calendar.view.currentEnd).toEqual(dateAfter(anchor, count));
  expect(container.querySelectorAll('.fc-timegrid-col[data-date]')).toHaveLength(count);

  const header = renderHook(() => useCalendarStickyWeekHeader(calendar, { currentView: view, firstDayOfWeek: 1 }));

  expect(header.result.current.headerCells.map((cell) => cell.date)).toEqual(
    Array.from({ length: count }, (_, index) => dateAfter(anchor, index))
  );
  const mounted = render(
    <StickyWeekHeader visible currentView={view} headerCells={header.result.current.headerCells} />
  );

  expect(mounted.container.querySelectorAll('th.fc-timegrid-axis-cell')).toHaveLength(1);
  expect(mounted.container.querySelectorAll('th')).toHaveLength(count + 1);

  act(() => calendar.next());
  expect(calendar.view.currentStart).toEqual(dateAfter(anchor, count));
  expect(calendar.view.currentEnd).toEqual(dateAfter(anchor, count * 2));
  expect(header.result.current.headerCells[0].date).toEqual(dateAfter(anchor, count));

  act(() => calendar.prev());
  expect(calendar.view.currentStart).toEqual(anchor);
  expect(header.result.current.headerCells[0].date).toEqual(anchor);

  act(() => calendar.today());
  expect(calendar.view.type).toBe(view);
  expect(calendar.view.currentStart).toEqual(dateAfter(today, 0));
  expect(calendar.view.currentEnd).toEqual(dateAfter(today, count));
});

test('standard views retain the focused date, restore week alignment, and reselecting the current view does nothing', () => {
  const { result } = renderHook(() => useCalendarHandlers());
  const originalDate = calendar.getDate();
  const changeView = jest.spyOn(calendar, 'changeView');
  const navigateToday = jest.spyOn(calendar, 'today');
  const datesSet = jest.fn();

  calendar.on('datesSet', datesSet);

  act(() => result.current.handleViewChange(CalendarViewType.DAY_GRID_MONTH, calendar));
  expect(changeView).not.toHaveBeenCalled();
  expect(navigateToday).not.toHaveBeenCalled();
  expect(calendar.getDate()).toEqual(originalDate);

  act(() => result.current.handleViewChange(CalendarViewType.TIME_GRID_8_DAYS, calendar));
  act(() => result.current.handleViewChange(CalendarViewType.TIME_GRID_WEEK, calendar));
  expect(changeView).toHaveBeenCalledTimes(2);
  expect(changeView).toHaveBeenLastCalledWith(CalendarViewType.TIME_GRID_WEEK, originalDate);
  expect(navigateToday).not.toHaveBeenCalled();
  expect(datesSet).toHaveBeenCalledTimes(2);
  expect(calendar.view.currentStart).toEqual(new Date(2026, 11, 28));
  expect(calendar.view.currentEnd).toEqual(new Date(2027, 0, 4));
  expect(calendar.getDate()).toEqual(originalDate);
  expect(container.querySelectorAll('.fc-timegrid-col[data-date]')).toHaveLength(7);

  act(() => calendar.next());
  const navigatedWeek = calendar.getDate();

  act(() => result.current.handleViewChange(CalendarViewType.TIME_GRID_WEEK, calendar));
  expect(changeView).toHaveBeenCalledTimes(2);
  expect(navigateToday).not.toHaveBeenCalled();
  expect(calendar.getDate()).toEqual(navigatedWeek);

  act(() => result.current.handleViewChange(CalendarViewType.DAY_GRID_MONTH, calendar));
  expect(changeView).toHaveBeenCalledTimes(3);
  expect(changeView).toHaveBeenLastCalledWith(CalendarViewType.DAY_GRID_MONTH, navigatedWeek);
  expect(navigateToday).not.toHaveBeenCalled();
  expect(calendar.view.currentStart).toEqual(new Date(2027, 0, 1));
  expect(calendar.view.currentEnd).toEqual(new Date(2027, 1, 1));
  expect(calendar.getDate()).toEqual(navigatedWeek);
  expect(container.querySelector('.fc-dayGridMonth-view')).not.toBeNull();
});

test.each([
  [2026, 28],
  [2024, 29],
])('month navigation clamps the focused day in February %s', (year, februaryLastDay) => {
  calendar.gotoDate(new Date(year, 0, 31));

  navigateCalendar(calendar, 1);
  expect(calendar.getDate()).toEqual(new Date(year, 1, februaryLastDay));
  navigateCalendar(calendar, 1);
  expect(calendar.getDate()).toEqual(new Date(year, 2, februaryLastDay));
  navigateCalendar(calendar, -1);
  expect(calendar.getDate()).toEqual(new Date(year, 1, februaryLastDay));
  calendar.gotoDate(new Date(year, 0, 31));
  navigateCalendar(calendar, -1);
  expect(calendar.getDate()).toEqual(new Date(year - 1, 11, 31));
});

test.each([CalendarViewType.DAY_GRID_MONTH, CalendarViewType.TIME_GRID_WEEK])(
  '%s navigation preserves the focused day when switching to a custom range',
  (view) => {
    const { result } = renderHook(() => useCalendarHandlers());

    calendar.changeView(view, new Date(2026, 8, 12));
    calendar.gotoDate(new Date(2026, 8, 12));
    navigateCalendar(calendar, 1);
    const expected = view === CalendarViewType.DAY_GRID_MONTH ? new Date(2026, 9, 12) : new Date(2026, 8, 19);

    expect(calendar.getDate()).toEqual(expected);
    act(() => result.current.handleViewChange(CalendarViewType.TIME_GRID_4_DAYS, calendar));
    expect(calendar.view.currentStart).toEqual(expected);
    expect(calendar.view.currentEnd).toEqual(dateAfter(expected, 4));
    act(() => navigateCalendar(calendar, 1));
    expect(calendar.getDate()).toEqual(dateAfter(expected, 4));
    act(() => navigateCalendar(calendar, -1));
    expect(calendar.getDate()).toEqual(expected);
  }
);

test.each([CalendarViewType.TIME_GRID_2_DAYS, CalendarViewType.TIME_GRID_8_DAYS])(
  '%s gives short timed selections a one-hour duration and preserves longer selections',
  async (view) => {
    calendar.changeView(view);
    const { result } = renderHook(() => useCalendarEvents());
    const start = new Date(2026, 11, 29, 10);

    for (const minutes of [30, 120]) {
      const end = new Date(start.getTime() + minutes * 60 * 1000);

      await act(async () => {
        await result.current.handleSelect({ start, end, allDay: false, view: calendar.view } as DateSelectArg);
      });
      const expectedEnd = new Date(start.getTime() + Math.max(60, minutes) * 60 * 1000);

      expect(mockCreateCalendarEvent).toHaveBeenLastCalledWith({
        startTimestamp: String(start.getTime() / 1000),
        endTimestamp: String(expectedEnd.getTime() / 1000),
        includeTime: true,
      });
    }
  }
);

test('custom ranges show the current-time label only when their dates include today', () => {
  calendar.changeView(CalendarViewType.TIME_GRID_4_DAYS, today);
  const timeGrid = document.createElement('div');

  timeGrid.className = 'database-calendar week-view';
  timeGrid.innerHTML =
    '<div class="fc"><div class="fc-timegrid-now-indicator-arrow"></div><div class="fc-timegrid-now-indicator-line"></div></div>';
  container.appendChild(timeGrid);

  renderHook(() => useCurrentTimeIndicator(calendar, CalendarViewType.TIME_GRID_4_DAYS, timeGrid));
  expect(timeGrid.querySelector('.fc-timegrid-now-indicator-arrow')?.textContent).toBe('12:00');
  expect(timeGrid.querySelector('.custom-now-indicator-line')).not.toBeNull();

  act(() => calendar.next());
  expect(document.querySelector('.custom-now-indicator-line')).toBeNull();
});
