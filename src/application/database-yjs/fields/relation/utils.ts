import dayjs from 'dayjs';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs';
import {
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YMapFieldTypeOption,
  YjsDatabaseKey,
} from '@/application/types';

import { RelationLimit, RelationTypeOption } from './relation.type';

export type RelationFieldOptions = Partial<RelationTypeOption> & {
  name?: string;
};

export function setRelationTypeOptionValues(
  typeOption: YMapFieldTypeOption,
  options: Partial<RelationTypeOption> = {}
) {
  typeOption.set(YjsDatabaseKey.database_id, options.database_id ?? '');
  typeOption.set(YjsDatabaseKey.is_two_way, options.is_two_way ?? false);
  typeOption.set(YjsDatabaseKey.source_limit, options.source_limit ?? RelationLimit.NoLimit);
  typeOption.set(YjsDatabaseKey.target_limit, options.target_limit ?? RelationLimit.NoLimit);

  if (options.reciprocal_field_id) {
    typeOption.set(YjsDatabaseKey.reciprocal_field_id, options.reciprocal_field_id);
  } else {
    typeOption.delete(YjsDatabaseKey.reciprocal_field_id);
  }

  if (options.reciprocal_field_name) {
    typeOption.set(YjsDatabaseKey.reciprocal_field_name, options.reciprocal_field_name);
  } else {
    typeOption.delete(YjsDatabaseKey.reciprocal_field_name);
  }
}

export function createRelationField(fieldId: string, options: RelationFieldOptions = {}) {
  const field = new Y.Map() as YDatabaseField;
  const typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;
  const timestamp = String(dayjs().unix());

  field.set(YjsDatabaseKey.name, options.name || 'Relation');
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.Relation);
  field.set(YjsDatabaseKey.created_at, timestamp);
  field.set(YjsDatabaseKey.last_modified, timestamp);
  field.set(YjsDatabaseKey.is_primary, false);
  field.set(YjsDatabaseKey.icon, '');

  setRelationTypeOptionValues(typeOption, options);
  typeOptionMap.set(String(FieldType.Relation), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptionMap);

  return field;
}
