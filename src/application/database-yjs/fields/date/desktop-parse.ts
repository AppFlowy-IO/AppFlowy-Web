type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hasTime: boolean;
};

const MONTH_BY_NAME: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function dateParts(
  year: string | number,
  month: string | number,
  day: string | number,
  hour: string | number = 0,
  minute: string | number = 0,
  second: string | number = 0,
  hasTime = false
): DateParts {
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    hasTime,
  };
}

function withMeridiem(parts: DateParts, meridiem: string): DateParts | null {
  if (parts.hour < 1 || parts.hour > 12) return null;

  const isPm = meridiem.toLowerCase() === 'pm';

  return {
    ...parts,
    hour: (parts.hour % 12) + (isPm ? 12 : 0),
  };
}

function toUnixSeconds(parts: DateParts, offsetMinutes: number): string | null {
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day) ||
    !Number.isInteger(parts.hour) ||
    !Number.isInteger(parts.minute) ||
    !Number.isInteger(parts.second) ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59 ||
    parts.second < 0 ||
    parts.second > 59
  ) {
    return null;
  }

  const date = new Date(0);

  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);

  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second
  ) {
    return null;
  }

  return String(Math.trunc(date.getTime() / 1000) - (parts.hasTime ? offsetMinutes * 60 : 0));
}

function parseTimezoneAnnotation(value: string): { value: string; offsetMinutes: number } | null {
  const match = value.match(/^(.*) \(([^)]*)\)$/);

  if (!match) return { value, offsetMinutes: 0 };

  const annotation = match[2].trim();
  const prefix = annotation.startsWith('GMT') ? 'GMT' : annotation.startsWith('UTC') ? 'UTC' : null;

  if (!prefix) return { value, offsetMinutes: 0 };

  const offset = annotation.slice(prefix.length);

  if (!offset) return { value: match[1].trimEnd(), offsetMinutes: 0 };

  const sign = offset[0] === '-' ? -1 : offset[0] === '+' ? 1 : 0;

  if (!sign) return null;

  const valueWithoutSign = offset.slice(1);
  let hoursText = '';
  let minutesText = '0';

  if (valueWithoutSign.includes(':')) {
    const parts = valueWithoutSign.split(':');

    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    [hoursText, minutesText] = parts;
  } else if (valueWithoutSign.length === 1 || valueWithoutSign.length === 2) {
    hoursText = valueWithoutSign;
  } else if (valueWithoutSign.length === 4) {
    hoursText = valueWithoutSign.slice(0, 2);
    minutesText = valueWithoutSign.slice(2);
  } else {
    return null;
  }

  if (!/^\d+$/.test(hoursText) || !/^\d+$/.test(minutesText)) return null;

  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (hours > 23 || minutes > 59) return null;

  return {
    value: match[1].trimEnd(),
    offsetMinutes: sign * (hours * 60 + minutes),
  };
}

function isAmbiguousMonthDay(first: number, second: number) {
  return first <= 12 && second <= 12;
}

function parseNumericDateTime(value: string): DateParts | null {
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})([ T])(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (match) {
    return dateParts(match[1], match[2], match[3], match[5], match[6], match[7] ?? 0, true);
  }

  match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM)$/i);
  if (match) {
    return withMeridiem(dateParts(match[1], match[2], match[3], match[4], match[5], match[6] ?? 0, true), match[7]);
  }

  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?: (AM|PM))?$/i);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);

    if (isAmbiguousMonthDay(first, second)) return null;

    const month = first <= 12 ? first : second;
    const day = first <= 12 ? second : first;
    const parts = dateParts(match[3], month, day, match[4], match[5], 0, true);

    return match[6] ? withMeridiem(parts, match[6]) : parts;
  }

  match = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4}) (\d{1,2}):(\d{2})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);

    if (isAmbiguousMonthDay(day, month)) return null;
    return dateParts(match[3], month, day, match[4], match[5], 0, true);
  }

  return null;
}

function parseTextualDateTime(value: string): DateParts | null {
  let match = value.match(/^([A-Za-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM)$/i);

  if (match) {
    const month = MONTH_BY_NAME[match[1].toLowerCase()];

    if (!month || (match[6] && match[1].length === 3 && match[1].toLowerCase() !== 'may')) return null;
    return withMeridiem(dateParts(match[3], month, match[2], match[4], match[5], match[6] ?? 0, true), match[7]);
  }

  match = value.match(/^([A-Za-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})$/i);
  if (match) {
    const month = MONTH_BY_NAME[match[1].toLowerCase()];

    return month ? dateParts(match[3], month, match[2], match[4], match[5], 0, true) : null;
  }

  return null;
}

function parseDateOnly(value: string): DateParts | null {
  let match = value.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/);

  if (match) return dateParts(match[1], match[3], match[4]);

  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const monthFirst = dateParts(match[3], first, second);

    if (toUnixSeconds(monthFirst, 0) !== null) return monthFirst;
    return dateParts(match[3], second, first);
  }

  match = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);

    if (isAmbiguousMonthDay(first, second)) return null;
    return first <= 12 ? dateParts(match[3], first, second) : dateParts(match[3], second, first);
  }

  match = value.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/i);
  if (match) {
    const month = MONTH_BY_NAME[match[1].toLowerCase()];

    return month ? dateParts(match[3], month, match[2]) : null;
  }

  match = value.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/i);
  if (match) {
    const month = MONTH_BY_NAME[match[2].toLowerCase()];

    return month ? dateParts(match[3], month, match[1]) : null;
  }

  match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) return dateParts(match[3], match[2], match[1]);

  match = value.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{1,2})$/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[3]);

  if (isAmbiguousMonthDay(first, second)) return null;

  const year = Number(match[4]) >= 50 ? 1900 + Number(match[4]) : 2000 + Number(match[4]);

  if (match[2] === '.') return dateParts(year, second, first);
  return first <= 12 ? dateParts(year, first, second) : dateParts(year, second, first);
}

/** Deterministic port of Desktop's cast_string_to_timestamp parser. */
export function parseDesktopDateToUnixSeconds(input: string): string | null {
  const timezone = parseTimezoneAnnotation(input.trim());

  if (!timezone) return null;

  if (/^[+-]?\d+$/.test(timezone.value)) {
    try {
      const timestamp = BigInt(timezone.value);

      if (timestamp > 1_000_000_000n && timestamp <= 8_210_266_876_799n) {
        const numericTimestamp = Number(timestamp);
        const date = new Date(numericTimestamp * 1000);

        if (!Number.isNaN(date.getTime())) return timestamp.toString();
      }
    } catch {
      return null;
    }
  }

  const parts =
    parseNumericDateTime(timezone.value) ?? parseTextualDateTime(timezone.value) ?? parseDateOnly(timezone.value);

  return parts ? toUnixSeconds(parts, timezone.offsetMinutes) : null;
}
