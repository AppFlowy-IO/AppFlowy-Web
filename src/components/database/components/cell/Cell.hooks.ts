import { YjsDatabaseKey } from '@/application/types';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { DateFormat, TimeFormat, getDateFormat, getTimeFormat, getTypeOptions } from '@/application/database-yjs';
import { renderDate } from '@/utils/time';
import { useCallback, useMemo } from 'react';

export function useFieldTypeOption (fieldId: string) {
  const { field } = useFieldSelector(fieldId);

  return useMemo(() => {
    return getTypeOptions(field);
  }, [field]);
}

export function useDateTypeCellDispatcher (fieldId: string) {
  const typeOption = useFieldTypeOption(fieldId);
  const typeOptionValue = useMemo(() => {
    if (!typeOption) return null;
    return {
      timeFormat: parseInt(typeOption.get(YjsDatabaseKey.time_format)) as TimeFormat,
      dateFormat: parseInt(typeOption.get(YjsDatabaseKey.date_format)) as DateFormat,
    };
  }, [typeOption]);

  const getDateTimeStr = useCallback(
    (timeStamp: string, includeTime?: boolean) => {
      if (!typeOptionValue || !timeStamp) return null;
      const timeFormat = getTimeFormat(typeOptionValue.timeFormat);
      const dateFormat = getDateFormat(typeOptionValue.dateFormat);
      const format = [dateFormat];

      if (includeTime) {
        format.push(timeFormat);
      }

      return renderDate(timeStamp, format.join(' '), true);
    },
    [typeOptionValue],
  );

  return {
    getDateTimeStr,
    typeOptionValue,
  };
}
