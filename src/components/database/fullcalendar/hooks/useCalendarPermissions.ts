import dayjs from 'dayjs';
import { useMemo, useCallback } from 'react';

import { FieldType, useCalendarLayoutSetting, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';

/**
 * Hook to manage calendar permissions and behavior based on field type
 * When the layout field is CreatedTime or LastEditedTime, certain features are disabled
 */
export function useCalendarPermissions() {
  const readOnly = useReadOnly();
  const calendarSetting = useCalendarLayoutSetting();
  const { field: layoutField } = useFieldSelector(calendarSetting?.fieldId || '');
  const newRowDispatch = useNewRowDispatch();

  // Get field type
  const fieldType = layoutField ? (Number(layoutField.get(YjsDatabaseKey.type)) as FieldType) : null;

  // Check if field type is created time or modified time
  const isTimeSystemField = useMemo(() => {
    return fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime;
  }, [fieldType]);

  // Calendar interaction permissions
  const permissions = useMemo(() => ({
    editable: !readOnly && !isTimeSystemField,
    selectable: !readOnly && !isTimeSystemField,
    droppable: !readOnly && !isTimeSystemField,
    eventResizable: !readOnly && !isTimeSystemField,
  }), [readOnly, isTimeSystemField]);

  // Add button enabled function that checks hover date
  const isAddButtonEnabled = useCallback((hoverDate: Date) => {
    // If readonly, always disabled
    if (readOnly) return false;
    
    // If not a time system field, always enabled
    if (!isTimeSystemField) return true;
    
    // For time system fields, enable only if hover date matches today
    const today = dayjs().startOf('day');
    const hoverDateFormatted = dayjs(hoverDate).startOf('day');
    
    if (fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime) {
      return today.isSame(hoverDateFormatted);
    }
    
    return false;
  }, [readOnly, isTimeSystemField, fieldType]);

  // Event creation function that uses appropriate dispatch based on field type
  const createEvent = useMemo(() => {
    if (isTimeSystemField) {
      // For created/modified time fields, use newRowDispatch with tailing=true
      return () => newRowDispatch({ tailing: true });
    }
    
    return null; // Return null to indicate should use original handlers
  }, [isTimeSystemField, newRowDispatch]);

  return {
    isTimeSystemField,
    permissions,
    isAddButtonEnabled,
    createEvent,
    fieldType,
  };
}