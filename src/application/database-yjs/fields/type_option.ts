import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField, YMapFieldTypeOption, YjsDatabaseKey } from '@/application/types';

export function getTypeOptions(field?: YDatabaseField): YMapFieldTypeOption | undefined {
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

  return field?.get(YjsDatabaseKey.type_option)?.get(String(fieldType));
}
