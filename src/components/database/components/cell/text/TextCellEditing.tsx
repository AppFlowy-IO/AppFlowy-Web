import { Cell } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { FieldId } from '@/application/types';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { forwardRef, memo, useState } from 'react';

function TextCellEditing ({
  cell,
  placeholder,
  rowId,
  fieldId,
  onExit,
  onChange,
}: {
  cell?: Cell;
  rowId: string;
  fieldId: FieldId;
  placeholder?: string;
  onExit?: () => void;
  onChange?: (value: string) => void;
}, ref: React.Ref<HTMLTextAreaElement>) {

  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);

  const [inputValue, setInputValue] = useState<string>(() => {
    if (cell) {
      return (cell.data as string) || '';
    }

    return '';
  });

  return (
    <TextareaAutosize
      ref={ref}
      onMouseDown={e => {
        e.stopPropagation();
      }}
      autoFocus
      value={inputValue}
      onChange={e => {
        setInputValue(e.target.value);
        onChange?.(e.target.value);
      }}
      onKeyDown={e => {
        if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
          e.stopPropagation();
          if (inputValue !== cell?.data) {
            onUpdateCell(inputValue);
          }

          onExit?.();
        } else if (createHotkey(HOT_KEY_NAME.ESCAPE)(e.nativeEvent)) {
          e.stopPropagation();
          onExit?.();
        }
      }}
      onBlur={() => {
        if (inputValue !== cell?.data) {
          onUpdateCell(inputValue);
        }

        onExit?.();
      }}
      placeholder={placeholder}
      variant={'ghost'}
      size={'sm'}
      className={'w-full px-0 rounded-none'}
    />
  );
}

export default memo(forwardRef(TextCellEditing));