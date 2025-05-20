import { DateFormat, TimeFormat } from '@/application/database-yjs';
import { DateTimeCell } from '@/application/database-yjs/cell.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { renderDate } from '@/utils/time';
import dayjs from 'dayjs';

export function getTimeFormat (timeFormat?: TimeFormat) {
  switch (timeFormat) {
    case TimeFormat.TwelveHour:
      return 'h:mm A';
    case TimeFormat.TwentyFourHour:
      return 'HH:mm';
    default:
      return 'HH:mm';
  }
}

export function getDateFormat (dateFormat?: DateFormat) {
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

function getDateTimeStr ({
  timeStamp,
  includeTime,
  typeOptionValue,
}: {
  timeStamp: string;
  includeTime?: boolean;
  typeOptionValue: {
    timeFormat: TimeFormat;
    dateFormat: DateFormat;
  };
}) {
  if (!typeOptionValue || !timeStamp) return null;
  const timeFormat = getTimeFormat(typeOptionValue.timeFormat);
  const dateFormat = getDateFormat(typeOptionValue.dateFormat);
  const format = [dateFormat];

  if (includeTime) {
    format.push(timeFormat);
  }

  return renderDate(timeStamp, format.join(' '), true);
}

export function getDateCellStr ({
  cell,
  field,
}: {
  cell: DateTimeCell;
  field: YDatabaseField;
}) {
  const typeOptionMap = field.get(YjsDatabaseKey.type_option);
  const typeOption = typeOptionMap.get(String(cell.fieldType));
  const timeFormat = parseInt(typeOption.get(YjsDatabaseKey.time_format)) as TimeFormat;

  const dateFormat = parseInt(typeOption.get(YjsDatabaseKey.date_format)) as DateFormat;

  const startData = cell.data || '';
  const includeTime = cell.includeTime;

  const typeOptionValue = {
    timeFormat,
    dateFormat,
  };

  const startDateTime = getDateTimeStr({
    timeStamp: startData,
    includeTime,
    typeOptionValue,
  });

  const endTimestamp = cell.endTimestamp;

  const isRange = cell.isRange;

  const endDateTime = endTimestamp && isRange ? getDateTimeStr({
    timeStamp: endTimestamp,
    includeTime,
    typeOptionValue,
  }) : null;

  return [startDateTime, endDateTime].filter(Boolean).join(' - ');
}

export function isDate (input: string) {
  const date = dayjs(input);

  return date.isValid();
}

export function safeParseTimestamp (input: string) {

  if (/^\d+$/.test(input)) {
    if (input.length >= 9 && input.length <= 10) {
      return dayjs.unix(parseInt(input, 10));
    } else if (input.length >= 12 && input.length <= 13) {
      return dayjs(parseInt(input, 10));
    }
  }

  return dayjs(input);
}