import { FieldType, useDateTimeCellString } from '@/application/database-yjs';
import { CellProps, DateTimeCell as DateTimeCellType } from '@/application/database-yjs/cell.type';
import React from 'react';
import { ReactComponent as ReminderSvg } from '@/assets/icons/clock_alarm.svg';

export function DateTimeCell ({ cell, fieldId, style, placeholder }: CellProps<DateTimeCellType>) {
  const dateStr = useDateTimeCellString(cell, fieldId);

  const hasReminder = !!cell?.reminderId;

  if (cell?.fieldType !== FieldType.DateTime) return null;
  if (!cell?.data)
    return placeholder ? (
      <div
        style={style}
        className={'text-text-placeholder'}
      >
        {placeholder}
      </div>
    ) : null;
  return (
    <div
      style={style}
      className={'flex cursor-text gap-1'}
    >
      {dateStr}
      {hasReminder && <ReminderSvg className={'h-5 w-5'} />}
    </div>
  );
}
