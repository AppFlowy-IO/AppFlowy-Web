export const DAY_MS = 86_400_000;
export const TIMELINE_ROW_HEIGHT = 40;
export const TIMELINE_HEADER_HEIGHT = 56;
export const TIMELINE_CANVAS_WIDTH = 12_000;

export const TIMELINE_SCALES = ['hour', 'day', 'week', 'biweek', 'month', 'quarter', 'year'] as const;
export type TimelineScale = (typeof TIMELINE_SCALES)[number];
export type TimelineRange = { start: number; end?: number; includeTime: boolean };
export type TimelineDragMode = 'move' | 'start' | 'end';

export const PIXELS_PER_DAY: Record<TimelineScale, number> = {
  hour: 1152,
  day: 240,
  week: 112,
  biweek: 64,
  month: 36,
  quarter: 12,
  year: 4,
};

export function startOfDay(time: number): number {
  const date = new Date(time);

  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function addDays(time: number, days: number): number {
  const date = new Date(time);

  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** Calendar scales give every local date equal width, including 23/25-hour DST days.
 * The hour scale uses elapsed time so both occurrences of a repeated hour remain editable.
 */
export function timeToUnit(time: number, scale: TimelineScale): number {
  if (scale === 'hour') return time / DAY_MS;
  const date = new Date(time);
  const midnight = startOfDay(time);
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;

  return day + (time - midnight) / (addDays(midnight, 1) - midnight);
}

export function unitToTime(unit: number, scale: TimelineScale): number {
  if (scale === 'hour') return Math.round(unit * DAY_MS);
  const whole = Math.floor(unit);
  const date = new Date(whole * DAY_MS);
  const midnight = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime();

  return Math.round(midnight + (unit - whole) * (addDays(midnight, 1) - midnight));
}

export function displayEnd(range: TimelineRange): number {
  if (!range.includeTime) return addDays(startOfDay(range.end ?? range.start), 1);
  return range.end ?? range.start + 60 * 60 * 1000;
}

export function rangeGeometry(range: TimelineRange, origin: number, scale: TimelineScale) {
  const left = (timeToUnit(range.start, scale) - origin) * PIXELS_PER_DAY[scale];
  const right = (timeToUnit(displayEnd(range), scale) - origin) * PIXELS_PER_DAY[scale];

  return { left, width: Math.max(8, right - left) };
}

/** Store inclusive end dates for all-day cells; never leak exclusive drawing boundaries into Yjs. */
export function shiftRange(
  range: TimelineRange,
  mode: TimelineDragMode,
  deltaPixels: number,
  scale: TimelineScale
): TimelineRange {
  const units = deltaPixels / PIXELS_PER_DAY[scale];
  const timedHours = range.includeTime && scale === 'hour';
  const steps = timedHours ? Math.round(units * 96) : Math.round(units);
  const shift = (time: number) => (timedHours ? time + steps * 15 * 60 * 1000 : addDays(time, steps));

  if (!steps) return range;
  if (mode === 'move')
    return { ...range, start: shift(range.start), end: range.end === undefined ? undefined : shift(range.end) };
  if (mode === 'start') {
    const latest = range.includeTime ? range.end ?? range.start : startOfDay(range.end ?? range.start);

    return { ...range, start: Math.min(shift(range.start), latest) };
  }

  return { ...range, end: Math.max(range.start, shift(range.end ?? range.start)) };
}

export function parseTimestamp(value: unknown): number | undefined {
  if (value === '' || value === undefined || value === null) return undefined;
  if (!['string', 'number', 'bigint'].includes(typeof value)) return undefined;
  const time = Number(value) * 1000;

  return Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? time : undefined;
}

export type TimelineTick = { time: number; left: number; width: number; label: string; weekend: boolean };

export function createTicks(origin: number, scale: TimelineScale, locale: string): TimelineTick[] {
  const start = unitToTime(origin, scale);
  const finish = unitToTime(origin + TIMELINE_CANVAS_WIDTH / PIXELS_PER_DAY[scale], scale);
  const hourly = scale === 'hour';
  const monthly = scale === 'year';
  const weekly = scale === 'quarter';
  const date = new Date(startOfDay(start));

  if (monthly) date.setDate(1);
  if (weekly) date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const formatter = new Intl.DateTimeFormat(
    locale,
    hourly ? { hour: 'numeric' } : monthly ? { month: 'short' } : { day: 'numeric' }
  );
  const ticks: TimelineTick[] = [];
  let time = date.getTime();

  while (time < finish) {
    let next: number;

    if (hourly) next = time + 3_600_000;
    else if (monthly) {
      const month = new Date(time);

      month.setMonth(month.getMonth() + 1);
      next = month.getTime();
    } else next = addDays(time, weekly ? 7 : 1);
    const left = (timeToUnit(time, scale) - origin) * PIXELS_PER_DAY[scale];

    ticks.push({
      time,
      left,
      width: (timeToUnit(next, scale) - timeToUnit(time, scale)) * PIXELS_PER_DAY[scale],
      label: formatter.format(time),
      weekend: !monthly && !weekly && [0, 6].includes(new Date(time).getDay()),
    });
    time = next;
  }

  return ticks;
}
