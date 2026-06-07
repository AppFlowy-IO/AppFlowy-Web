import { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { FieldType, parseSelectOptionTypeOptions, useFieldSelector } from '@/application/database-yjs';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

export function getBoardColumnName({
  id,
  fieldId,
  field,
  fieldType,
  t,
}: {
  id: string;
  fieldId: string;
  field?: YDatabaseField;
  fieldType: FieldType;
  t: TFunction;
}) {
  if (!field) return id;

  if (fieldType === FieldType.Checkbox) {
    return getChecked(id) ? t('button.yes') : t('button.no');
  }

  if ([FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
    const fieldName = field.get(YjsDatabaseKey.name) || '';
    const option = parseSelectOptionTypeOptions(field)?.options.find((option) => option?.id === id);

    return fieldId === id ? `${t('button.no')} ${fieldName}` : option?.name || id;
  }

  return id;
}

export function useBoardColumnName(id: string, fieldId: string) {
  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const { t } = useTranslation();

  return getBoardColumnName({ id, fieldId, field, fieldType, t });
}
