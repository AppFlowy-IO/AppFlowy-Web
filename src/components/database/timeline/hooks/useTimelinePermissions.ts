import { useMemo } from 'react';

import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';

/**
 * Whether bars can be moved, resized or created. Created/last-edited time
 * fields are system-managed, so a timeline plotted on them is read-only, as
 * in the calendar.
 */
export function useTimelinePermissions(fieldId: string) {
  const readOnly = useReadOnly();
  const { field } = useFieldSelector(fieldId);
  const fieldType = field ? (Number(field.get(YjsDatabaseKey.type)) as FieldType) : null;
  const isTimeSystemField = fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime;

  return useMemo(
    () => ({
      readOnly,
      isTimeSystemField,
      editable: !readOnly && !isTimeSystemField,
    }),
    [isTimeSystemField, readOnly]
  );
}
