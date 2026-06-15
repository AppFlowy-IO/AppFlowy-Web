import dayjs from 'dayjs';
import * as Y from 'yjs';

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import {
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YMapFieldTypeOption,
  YjsDatabaseKey,
} from '@/application/types';

export function createRollupField(fieldId: string) {
  const field = new Y.Map() as YDatabaseField;
  const typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;
  const timestamp = String(dayjs().unix());

  field.set(YjsDatabaseKey.name, 'Rollup');
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.Rollup);
  field.set(YjsDatabaseKey.created_at, timestamp);
  field.set(YjsDatabaseKey.last_modified, timestamp);
  field.set(YjsDatabaseKey.is_primary, false);
  field.set(YjsDatabaseKey.icon, '');

  typeOption.set(YjsDatabaseKey.relation_field_id, '');
  typeOption.set(YjsDatabaseKey.target_field_id, '');
  typeOption.set(YjsDatabaseKey.calculation_type, CalculationType.Count);
  typeOption.set(YjsDatabaseKey.show_as, RollupDisplayMode.Calculated);
  typeOption.set(YjsDatabaseKey.condition_value, '');

  typeOptionMap.set(String(FieldType.Rollup), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptionMap);

  return field;
}
