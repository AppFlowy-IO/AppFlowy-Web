import { FieldType } from '@/application/database-yjs';
import { CellProps, TextCell as TextCellType, UrlCell as UrlCellType } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import TextCellEditing from '@/components/database/components/cell/text/TextCellEditing';
import UrlActions from '@/components/database/components/cell/text/UrlActions';
import { cn } from '@/lib/utils';
import { openUrl, processUrl } from '@/utils/url';
import React, { useCallback, useState } from 'react';

export function TextCell ({
  cell,
  style,
  placeholder,
  readOnly,
  fieldId,
  rowId,
  setNeedResizeRowId,
  editing,
  setEditing,
}: CellProps<TextCellType | UrlCellType>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const cellType = cell?.fieldType || FieldType.RichText;
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);

  const isValidUrl = useCallback((url: string) => {
    return !!processUrl(url);
  }, []);

  const [showUrlActions, setShowUrlActions] = useState(false);

  const focusToEnd = useCallback((el: HTMLTextAreaElement) => {
    if (el) {
      const length = el.value.length;

      el.setSelectionRange(length, length);
      el.focus();
    }
  }, []);

  return (
    <>
      <div
        ref={ref}
        style={style}
        onClick={(e) => {
          if (readOnly) {
            const data = cell?.data as string;

            if (data && isValidUrl(data)) {
              e.stopPropagation();
              void openUrl(data, '_blank');
            }

            return;
          }
        }}
        onMouseEnter={() => {
          const data = cell?.data as string;

          if (data && isValidUrl(data) && !editing) {
            setShowUrlActions(true);
          }
        }}
        onMouseLeave={() => {
          setShowUrlActions(false);
        }}
        className={cn(`text-cell w-full text-sm whitespace-pre-wrap break-words ${readOnly ? 'select-auto' : 'cursor-pointer'}`, !cell?.data && placeholder ? 'text-text-placeholder' : '', cellType === FieldType.URL ? 'underline !text-text-action hover:text-text-action-hover' : '')}
      >
        {!editing ? <>{cell?.data || placeholder || ''}</> :
          <TextCellEditing
            ref={focusToEnd}
            cell={cell}
            placeholder={placeholder}
            fieldId={fieldId}
            rowId={rowId}
            onExit={() => {
              setEditing?.(false);
              setNeedResizeRowId?.(rowId);
            }}
            onChange={onUpdateCell}
          />}
        {showUrlActions && !editing && cell && cellType === FieldType.URL && (
          <div className={'absolute right-0 top-1'}>
            <UrlActions url={cell.data || ''} />
          </div>
        )}
      </div>
    </>
  );
}
