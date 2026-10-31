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
 * Compare the local calendar days two timestamps (in seconds or milliseconds)
 * fall on: negative when timestampA's day comes first, 0 for the same day,
 * positive when it comes later.
 *
 * Date filters compare days, like desktop's `naive_date_from_timestamp`: a
 * bound is stored at the start of its day, and a row later that day must
 * still count as on it.
 */
export function compareTimestampDays(timestampA: string, timestampB: string) {
  const dayA = (timestampA.length > 10 ? dayjs(Number(timestampA)) : dayjs.unix(Number(timestampA))).startOf('day');
  const dayB = (timestampB.length > 10 ? dayjs(Number(timestampB)) : dayjs.unix(Number(timestampB))).startOf('day');

  if (dayA.isBefore(dayB)) return -1;
  return dayA.isAfter(dayB) ? 1 : 0;
}

/**
 * Check if a timestamp falls on a day from the start timestamp's day through
 * the end timestamp's day, inclusive (see {@link compareTimestampDays}).
 */
export function isTimestampInDayRange(timestamp: string, startTimestamp: string, endTimestamp: string) {
  return compareTimestampDays(timestamp, startTimestamp) >= 0 && compareTimestampDays(timestamp, endTimestamp) <= 0;
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
