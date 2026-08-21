import dayjs from 'dayjs';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs';
import { YDatabaseCell, YjsDatabaseKey } from '@/application/types';

export function createCheckboxCell(fieldId: string, data: string) {
  const cell = new Y.Map() as YDatabaseCell;

  cell.set(YjsDatabaseKey.id, fieldId);
  cell.set(YjsDatabaseKey.data, data);
  cell.set(YjsDatabaseKey.field_type, FieldType.Checkbox);
  cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

  return cell;
}

export function getChecked(data?: string | number | boolean) {
  if (typeof data === 'boolean') {
    return data;
  }

  if (typeof data === 'number') {
    return data === 1;
  }

  if (typeof data === 'string') {
    return ['yes', '1', 'true'].includes(data.toLowerCase());
  }

  return false;
}
