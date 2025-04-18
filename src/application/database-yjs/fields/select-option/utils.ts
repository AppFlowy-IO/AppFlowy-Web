import { FieldType } from '@/application/database-yjs';
import { YDatabaseCell, YjsDatabaseKey } from '@/application/types';
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
