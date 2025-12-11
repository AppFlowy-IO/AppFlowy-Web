import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

export function createTextField (id: string) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.name, 'Text');
  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.type, FieldType.RichText);

  return field;
}

export function createDateTimeField(fieldId: string) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.name, 'Date');
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.DateTime);
  
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

export function parseTimeStringToMs(text: string): string | null {
  const trimmed = text.trim();

  if (!trimmed) return '';

  if (!Number.isNaN(Number(trimmed))) {
    return String(trimmed);
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
