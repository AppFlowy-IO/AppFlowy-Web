import { forwardRef, memo, useState, type Ref } from 'react';

import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { FieldId } from '@/application/types';
import { isDatabaseHistoryHotkey } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

const isEnterHotkey = createHotkey(HOT_KEY_NAME.ENTER);
const isEscapeHotkey = createHotkey(HOT_KEY_NAME.ESCAPE);

function TextCellEditing(
  {
    defaultValue = '',
    placeholder,
    rowId,
    fieldId,
    onExit,
    onChange,
  }: {
    defaultValue?: string;
    rowId: string;
    fieldId: FieldId;
    placeholder?: string;
    onExit?: () => void;
    onChange?: (value: string) => void;
  },
  ref: Ref<HTMLTextAreaElement>
) {
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);

  const [inputValue, setInputValue] = useState<string>(defaultValue);
  const [prevDefaultValue, setPrevDefaultValue] = useState<string>(defaultValue);

  // Reconcile external value changes (undo/redo, remote sync) during render
  // instead of in an effect, avoiding an extra commit + paint of the stale
  // value. A dirty local draft still owns the editor until it is committed.
  if (defaultValue !== prevDefaultValue) {
    const wasClean = inputValue === prevDefaultValue;

    setPrevDefaultValue(defaultValue);

    if (wasClean) {
      setInputValue(defaultValue);
    }
  }

  return (
    <TextareaAutosize
      ref={ref}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      autoFocus
      value={inputValue}
      onChange={(e) => {
        setInputValue(e.target.value);
        onChange?.(e.target.value);
      }}
      onKeyDown={(e) => {
        const isHistoryHotkey = isDatabaseHistoryHotkey(e.nativeEvent);

        if (!isHistoryHotkey || inputValue !== defaultValue) {
          e.stopPropagation();
        }

        if (isEnterHotkey(e.nativeEvent) || isEscapeHotkey(e.nativeEvent)) {
          if (inputValue !== defaultValue) {
            onUpdateCell(inputValue);
          }

          onExit?.();
        }
      }}
      onBlur={() => {
        if (inputValue !== defaultValue) {
          onUpdateCell(inputValue);
        }

        onExit?.();
      }}
      placeholder={placeholder}
      data-database-history-hotkeys={inputValue === defaultValue ? 'true' : undefined}
      variant={'ghost'}
      size={'sm'}
      className={'w-full rounded-none  px-0 text-text-primary'}
    />
  );
}

export default memo(forwardRef(TextCellEditing));
