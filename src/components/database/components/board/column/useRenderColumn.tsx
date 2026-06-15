import { Tooltip } from '@mui/material';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, parseSelectOptionTypeOptions, useFieldSelector } from '@/application/database-yjs';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';

export function useRenderColumn(id: string, fieldId: string) {
  const { field, clock } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const fieldName = field?.get(YjsDatabaseKey.name) || '';
  const { t } = useTranslation();
  const header = useMemo(() => {
    if (!field) return null;
    if (fieldType === FieldType.Checkbox)
      return (
        <div className={'flex items-center gap-2'}>
          {getChecked(id) ? (
            <>
              <CheckboxCheckSvg className={'h-5 w-5'} />
              {t('button.checked')}
            </>
          ) : (
            <>
              {' '}
              <CheckboxUncheckSvg className={'h-5 w-5 text-border-primary hover:text-border-primary-hover'} />
              {t('button.unchecked')}
            </>
          )}
        </div>
      );
    if ([FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
      const option = parseSelectOptionTypeOptions(field)?.options.find((option) => option?.id === id);
      const isFieldId = fieldId === id;
      const label = isFieldId ? `${t('button.no')} ${fieldName}` : option?.name || '';

      return (
        <Tooltip title={label} enterNextDelay={1000} enterDelay={1000}>
          <span>
            <Tag
              label={label}
              textColor={option?.color ? SelectOptionFgColorMap[option?.color] : 'text-text-primary'}
              bgColor={option?.color ? SelectOptionColorMap[option?.color] : 'transparent'}
            />
          </span>
        </Tooltip>
      );
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, clock, fieldType, id, fieldName, t]);

  const renameEnabled = useMemo(() => {
    return [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);
  }, [fieldType]);

  const deleteEnabled = useMemo(() => {
    return true;
  }, []);

  const hideEnabled = useMemo(() => {
    return true;
  }, []);

  return {
    header,
    renameEnabled,
    deleteEnabled,
    hideEnabled,
  };
}
