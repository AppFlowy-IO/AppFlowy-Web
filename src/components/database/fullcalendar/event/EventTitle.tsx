import { memo, useRef } from 'react';

import { useCellSelector, useReadOnly, useUpdateCellDispatch } from '@/application/database-yjs';
import { TextCell } from '@/application/database-yjs/cell.type';
import { Input } from '@/components/ui/input';

export const EventTitle = memo(
  ({
    rowId,
    fieldId,
    onCloseEvent,
    onSubmit,
  }: {
    rowId: string;
    fieldId: string;
    onCloseEvent?: () => void;
    onSubmit?: () => void;
  }) => {
    const readOnly = useReadOnly();
    const cell = useCellSelector({ rowId, fieldId }) as TextCell;
    const value = cell?.data;
    const inputRef = useRef<HTMLInputElement | null>(null);
    const updateCell = useUpdateCellDispatch(rowId, fieldId);

    return (
      <div className='flex w-full items-center gap-2'>
        <Input
          data-testid='calendar-event-title-input'
          readOnly={readOnly}
          autoFocus
          ref={inputRef}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              e.preventDefault();
              updateCell((e.target as HTMLInputElement).value);
              (onSubmit ?? onCloseEvent)?.();
            }
          }}
          value={value ?? ''}
          onChange={(e) => {
            updateCell(e.target.value);
          }}
          placeholder='Untitled'
          variant={'ghost'}
          className={'!h-9 flex-1 text-base font-semibold text-text-primary'}
        />
      </div>
    );
  }
);
