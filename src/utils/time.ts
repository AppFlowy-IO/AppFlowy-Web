import dayjs from 'dayjs';

import { DateFormat, TimeFormat } from '@/application/types';

export function renderDate(date: string | number, format: string, isUnix?: boolean): string {
  if (isUnix) return dayjs.unix(Number(date)).format(format);
  return dayjs(date).format(format);
}

/**
 * Check if two timestamps are in the same day
 * @param {string} timestampA - The first timestamp (in seconds or milliseconds)
 * @param {string} timestampB - The second timestamp (in seconds or milliseconds)
 * @returns {boolean} - True if both timestamps are in the same day, false otherwise
 */
export function isTimestampInSameDay(timestampA: string, timestampB: string) {
  const dateA = timestampA.length > 10 ? dayjs(Number(timestampA)) : dayjs.unix(Number(timestampA));
  const dateB = timestampB.length > 10 ? dayjs(Number(timestampB)) : dayjs.unix(Number(timestampB));

  return dateA.year() === dateB.year() && dateA.month() === dateB.month() && dateA.date() === dateB.date();
}

/**
 * Check if timestampA is before timestampB
 * @param {string} timestampA - The first timestamp (in seconds or milliseconds)
 * @param {string} timestampB - The second timestamp (in seconds or milliseconds)
 * @returns {boolean} - True if timestampA is before timestampB, false otherwise
 */
export function isTimestampBefore(timestampA: string, timestampB: string) {
  const dateA = timestampA.length > 10 ? dayjs(Number(timestampA)) : dayjs.unix(Number(timestampA));
  const dateB = timestampB.length > 10 ? dayjs(Number(timestampB)) : dayjs.unix(Number(timestampB));

  return dateA.isBefore(dateB);
}

/**
 * Check if timestampA is after one day of timestampB
 * @param timestampA - The first timestamp (in seconds or milliseconds)
 * @param timestampB - The second timestamp (in seconds or milliseconds)
 * @returns {boolean} - True if timestampA is after one day of timestampB, false otherwise
 */
export function isAfterOneDay(timestampA: string, timestampB: string) {
  const dateA = timestampA.length > 10 ? dayjs(Number(timestampA)) : dayjs.unix(Number(timestampA));
  const dateB = timestampB.length > 10 ? dayjs(Number(timestampB)) : dayjs.unix(Number(timestampB));

  return dateA.isAfter(dateB) && dateA.diff(dateB, 'day') > 0;
}

/**
 * Check if timestampA is between startTimestamp and endTimestamp
 * @param {string} timestamp - The timestamp to check (in seconds or milliseconds)
 * @param {string} startTimestamp - The start timestamp (in seconds or milliseconds)
 * @param {string} endTimestamp - The end timestamp (in seconds or milliseconds)
 */
export function isTimestampBetweenRange(timestamp: string, startTimestamp: string, endTimestamp: string) {
  const date = timestamp.length > 10 ? dayjs(Number(timestamp)) : dayjs.unix(Number(timestamp));
  const startDate = startTimestamp.length > 10 ? dayjs(Number(startTimestamp)) : dayjs.unix(Number(startTimestamp));
  const endDate = endTimestamp.length > 10 ? dayjs(Number(endTimestamp)) : dayjs.unix(Number(endTimestamp));

  const dateUnix = date.unix();
  const startUnix = startDate.unix();
  const endUnix = endDate.unix();

  return dateUnix >= startUnix && dateUnix <= endUnix;
}

/**
 * Check if the day of `timestamp` lies within the days of startTimestamp and endTimestamp, both
 * included: a date filter window counts its whole last day, whatever time its dates carry (as the
 * desktop's `DateFilterStrategy::DateBetween` compares calendar days).
 * @param {string} timestamp - The timestamp to check (in seconds or milliseconds)
 * @param {string} startTimestamp - A timestamp on the first day (in seconds or milliseconds)
 * @param {string} endTimestamp - A timestamp on the last day (in seconds or milliseconds)
 */
