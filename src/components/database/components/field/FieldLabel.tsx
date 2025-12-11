import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs';

function FieldLabel ({ type, ...props }: { type: FieldType } & React.HTMLAttributes<HTMLDivElement>) {
  const { t } = useTranslation();

  const text = useMemo(() => {
    return {
      [FieldType.RichText]: t('grid.field.textFieldName'),
      [FieldType.Number]: t('grid.field.numberFieldName'),
      [FieldType.DateTime]: t('grid.field.dateFieldName'),
      [FieldType.SingleSelect]: t('grid.field.singleSelectFieldName'),
      [FieldType.MultiSelect]: t('grid.field.multiSelectFieldName'),
      [FieldType.Checkbox]: t('grid.field.checkboxFieldName'),
      [FieldType.URL]: t('grid.field.urlFieldName'),
      [FieldType.Checklist]: t('grid.field.checklistFieldName'),
      [FieldType.LastEditedTime]: t('grid.field.updatedAtFieldName'),
      [FieldType.CreatedTime]: t('grid.field.createdAtFieldName'),
      [FieldType.Relation]: t('grid.field.relationFieldName'),
      [FieldType.AISummaries]: t('grid.field.summaryFieldName'),
      [FieldType.AITranslations]: t('grid.field.translateFieldName'),
      [FieldType.FileMedia]: t('grid.field.mediaFieldName'),
      [FieldType.Person]: t('grid.field.personFieldName'),
      [FieldType.Time]: t('grid.field.timeFieldName'),
    }[type];
  }, [t, type]);

  return (
    <div {...props}>{text}</div>
  );
}

export default FieldLabel;
