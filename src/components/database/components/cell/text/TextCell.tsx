import { CellProps, TextCell as TextCellType } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import TextCellEditing from '@/components/database/components/cell/text/TextCellEditing';
import { cn } from '@/lib/utils';
import React, { useCallback, useEffect } from 'react';

export function TextCell ({ cell, style, placeholder, readOnly, fieldId, rowId }: CellProps<TextCellType>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [editing, setEditing] = React.useState(false);
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);
  const focusToEnd = useCallback((el: HTMLTextAreaElement) => {
    if (el) {
      const length = el.value.length;

      el.setSelectionRange(length, length);
      el.focus();
    }
  }, []);

  useEffect(() => {
    const el = ref.current;

    if (!el || readOnly) return;

    const rowCellEl = el.closest('.grid-row-cell') as HTMLDivElement;

    if (!rowCellEl) return;

    if (editing) {
      rowCellEl.classList.add('editing');
    } else {
      rowCellEl.classList.remove('editing');
    }
  }, [editing, readOnly]);
  return (
    <>
      <div
        ref={ref}
        style={style}
        onClick={() => {
          if (readOnly) return;
          setEditing(true);
        }}
        className={cn(`text-cell h-full w-full text-sm ${readOnly ? 'select-auto' : 'cursor-pointer'}`, !cell?.data && placeholder ? 'text-text-placeholder' : '')}
      >
        {!editing ? <>{cell?.data || placeholder || ''}</> :
          <TextCellEditing
            ref={focusToEnd}
            cell={cell}
            placeholder={placeholder}
            fieldId={fieldId}
            rowId={rowId}
            onExit={() => setEditing(false)}
            onChange={onUpdateCell}
          />}

      </div>
    </>
  );
}
