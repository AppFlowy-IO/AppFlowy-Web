import { useEffect, useState } from 'react';

interface CalendarEventDates {
  start?: Date | null;
  end?: Date | null;
  allDay: boolean;
  isRange?: boolean;
}

/** Database all-day ranges include their final date; timed ranges end at an instant. */
export function calendarEventCompletionTime(event: CalendarEventDates): number | undefined {
  if (!event.start || !Number.isFinite(event.start.getTime())) return undefined;

  let end = event.allDay && event.isRange === false ? event.start : event.end ?? event.start;

  if (event.allDay) {
    end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  } else if (!event.end) {
    // Match the calendar's displayed duration for a timestamp without a range.
    end = new Date(event.start.getTime() + 30 * 60 * 1000);
  }

  return Number.isFinite(end.getTime()) ? end.getTime() : undefined;
}

/** Only the completing card rebuilds; long-running events respect the browser timer limit. */
export function useCalendarEventPast(completionTime: number | undefined): boolean {
  const [tick, setTick] = useState(0);
  const isPast = completionTime !== undefined && completionTime <= Date.now();

  useEffect(() => {
    if (completionTime === undefined || isPast) return;
    const remaining = completionTime - Date.now();

    // The deadline can pass after render but before this effect subscribes.
    const timeout = setTimeout(() => setTick((value) => value + 1), Math.max(0, Math.min(remaining, 2_147_483_647)));

    return () => clearTimeout(timeout);
  }, [completionTime, isPast, tick]);

  return isPast;
}
