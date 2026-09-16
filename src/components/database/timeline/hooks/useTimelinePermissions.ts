import { useMemo } from 'react';

import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';

/**
 * Date gestures require writable endpoints. System timestamps can still be
 * displayed while ordinary row, property, and progress editing stays enabled.
 */
export function useTimelinePermissions(fieldId: string, endFieldId = '') {
  const readOnly = useReadOnly();
  const { field } = useFieldSelector(fieldId);
  const { field: endField } = useFieldSelector(endFieldId);
  const fieldType = field ? (Number(field.get(YjsDatabaseKey.type)) as FieldType) : null;
  const endFieldType = endField ? (Number(endField.get(YjsDatabaseKey.type)) as FieldType) : null;
  const isTimeSystemField = fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime;
  const writableDates = fieldType === FieldType.DateTime && (!endFieldId || endFieldType === FieldType.DateTime);

  return useMemo(
    () => ({
      readOnly,
      isTimeSystemField,
      editable: !readOnly,
      dateEditable: !readOnly && writableDates,
    }),
    [isTimeSystemField, readOnly, writableDates]
  );
}
