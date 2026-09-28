import { renderHook } from '@testing-library/react';

import { CalendarViewType } from '@/components/database/fullcalendar/types';

import { useCurrentTimeIndicator } from '../useCurrentTimeIndicator';
import { useDynamicDayMaxEventRows } from '../useDynamicDayMaxEventRows';

import type { CalendarApi } from '@fullcalendar/core';

jest.mock('@/application/database-yjs', () => ({
  useCalendarLayoutSetting: () => undefined,
}));

describe('calendar preview DOM isolation', () => {
  it('cleans preview time indicators when changing views without changing the live calendar', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 17, 9, 5));
    const liveCalendar = document.createElement('div');
    const previewCalendar = document.createElement('div');
    const markup = '<div class="custom-now-indicator-line"></div><div data-time="09:00:00" class="hidden-text"></div>';

    liveCalendar.innerHTML = markup;
    previewCalendar.innerHTML =
      '<div class="fc"><div data-time="09:00:00"></div><div class="fc-timegrid-now-indicator-arrow"></div><div class="fc-timegrid-now-indicator-line"></div></div>';
    document.body.append(liveCalendar, previewCalendar);
    const calendarApi = {
      view: { activeStart: new Date(2026, 8, 17), activeEnd: new Date(2026, 8, 21) },
      on: jest.fn(),
      off: jest.fn(),
    } as unknown as CalendarApi;
    const { rerender, unmount } = renderHook(
      ({ currentView }) => useCurrentTimeIndicator(calendarApi, currentView, previewCalendar),
      { initialProps: { currentView: CalendarViewType.TIME_GRID_4_DAYS } }
    );

    try {
      expect(previewCalendar.querySelector('.custom-now-indicator-line')).not.toBeNull();
      expect(previewCalendar.querySelector('.hidden-text')).not.toBeNull();
      rerender({ currentView: CalendarViewType.DAY_GRID_MONTH });
      expect(previewCalendar.querySelector('.custom-now-indicator-line')).toBeNull();
      expect(previewCalendar.querySelector('.hidden-text')).toBeNull();
      expect(liveCalendar.innerHTML).toBe(markup);
      unmount();
      expect(liveCalendar.innerHTML).toBe(markup);
    } finally {
      unmount();
      liveCalendar.remove();
      previewCalendar.remove();
      jest.useRealTimers();
    }
  });

  it('keeps calculated day sizing on the mounted calendar instead of injecting global CSS', () => {
    const liveCalendar = document.createElement('div');
    const previewCalendar = document.createElement('div');

    liveCalendar.style.setProperty('--calendar-day-min-height', '150px');
    const { rerender, unmount } = renderHook(
      ({ currentView }) => useDynamicDayMaxEventRows(currentView, previewCalendar),
      { initialProps: { currentView: CalendarViewType.DAY_GRID_MONTH } }
    );

    expect(previewCalendar.style.getPropertyValue('--calendar-day-min-height')).not.toBe('');
    expect(liveCalendar.style.getPropertyValue('--calendar-day-min-height')).toBe('150px');
    expect(document.getElementById('dynamic-calendar-styles')).toBeNull();
    rerender({ currentView: CalendarViewType.TIME_GRID_4_DAYS });
    expect(previewCalendar.style.getPropertyValue('--calendar-day-min-height')).toBe('');
    expect(liveCalendar.style.getPropertyValue('--calendar-day-min-height')).toBe('150px');
    rerender({ currentView: CalendarViewType.DAY_GRID_MONTH });
    expect(previewCalendar.style.getPropertyValue('--calendar-day-min-height')).not.toBe('');
    unmount();
    expect(previewCalendar.style.getPropertyValue('--calendar-day-min-height')).toBe('');
    expect(liveCalendar.style.getPropertyValue('--calendar-day-min-height')).toBe('150px');
  });
});
