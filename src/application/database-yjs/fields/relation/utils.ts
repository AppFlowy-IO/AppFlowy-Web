import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs';
import {
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YMapFieldTypeOption,
  YjsDatabaseKey,
} from '@/application/types';

export function createRelationField(fieldId: string) {
  const field = new Y.Map() as YDatabaseField;
  const typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;

  field.set(YjsDatabaseKey.name, 'Relation');
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.Relation);

  typeOption.set(YjsDatabaseKey.database_id, '');
  typeOptionMap.set(String(FieldType.Relation), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptionMap);

  return field;
}
