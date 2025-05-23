import dayjs from 'dayjs';

export function renderDate (date: string | number, format: string, isUnix?: boolean): string {
  if (isUnix) return dayjs.unix(Number(date)).format(format);
  return dayjs(date).format(format);
}

/**
 * Check if two timestamps are in the same day
 * @param {string} timestampA - The first timestamp (in seconds or milliseconds)
 * @param {string} timestampB - The second timestamp (in seconds or milliseconds)
 * @returns {boolean} - True if both timestamps are in the same day, false otherwise
 */
export function isTimestampInSameDay (timestampA: string, timestampB: string) {
  const dateA = timestampA.length > 10 ? dayjs(Number(timestampA)) : dayjs.unix(Number(timestampA));
  const dateB = timestampB.length > 10 ? dayjs(Number(timestampB)) : dayjs.unix(Number(timestampB));

  return (
    dateA.year() === dateB.year() &&
    dateA.month() === dateB.month() &&
    dateA.date() === dateB.date()
  );
}

/**
 * Check if timestampA is before timestampB
 * @param {string} timestampA - The first timestamp (in seconds or milliseconds)
 * @param {string} timestampB - The second timestamp (in seconds or milliseconds)
 * @returns {boolean} - True if timestampA is before timestampB, false otherwise
 */
export function isTimestampBefore (timestampA: string, timestampB: string) {
  const dateA = timestampA.length > 10 ? dayjs(Number(timestampA)) : dayjs.unix(Number(timestampA));
  const dateB = timestampB.length > 10 ? dayjs(Number(timestampB)) : dayjs.unix(Number(timestampB));

  return dateA.isBefore(dateB);
}

/**
 * Check if timestampA is between startTimestamp and endTimestamp
 * @param {string} timestamp - The timestamp to check (in seconds or milliseconds)
 * @param {string} startTimestamp - The start timestamp (in seconds or milliseconds)
 * @param {string} endTimestamp - The end timestamp (in seconds or milliseconds)
 */
export function isTimestampBetweenRange (
  timestamp: string,
  startTimestamp: string,
  endTimestamp: string,
) {
  const date = timestamp.length > 10 ? dayjs(Number(timestamp)) : dayjs.unix(Number(timestamp));
  const startDate = startTimestamp.length > 10 ? dayjs(Number(startTimestamp)) : dayjs.unix(Number(startTimestamp));
  const endDate = endTimestamp.length > 10 ? dayjs(Number(endTimestamp)) : dayjs.unix(Number(endTimestamp));

  const dateUnix = date.unix();
  const startUnix = startDate.unix();
  const endUnix = endDate.unix();

  return dateUnix >= startUnix && dateUnix <= endUnix;
}