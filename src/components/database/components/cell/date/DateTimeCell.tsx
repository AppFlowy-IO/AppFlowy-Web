import { useDateTimeCellString } from '@/application/database-yjs';
import { CellProps, DateTimeCell as DateTimeCellType } from '@/application/database-yjs/cell.type';
import DateTimeCellPicker from '@/components/database/components/cell/date/DateTimeCellPicker';
import { cn } from '@/lib/utils';
import React, { useCallback } from 'react';
import { ReactComponent as ReminderSvg } from '@/assets/icons/clock_alarm.svg';

export function DateTimeCell ({
  cell,
  rowId,
  fieldId,
  style,
  placeholder,
  editing,
  setEditing,
}: CellProps<DateTimeCellType>) {
  const dateStr = useDateTimeCellString(cell, fieldId);

  const hasReminder = !!cell?.reminderId;

  const handleOpenChange = useCallback((status: boolean) => {
    setEditing?.(status);
  }, [setEditing]);

  return (
    <div
      style={style}
      className={cn('flex cursor-text gap-1', !cell?.data && 'text-text-placeholder')}
    >
      {cell?.data ? dateStr : (placeholder || null)}
      {hasReminder && <ReminderSvg className={'h-5 w-5'} />}
      {editing ? (
        <DateTimeCellPicker
          cell={cell}
          fieldId={fieldId}
          rowId={rowId}
          open={editing}
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </div>
  );
}
