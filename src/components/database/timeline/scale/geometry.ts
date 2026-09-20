/**
 * Date ↔ pixel geometry for the timeline canvas.
 *
 * Day-unit presets use calendar-day arithmetic so DST transitions never shift a
 * bar by an hour; hour-unit presets position by wall-clock milliseconds. The
 * snapping and header-label generation follow frappe/gantt's `get_snap_position`
 * and `get_date_info` (MIT, Copyright (c) 2024 Frappe Technologies Pvt. Ltd.).
 */
import dayjs from 'dayjs';

import { TimelineScalePreset } from './presets';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Narrowest a bar can render so it stays clickable. */
export const MIN_BAR_WIDTH = 8;
/** Below this width the bar shows only the row icon and the title spills out. */
export const ICON_ONLY_BAR_WIDTH = 56;
/** Synthetic length of a timed event without an end, matching the calendar. */
export const DEFAULT_TIMED_DURATION_MS = 30 * MS_PER_MINUTE;

export interface TimelineGeometry {
  preset: TimelineScalePreset;
  /** Start of the first rendered column: a local midnight for every preset. */
  origin: Date;
  /** Number of rendered columns. */
  columnCount: number;
}

export interface BarRect {
  left: number;
  width: number;
}

export type SnapMode = 'floor' | 'round' | 'ceil';

export function startOfDay(date: Date): Date {
  const day = new Date(date.getTime());

  day.setHours(0, 0, 0, 0);
  return day;
}

/** Local midnight `days` calendar days after `day` (itself a local midnight). */
function addCalendarDays(day: Date, days: number): Date {
  const next = new Date(day.getTime());

  next.setDate(next.getDate() + days);
  return next;
}

/** Start of the column that contains `date`. */
export function floorToColumn(preset: TimelineScalePreset, date: Date): Date {
  return preset.unit === 'day' ? startOfDay(date) : dayjs(date).startOf('hour').toDate();
}

