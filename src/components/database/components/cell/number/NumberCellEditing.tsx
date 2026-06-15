import React, { forwardRef, memo, useCallback, useState } from 'react';

import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import EnhancedBigStats from '@/application/database-yjs/fields/number/EnhancedBigStats';
import { FieldId } from '@/application/types';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

function NumberCellEditing ({
  defaultValue,
  rowId,
  fieldId,
  onExit,
}: {
  defaultValue: string;
  rowId: string;
  fieldId: FieldId;
  onExit?: () => void;
}, ref: React.Ref<HTMLTextAreaElement>) {
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);

  const [inputValue, setInputValue] = useState<string>(defaultValue);

  const handleUpdateCell = useCallback((value: string) => {
    const decimalValue = EnhancedBigStats.parse(value);

    onUpdateCell(decimalValue || '');
  }, [onUpdateCell]);

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
      }}
      onKeyDown={e => {
        if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
          e.stopPropagation();
          if (inputValue !== defaultValue) {
            handleUpdateCell(inputValue);
          }

          onExit?.();
        } else if (createHotkey(HOT_KEY_NAME.ESCAPE)(e.nativeEvent)) {
          e.stopPropagation();
          onExit?.();
        }
      }}
      onBlur={() => {
        if (inputValue !== defaultValue) {
          handleUpdateCell(inputValue);
        }

        onExit?.();
      }}
      variant={'ghost'}
      size={'sm'}
      className={'w-full px-0 rounded-none'}
    />
  );
}

export default memo(forwardRef(NumberCellEditing));