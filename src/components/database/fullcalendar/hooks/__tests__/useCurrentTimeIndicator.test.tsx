import { act, cleanup, renderHook } from '@testing-library/react';

import { useCalendarLayoutSetting } from '@/application/database-yjs';

import { CalendarViewType } from '../../types';
import { useCurrentTimeIndicator } from '../useCurrentTimeIndicator';

import type { CalendarApi } from '@fullcalendar/core';

jest.mock('@/application/database-yjs', () => ({ useCalendarLayoutSetting: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn() } }));

const setting = jest.mocked(useCalendarLayoutSetting);
const now = new Date(2026, 2, 18, 12, 5);
const containers: HTMLDivElement[] = [];

function createCalendar(ready = true) {
  const element = document.createElement('div');

  element.className = 'database-calendar week-view';
  element.innerHTML = '<div class="fc"><div data-time="12:00:00"></div></div>';
  document.body.appendChild(element);
  containers.push(element);
  const listeners = new Set<() => void>();
  const api = {
    view: { activeStart: new Date(2026, 2, 18), activeEnd: new Date(2026, 2, 22) },
    on: jest.fn((_name: string, listener: () => void) => listeners.add(listener)),
    off: jest.fn((_name: string, listener: () => void) => listeners.delete(listener)),
  };
  const addNativeIndicator = () => {
    element
      .querySelector('.fc')!
      .insertAdjacentHTML(
        'beforeend',
        '<div class="fc-timegrid-now-indicator-arrow"></div><div class="fc-timegrid-now-indicator-line"></div>'
      );
  };

  if (ready) addNativeIndicator();
  return {
    element,
    api,
    calendar: api as unknown as CalendarApi,
    addNativeIndicator,
    datesSet: () => act(() => listeners.forEach((listener) => listener())),
  };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
  jest.clearAllMocks();
  setting.mockReturnValue({ use24Hour: false } as ReturnType<typeof useCalendarLayoutSetting>);
});

afterEach(() => {
  cleanup();
  containers.splice(0).forEach((element) => element.remove());
  jest.useRealTimers();
});

test('two calendars retain their own labels, lines and slot visibility when either one unmounts', () => {
  const a = createCalendar();
  const b = createCalendar();
  const first = renderHook(() => useCurrentTimeIndicator(a.calendar, CalendarViewType.TIME_GRID_4_DAYS, a.element));
  const firstLine = a.element.querySelector('.custom-now-indicator-line');

  setting.mockReturnValue({ use24Hour: true } as ReturnType<typeof useCalendarLayoutSetting>);
  const second = renderHook(() => useCurrentTimeIndicator(b.calendar, CalendarViewType.TIME_GRID_8_DAYS, b.element));

  expect(a.element.querySelector('.fc-timegrid-now-indicator-arrow')?.textContent).toBe('12:05PM');
  expect(b.element.querySelector('.fc-timegrid-now-indicator-arrow')?.textContent).toBe('12:05');
  expect(a.element.querySelector('.custom-now-indicator-line')).toBe(firstLine);
  expect(b.element.querySelector('.custom-now-indicator-line')).not.toBeNull();
  expect(a.element.querySelector('[data-time]')?.classList.contains('hidden-text')).toBe(true);
  expect(b.element.querySelector('[data-time]')?.classList.contains('hidden-text')).toBe(true);

  second.unmount();
  expect(a.element.querySelector('.custom-now-indicator-line')).toBe(firstLine);
  expect(a.element.querySelector('[data-time]')?.classList.contains('hidden-text')).toBe(true);
  expect(b.element.querySelector('.custom-now-indicator-line')).toBeNull();
  expect(b.element.querySelector('[data-time]')?.classList.contains('hidden-text')).toBe(false);
  first.unmount();
  expect(a.element.querySelector('.custom-now-indicator-line')).toBeNull();
});

test('unmount cancels a pending retry without touching another calendar that becomes ready', () => {
  const waiting = createCalendar(false);
  const pending = renderHook(() =>
    useCurrentTimeIndicator(waiting.calendar, CalendarViewType.TIME_GRID_4_DAYS, waiting.element)
  );
  const ready = createCalendar();

  renderHook(() => useCurrentTimeIndicator(ready.calendar, CalendarViewType.TIME_GRID_8_DAYS, ready.element));
  const line = ready.element.querySelector('.custom-now-indicator-line');

  pending.unmount();
  waiting.addNativeIndicator();
  void act(() => jest.advanceTimersByTime(500));
  expect(ready.element.querySelector('.custom-now-indicator-line')).toBe(line);
  expect(ready.element.querySelector('.fc-timegrid-now-indicator-arrow')?.textContent).toBe('12:05PM');
  expect(waiting.element.querySelector('.custom-now-indicator-line')).toBeNull();
  expect(waiting.element.querySelector('.fc-timegrid-now-indicator-arrow')?.textContent).toBe('');
});

test('navigating away from today cancels retries before native indicators appear', () => {
  const target = createCalendar(false);

  renderHook(() => useCurrentTimeIndicator(target.calendar, CalendarViewType.TIME_GRID_4_DAYS, target.element));
  target.api.view.activeStart = new Date(2026, 2, 22);
  target.api.view.activeEnd = new Date(2026, 2, 26);
  target.datesSet();
  target.addNativeIndicator();
  void act(() => jest.advanceTimersByTime(500));
  expect(target.element.querySelector('.fc-timegrid-now-indicator-arrow')?.textContent).toBe('');
  expect(target.element.querySelector('.custom-now-indicator-line')).toBeNull();
});

test('unrelated layout changes keep the indicator subscription and rendered line', () => {
  const target = createCalendar();
  const mounted = renderHook(() =>
    useCurrentTimeIndicator(target.calendar, CalendarViewType.TIME_GRID_4_DAYS, target.element)
  );
  const line = target.element.querySelector('.custom-now-indicator-line');

  setting.mockReturnValue({ use24Hour: false, fieldId: 'another-date-field' } as ReturnType<
    typeof useCalendarLayoutSetting
  >);
  mounted.rerender();
  expect(target.api.on).toHaveBeenCalledTimes(1);
  expect(target.api.off).not.toHaveBeenCalled();
  expect(target.element.querySelector('.custom-now-indicator-line')).toBe(line);
});
