import { FieldType, SelectOptionColor } from '@/application/database-yjs';
import { YDatabaseCell, YjsDatabaseKey } from '@/application/types';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';

export function createSelectOptionCell (fieldId: string, type: FieldType, data: string) {
  const cell = new Y.Map() as YDatabaseCell;

  cell.set(YjsDatabaseKey.id, fieldId);
  cell.set(YjsDatabaseKey.data, data);
  cell.set(YjsDatabaseKey.field_type, Number(type));
  cell.set(YjsDatabaseKey.created_at, Date.now());
  cell.set(YjsDatabaseKey.last_modified, Date.now());

  return cell;
}

export function generateOptionId () {
  return nanoid(6);
}

export function getColorByFirstChar (text: string): SelectOptionColor {
  if (!text || text.length === 0) {
    const colors = Object.values(SelectOptionColor);

    return colors[Math.floor(Math.random() * colors.length)];
  }

  const firstChar = text.charAt(0).toUpperCase();

  const charCode = firstChar.charCodeAt(0);

  const colors = Object.values(SelectOptionColor);

  const colorIndex = charCode % colors.length;

  return colors[colorIndex];
}