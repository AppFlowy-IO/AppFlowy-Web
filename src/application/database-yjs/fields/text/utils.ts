import { FieldType } from '@/application/database-yjs';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';
import dayjs from 'dayjs';
import * as Y from 'yjs';

export function createTextField (id: string) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.name, 'Text');
  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

  return field;
}