export function isTimestampBetweenDays(timestamp: string, startTimestamp: string, endTimestamp: string) {
  const dayOf = (value: string) => (value.length > 10 ? dayjs(Number(value)) : dayjs.unix(Number(value))).startOf('day');
  const day = dayOf(timestamp);

  return !day.isBefore(dayOf(startTimestamp)) && !day.isAfter(dayOf(endTimestamp));
}

export function getTimeFormat(timeFormat?: TimeFormat) {
  switch (timeFormat) {
    case TimeFormat.TwelveHour:
      return 'h:mm A';
    case TimeFormat.TwentyFourHour:
      return 'HH:mm';
    default:
      return 'HH:mm';
  }
}

export function getDateFormat(dateFormat?: DateFormat) {
  switch (dateFormat) {
    case DateFormat.Friendly:
      return 'MMM DD, YYYY';
    case DateFormat.ISO:
      return 'YYYY-MM-DD';
    case DateFormat.US:
      return 'YYYY/MM/DD';
    case DateFormat.Local:
      return 'MM/DD/YYYY';
    case DateFormat.DayMonthYear:
      return 'DD/MM/YYYY';
    default:
      return 'YYYY-MM-DD';
  }
}

/**
 * Convert JavaScript Date to 10-digit Unix timestamp string
 * @param {Date} date - The JavaScript Date object
 * @returns {string} - 10-digit Unix timestamp string
 */
export function dateToUnixTimestamp(date: Date): string {
  return Math.floor(date.getTime() / 1000).toString();
}

/**
 * Convert 10-digit Unix timestamp string to JavaScript Date
 * @param {string} timestamp - 10-digit Unix timestamp string
 * @returns {Date} - JavaScript Date object
 */
export function unixTimestampToDate(timestamp: string): Date {
  return dayjs.unix(Number(timestamp)).toDate();
}

/**
 * Check if a Date object is at the start of day (00:00), ignoring seconds and milliseconds
 * @param {Date} date - The JavaScript Date object to check
 * @returns {boolean} - True if the date is at 00:00, false otherwise
 */
export function isDateStartOfDay(date: Date): boolean {
  const dayjsDate = dayjs(date);

  return dayjsDate.hour() === 0 && dayjsDate.minute() === 0;
}

/**
 * Check if a Date object is at the end of day (23:59), ignoring seconds and milliseconds
 * @param {Date} date - The JavaScript Date object to check
 * @returns {boolean} - True if the date is at 23:59, false otherwise
 */
export function isDateEndOfDay(date: Date): boolean {
  const dayjsDate = dayjs(date);

  return dayjsDate.hour() === 23 && dayjsDate.minute() === 59;
}

/**
 * Correct all-day event end time for FullCalendar display (forward correction)
 * If the date is not at start of day (00:00), adjust it to next day 00:00
 * This ensures FullCalendar shows all-day events correctly across multiple days
 * @param {Date} date - The end date to correct
 * @returns {Date} - The corrected date for display
 */
export function correctAllDayEndForDisplay(date: Date): Date {
  if (isDateStartOfDay(date)) {
    // Already at 00:00, no correction needed
    return date;
  }
  
  // Move to next day at 00:00 (exclusive boundary for FullCalendar)
  return dayjs(date).add(1, 'day').startOf('day').toDate();
}

/**
 * Correct all-day event end time for storage (reverse correction)
 * If the date is at start of day (00:00), adjust it to previous day 23:59
 * This ensures the stored end time reflects the actual last day of the event
 * @param {Date} date - The end date to correct
 * @returns {Date} - The corrected date for storage
 */
export function correctAllDayEndForStorage(date: Date): Date {
  if (!isDateStartOfDay(date)) {
    // Not at 00:00, no correction needed
    return date;
  }
  
  // Move to previous day at 23:59
  return dayjs(date).subtract(1, 'day').hour(23).minute(59).second(0).millisecond(0).toDate();
}
