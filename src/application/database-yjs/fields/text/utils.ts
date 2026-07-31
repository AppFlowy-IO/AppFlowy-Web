import dayjs from 'dayjs';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs';
import {
  DateFormat,
  TimeFormat,
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YMapFieldTypeOption,
  YjsDatabaseKey,
} from '@/application/types';

export function createTextField (id: string) {
  const field = new Y.Map() as YDatabaseField;
  const typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;
  const timestamp = String(dayjs().unix());

  field.set(YjsDatabaseKey.name, 'Text');
  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  field.set(YjsDatabaseKey.created_at, timestamp);
  field.set(YjsDatabaseKey.last_modified, timestamp);
  field.set(YjsDatabaseKey.is_primary, false);
  field.set(YjsDatabaseKey.icon, '');

  typeOptionMap.set(String(FieldType.RichText), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptionMap);

  return field;
}

export function createDateTimeField(fieldId: string) {
  const field = new Y.Map() as YDatabaseField;
  const typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;
  const timestamp = String(dayjs().unix());

  field.set(YjsDatabaseKey.name, 'Date');
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.DateTime);
  field.set(YjsDatabaseKey.created_at, timestamp);
  field.set(YjsDatabaseKey.last_modified, timestamp);
  field.set(YjsDatabaseKey.is_primary, false);
  field.set(YjsDatabaseKey.icon, '');

  typeOption.set(YjsDatabaseKey.time_format, TimeFormat.TwentyFourHour);
  typeOption.set(YjsDatabaseKey.date_format, DateFormat.Friendly);
  typeOption.set(YjsDatabaseKey.include_time, true);
  typeOptionMap.set(String(FieldType.DateTime), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptionMap);

  return field;
}

export function parseCheckboxValue(data?: string | number | boolean): boolean {
  if (typeof data === 'boolean') return data;
  if (typeof data === 'number') return data === 1;
  if (typeof data === 'string') {
    const normalized = data.trim().toLowerCase();

    return ['yes', 'true', '1', 'checked', 'x', '[x]', 'on'].includes(normalized);
  }

  return false;
}

/** Match Desktop's CheckboxCellDataPB parser for lazy RichText conversion. */
export function parseDesktopCheckboxValue(data: string | number | boolean): boolean {
  return ['1', 'true', 'yes'].includes(String(data).toLowerCase());
}

export function parseDesktopI64(value: string | number): string | null {
  const text = String(value);

  if (!/^[+-]?\d+$/.test(text)) return null;

  try {
    const parsed = BigInt(text);

    return parsed >= -9223372036854775808n && parsed <= 9223372036854775807n ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function parseTimeStringToMs(text: string): string | null {
  const trimmed = text.trim();

  if (!trimmed) return '';

  const directMilliseconds = parseDesktopI64(trimmed);

  if (directMilliseconds !== null) return directMilliseconds;

  let durationOffset = 0;
  let durationHours: bigint | null = null;
  let durationMinutes: bigint | null = null;
  const durationPart = /\s*(\d+)([hm])/y;

  while (durationOffset < trimmed.length) {
    durationPart.lastIndex = durationOffset;
    const match = durationPart.exec(trimmed);

    if (!match) break;

    const value = BigInt(match[1]);

    if (match[2] === 'h') {
      if (durationHours !== null) return null;
      durationHours = value;
    } else {
      if (durationMinutes !== null) return null;
      durationMinutes = value;
    }

    durationOffset = durationPart.lastIndex;
  }

  if (durationOffset === trimmed.length && (durationHours !== null || durationMinutes !== null)) {
    const milliseconds = ((durationHours ?? 0n) * 60n + (durationMinutes ?? 0n)) * 60_000n;

    if (milliseconds >= -9223372036854775808n && milliseconds <= 9223372036854775807n) {
      return milliseconds.toString();
    }

    return null;
  }

  const hhmmMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (hhmmMatch) {
    const hours = Number(hhmmMatch[1]);
    const minutes = Number(hhmmMatch[2]);
    const seconds = hhmmMatch[3] ? Number(hhmmMatch[3]) : 0;

    if (
      Number.isInteger(hours) &&
      Number.isInteger(minutes) &&
      Number.isInteger(seconds) &&
      hours >= 0 &&
      hours < 24 &&
      minutes >= 0 &&
      minutes < 60 &&
      seconds >= 0 &&
      seconds < 60
    ) {
      return String(hours * 3600 * 1000 + minutes * 60 * 1000 + seconds * 1000);
    }
  }

  return null;
}
