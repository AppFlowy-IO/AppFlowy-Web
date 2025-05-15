import { FieldType } from '@/application/database-yjs';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';
import * as Y from 'yjs';

export function createTextField (id: string) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.name, 'Text');
  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.type, FieldType.RichText);

  return field;
}
