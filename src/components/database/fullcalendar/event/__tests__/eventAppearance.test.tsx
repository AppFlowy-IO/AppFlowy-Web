import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { calendarEventCompletionTime, useCalendarEventPast } from '../eventAppearance';

describe('calendar event completion appearance', () => {
  const now = new Date(2030, 6, 3, 12);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());

  it('keeps ongoing timed events normal and fades exactly at the end', async () => {
    const completion = calendarEventCompletionTime({
      start: new Date(2030, 6, 3, 11),
      end: new Date(2030, 6, 3, 13),
      allDay: false,
    });
    const { result } = renderHook(() => useCalendarEventPast(completion));

    expect(result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(result.current).toBe(true);
  });

  it('fades when the deadline passes between rendering and subscribing', async () => {
    const completion = now.getTime() + 1;
    const { result } = renderHook(() => {
      useLayoutEffect(() => {
        jest.setSystemTime(completion);
      }, []);

      return useCalendarEventPast(completion);
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(result.current).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('uses the whole final inclusive all-day date, including a midnight timestamp', async () => {
    const completion = calendarEventCompletionTime({
      start: new Date(2030, 6, 1),
      end: new Date(2030, 6, 3),
      allDay: true,
    });

    expect(completion).toBe(new Date(2030, 6, 4).getTime());
    const { result } = renderHook(() => useCalendarEventPast(completion));

    expect(result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(12 * 60 * 60 * 1000);
    });
    expect(result.current).toBe(true);
  });

  it('uses a 30-minute implicit timed duration and a full implicit all-day date', () => {
    expect(calendarEventCompletionTime({ start: now, allDay: false })).toBe(now.getTime() + 30 * 60 * 1000);
    expect(calendarEventCompletionTime({ start: now, allDay: true })).toBe(new Date(2030, 6, 4).getTime());
    expect(calendarEventCompletionTime({ allDay: false })).toBeUndefined();
    expect(calendarEventCompletionTime({ start: new Date(NaN), allDay: true })).toBeUndefined();
    // The row selector supplies a synthetic 30-minute end even for a date-only cell.
    expect(
      calendarEventCompletionTime({
        start: new Date(2030, 6, 3, 23, 45),
        end: new Date(2030, 6, 4, 0, 15),
        allDay: true,
        isRange: false,
      })
    ).toBe(new Date(2030, 6, 4).getTime());
  });

  it('does not overflow browser timers for events more than 25 days away', async () => {
    const completion = now.getTime() + 30 * 86_400_000;
    const { result } = renderHook(() => useCalendarEventPast(completion));

    await act(async () => {
      jest.advanceTimersByTime(2_147_483_647);
    });
    expect(result.current).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(30 * 86_400_000 - 2_147_483_647);
    });
    expect(result.current).toBe(true);
  });

  it('reschedules only the changed card and cancels pending callbacks when disposed', async () => {
    const firstRender = jest.fn();
    const secondRender = jest.fn();
    const first = renderHook(
      ({ end }) => {
        firstRender();
        return useCalendarEventPast(end);
      },
      {
        initialProps: { end: now.getTime() + 1000 },
      }
    );
    const second = renderHook(() => {
      secondRender();
      return useCalendarEventPast(now.getTime() + 4000);
    });

    first.rerender({ end: now.getTime() + 2000 });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(first.result.current).toBe(false);
    expect(secondRender).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(first.result.current).toBe(true);
    expect(secondRender).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    second.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