/** `date` moved by `count` columns, DST-safe for day presets. */
export function addColumns(preset: TimelineScalePreset, date: Date, count: number): Date {
  return preset.unit === 'day' ? dayjs(date).add(count, 'day').toDate() : new Date(date.getTime() + count * MS_PER_HOUR);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function calendarDaysBetween(from: Date, to: Date): number {
  // Both operands are local midnights, so the difference is a whole number of
  // days give or take a DST hour; rounding recovers the exact count.
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** Fractional column index of `date` relative to the origin. */
export function columnIndexOf(geometry: TimelineGeometry, date: Date): number {
  const { origin, preset } = geometry;

  if (preset.unit === 'hour') {
    return (date.getTime() - origin.getTime()) / MS_PER_HOUR;
  }

  const day = startOfDay(date);
  const dayIndex = calendarDaysBetween(origin, day);
  const dayLength = addCalendarDays(day, 1).getTime() - day.getTime();

  return dayIndex + (date.getTime() - day.getTime()) / dayLength;
}

export function dateToX(geometry: TimelineGeometry, date: Date): number {
  return columnIndexOf(geometry, date) * geometry.preset.columnWidth;
}

/** Inverse of `dateToX`; the result is not snapped. */
export function xToDate(geometry: TimelineGeometry, x: number): Date {
  const { origin, preset } = geometry;
  const index = x / preset.columnWidth;

  if (preset.unit === 'hour') {
    return new Date(origin.getTime() + index * MS_PER_HOUR);
  }

  const wholeDays = Math.floor(index);
  const day = dayjs(origin).add(wholeDays, 'day');
  const dayLength = day.add(1, 'day').valueOf() - day.valueOf();

  return new Date(day.valueOf() + (index - wholeDays) * dayLength);
}

export function columnStart(geometry: TimelineGeometry, index: number): Date {
  return addColumns(geometry.preset, geometry.origin, index);
}

export function rangeEnd(geometry: TimelineGeometry): Date {
  return columnStart(geometry, geometry.columnCount);
}

export function totalWidth(geometry: TimelineGeometry): number {
  return geometry.columnCount * geometry.preset.columnWidth;
}

/** Snap `date` to the preset's grid, measured from local midnight. */
export function snapDate(preset: TimelineScalePreset, date: Date, mode: SnapMode = 'round'): Date {
  const day = startOfDay(date);
  const minutesIntoDay = (date.getTime() - day.getTime()) / MS_PER_MINUTE;
  const steps = minutesIntoDay / preset.snapMinutes;
  const snappedSteps = mode === 'floor' ? Math.floor(steps) : mode === 'ceil' ? Math.ceil(steps) : Math.round(steps);

  return dayjs(day)
    .add(snappedSteps * preset.snapMinutes, 'minute')
    .toDate();
}

export interface BarSpan {
  start: Date;
  /** Exclusive end: the first instant after the bar. */
  endExclusive: Date;
}

/**
 * Time span a row's bar covers. All-day ranges are end-inclusive (a 9–12 Nov
 * range covers four days); timed events end where their end timestamp says,
 * or a synthetic 30 minutes later when they have none.
 */
export function getBarSpan(start: Date, end: Date | undefined, allDay: boolean): BarSpan {
  if (allDay) {
    return {
      start: startOfDay(start),
      endExclusive: dayjs(startOfDay(end && end >= start ? end : start))
        .add(1, 'day')
        .toDate(),
    };
  }

  return {
    start,
    endExclusive: end && end > start ? end : new Date(start.getTime() + DEFAULT_TIMED_DURATION_MS),
  };
}

export function getSpanRect(geometry: TimelineGeometry, span: BarSpan, minWidth = MIN_BAR_WIDTH): BarRect {
  const left = dateToX(geometry, span.start);
  const width = Math.max(dateToX(geometry, span.endExclusive) - left, minWidth);

  return { left, width };
}

/**
 * Narrowest a row's bar may render. On day scales a timed row keeps its whole
 * day column, the way a calendar month cell shows a timed event regardless of
 * its length; on hour scales bars are true to their duration.
 */
export function minBarWidth(geometry: TimelineGeometry, allDay: boolean): number {
  return !allDay && geometry.preset.unit === 'day' ? geometry.preset.columnWidth : MIN_BAR_WIDTH;
}

export function getBarRect(geometry: TimelineGeometry, start: Date, end: Date | undefined, allDay: boolean): BarRect {
  return getSpanRect(geometry, getBarSpan(start, end, allDay), minBarWidth(geometry, allDay));
}

export interface HeaderColumn {
  index: number;
  start: Date;
  x: number;
  width: number;
  label: string;
  isWeekend: boolean;
  isToday: boolean;
  /** Whether a gridline is drawn at this column's left edge. */
  gridLine: boolean;
}

export interface HeaderSegment {
  start: Date;
  x: number;
  width: number;
  label: string;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();

  return day === 0 || day === 6;
}

function isColumnToday(preset: TimelineScalePreset, columnStartDate: Date, now: Date): boolean {
  return preset.unit === 'day' ? dayjs(columnStartDate).isSame(now, 'day') : dayjs(columnStartDate).isSame(now, 'hour');
}

function hasGridLine(preset: TimelineScalePreset, date: Date, firstDayOfWeek: number): boolean {
  switch (preset.gridLines) {
    case 'column':
      return true;
    case 'week':
      return date.getDay() === firstDayOfWeek;
    case 'month':
      return date.getDate() === 1;
    default:
      return false;
  }
}

/** Columns in `[fromIndex, toIndex)`, clamped to the rendered range. */
export function buildHeaderColumns(
  geometry: TimelineGeometry,
  fromIndex: number,
  toIndex: number,
  firstDayOfWeek: number,
  now: Date,
  use24Hour = false
): HeaderColumn[] {
  const { preset } = geometry;
  const first = Math.max(0, Math.floor(fromIndex));
  const last = Math.min(geometry.columnCount, Math.ceil(toIndex));
  const columns: HeaderColumn[] = [];

  for (let index = first; index < last; index += 1) {
    const start = columnStart(geometry, index);

    columns.push({
      index,
      start,
      x: index * preset.columnWidth,
      width: preset.columnWidth,
      label: preset.lowerText(start, firstDayOfWeek, use24Hour),
      isWeekend: preset.shadeWeekends && isWeekend(start),
      isToday: isColumnToday(preset, start, now),
      gridLine: hasGridLine(preset, start, firstDayOfWeek),
    });
  }

  return columns;
}

/**
 * Upper-band segments (days for hour presets, months otherwise) that overlap
 * `[fromIndex, toIndex)`. Segment extents are clamped to the rendered range so
 * a sticky label never sits outside the canvas.
 */
export function buildHeaderSegments(geometry: TimelineGeometry, fromIndex: number, toIndex: number): HeaderSegment[] {
  const { preset } = geometry;
  const unit = preset.unit === 'hour' ? 'day' : 'month';
  const rangeStart = geometry.origin;
  const rangeStop = rangeEnd(geometry);
  const windowStart = columnStart(geometry, Math.max(0, Math.floor(fromIndex)));
  const windowStop = columnStart(geometry, Math.min(geometry.columnCount, Math.ceil(toIndex)));
  const segments: HeaderSegment[] = [];

  let cursor = dayjs(windowStart).startOf(unit);

  while (cursor.toDate() < windowStop) {
    const segmentStart = cursor.toDate() < rangeStart ? rangeStart : cursor.toDate();
    const next = cursor.add(1, unit).toDate();
    const segmentEnd = next > rangeStop ? rangeStop : next;
    const x = dateToX(geometry, segmentStart);
    const width = dateToX(geometry, segmentEnd) - x;

    if (width > 0) {
      segments.push({ start: cursor.toDate(), x, width, label: preset.upperText(cursor.toDate()) });
    }

    cursor = cursor.add(1, unit);
  }

  return segments;
}
