import { memo, useRef } from 'react';

import { useCellSelector, useReadOnly, useUpdateCellDispatch } from '@/application/database-yjs';
import { TextCell } from '@/application/database-yjs/cell.type';
import { notifyRichTextNewer } from '@/application/database-yjs/fields/text/rich-text-notice';
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
    // A title formatted by a newer version of AppFlowy is shown, never
    // edited (rich text spec R53).
    const requiresNewerClient = Boolean(cell?.richTextReadOnly);

    return (
      <div className='flex w-full items-center gap-2'>
        <Input
          data-testid='calendar-event-title-input'
          readOnly={readOnly || requiresNewerClient}
          autoFocus
          ref={inputRef}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              e.preventDefault();
              if (!requiresNewerClient) void updateCell((e.target as HTMLInputElement).value);
              (onSubmit ?? onCloseEvent)?.();
              return;
            }

            if (requiresNewerClient && !readOnly && e.key.length === 1) notifyRichTextNewer();
          }}
          onPaste={() => {
            if (requiresNewerClient && !readOnly) notifyRichTextNewer();
          }}
          value={value ?? ''}
          onChange={(e) => {
            void updateCell(e.target.value);
          }}
          placeholder='Untitled'
          variant={'ghost'}
          className={'!h-9 flex-1 text-base font-semibold text-text-primary'}
        />
      </div>
    );
  }
);
