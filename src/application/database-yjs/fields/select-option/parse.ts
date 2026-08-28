import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { getTypeOptions } from '../type_option';

import { SelectTypeOption } from './select_option.type';

export function parseSelectOptionTypeOptions(field: YDatabaseField, fieldType?: FieldType) {
  const content = getTypeOptions(field, fieldType)?.get(YjsDatabaseKey.content);

  if (!content)
    return {
      options: [],
    };

  try {
    return JSON.parse(content) as SelectTypeOption;
  } catch (e) {
    return {
      options: [],
    };
  }
}

export function parseSelectOptionCellData(field: YDatabaseField, data: string) {
  const typeOption = parseSelectOptionTypeOptions(field);
  const selectedIds = typeof data === 'string' ? data.split(',') : [];

  return selectedIds
    .map((id) => {
      const option = typeOption?.options?.find((option) => option?.id === id);

      return option?.name ?? '';
    })
    .join(', ');
}
