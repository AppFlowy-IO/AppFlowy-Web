import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField, YMapFieldTypeOption, YjsDatabaseKey } from '@/application/types';

export function getTypeOptions(
  field?: YDatabaseField,
  fieldType?: FieldType
): YMapFieldTypeOption | undefined {
  // Resolve the type-option entry for an explicit field type when provided.
  // A converted cell keeps its data in the *source* type's format, and the
  // field retains the source type's type-option, so callers rendering such a
  // cell must look it up by the source type rather than the field's current
  // type (which would otherwise miss the options and drop the value).
  const type = (fieldType ?? Number(field?.get(YjsDatabaseKey.type))) as FieldType;

  return field?.get(YjsDatabaseKey.type_option)?.get(String(type));
}
