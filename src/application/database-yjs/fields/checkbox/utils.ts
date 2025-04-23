import { FieldType } from '@/application/database-yjs';
import { YDatabaseCell, YjsDatabaseKey } from '@/application/types';
import dayjs from 'dayjs';
import * as Y from 'yjs';

export function createCheckboxCell (fieldId: string, data: string) {
  const cell = new Y.Map() as YDatabaseCell;

  cell.set(YjsDatabaseKey.id, fieldId);
  cell.set(YjsDatabaseKey.data, data);
  cell.set(YjsDatabaseKey.field_type, String(FieldType.Checkbox));
  cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

  return cell;
}