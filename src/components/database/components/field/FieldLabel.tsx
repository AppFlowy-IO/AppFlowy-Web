import React from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The localized name of a property type (the strings of the property type
 * picker). The one table for every place that names a type; an unknown type
 * has no name.
 */
export function getFieldTypeName(type: FieldType, t: Translate): string {
  switch (type) {
    case FieldType.RichText:
      return t('grid.field.textFieldName');
    case FieldType.Number:
      return t('grid.field.numberFieldName');
    case FieldType.DateTime:
      return t('grid.field.dateFieldName');
    case FieldType.SingleSelect:
      return t('grid.field.singleSelectFieldName');
    case FieldType.MultiSelect:
      return t('grid.field.multiSelectFieldName');
    case FieldType.Checkbox:
      return t('grid.field.checkboxFieldName');
    case FieldType.URL:
      return t('grid.field.urlFieldName');
    case FieldType.Checklist:
      return t('grid.field.checklistFieldName');
    case FieldType.LastEditedTime:
      return t('grid.field.updatedAtFieldName');
    case FieldType.CreatedTime:
      return t('grid.field.createdAtFieldName');
    case FieldType.CreatedBy:
      return t('grid.field.createdByFieldName');
    case FieldType.LastEditedBy:
      return t('grid.field.lastEditedByFieldName');
    case FieldType.Relation:
      return t('grid.field.relationFieldName');
    case FieldType.Summary:
      return t('grid.field.summaryFieldName');
    case FieldType.Translate:
      return t('grid.field.translateFieldName');
    case FieldType.Media:
      return t('grid.field.mediaFieldName');
    case FieldType.Person:
      return t('grid.field.personFieldName');
    case FieldType.Time:
      return t('grid.field.timeFieldName');
    case FieldType.Rollup:
      return t('grid.field.rollupFieldName', { defaultValue: 'Rollup' });
    case FieldType.Formula:
      return t('grid.field.formulaFieldName', { defaultValue: 'Formula' });
    default:
      return '';
  }
}

function FieldLabel({ type, ...props }: { type: FieldType } & React.HTMLAttributes<HTMLDivElement>) {
  const { t } = useTranslation();

  return <div {...props}>{getFieldTypeName(type, t)}</div>;
}

export default FieldLabel;
