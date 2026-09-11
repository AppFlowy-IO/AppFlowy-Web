import { renderHook } from '@testing-library/react';

import { CalendarViewType } from '@/components/database/fullcalendar/types';

import { useCurrentTimeIndicator } from '../useCurrentTimeIndicator';
import { useDynamicDayMaxEventRows } from '../useDynamicDayMaxEventRows';

jest.mock('@/application/database-yjs', () => ({
  useCalendarLayoutSetting: () => undefined,
}));

describe('calendar preview DOM isolation', () => {
  it('cleans time indicators only within its own calendar', () => {
    const liveCalendar = document.createElement('div');
    const previewCalendar = document.createElement('div');
    const markup = '<div class="custom-now-indicator-line"></div><div data-time="09:00:00" class="hidden-text"></div>';

    liveCalendar.innerHTML = markup;
    previewCalendar.innerHTML = markup;
    document.body.append(liveCalendar, previewCalendar);
    const { unmount } = renderHook(() => useCurrentTimeIndicator(null, CalendarViewType.DAY_GRID_MONTH, previewCalendar));

    expect(previewCalendar.querySelector('.custom-now-indicator-line')).toBeNull();
    expect(previewCalendar.querySelector('.hidden-text')).toBeNull();
    expect(liveCalendar.querySelector('.custom-now-indicator-line')).not.toBeNull();
    expect(liveCalendar.querySelector('.hidden-text')).not.toBeNull();
    unmount();
    expect(liveCalendar.innerHTML).toBe(markup);
    liveCalendar.remove();
    previewCalendar.remove();
  });

  it('keeps calculated day sizing on the mounted calendar instead of injecting global CSS', () => {
    const liveCalendar = document.createElement('div');
    const previewCalendar = document.createElement('div');

    liveCalendar.style.setProperty('--calendar-day-min-height', '150px');
    const { unmount } = renderHook(() => useDynamicDayMaxEventRows(CalendarViewType.DAY_GRID_MONTH, previewCalendar));

    expect(previewCalendar.style.getPropertyValue('--calendar-day-min-height')).not.toBe('');
    expect(liveCalendar.style.getPropertyValue('--calendar-day-min-height')).toBe('150px');
    expect(document.getElementById('dynamic-calendar-styles')).toBeNull();
    unmount();
    expect(previewCalendar.style.getPropertyValue('--calendar-day-min-height')).toBe('');
    expect(liveCalendar.style.getPropertyValue('--calendar-day-min-height')).toBe('150px');
  });
});
