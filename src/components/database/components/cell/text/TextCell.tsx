import { FieldType, useFieldWrap } from '@/application/database-yjs';
import {
  Cell,
  CellProps,
} from '@/application/database-yjs/cell.type';
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
  editing,
  setEditing,
}: CellProps<Cell>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const cellType = cell?.fieldType || FieldType.RichText;

  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);

  const middleware = useCallback((data: unknown) => {
    if (typeof data !== 'string' && typeof data !== 'number') {
      return '';
    }

    return data as string || '';
  }, []);

  const value = middleware(cell?.data);

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
  const wrap = useFieldWrap(fieldId);

  return (
    <>
      <div
        ref={ref}
        style={style}
        onClick={(e) => {
          if (readOnly) {

            if (value && isValidUrl(value)) {
              e.stopPropagation();
              void openUrl(value, '_blank');
            }

            return;
          }
        }}
        onMouseEnter={() => {

          if (value && isValidUrl(value) && !editing) {
            setShowUrlActions(true);
          }
        }}
        onMouseLeave={() => {
          setShowUrlActions(false);
        }}
        className={cn(`text-cell w-full text-sm ${readOnly ? 'select-auto' : 'cursor-pointer'}`, !value && placeholder ? 'text-text-placeholder' : '', cellType === FieldType.URL ? 'underline !text-text-action hover:text-text-action-hover' : '', wrap ? ' whitespace-pre-wrap break-words' : 'whitespace-nowrap')}
      >
        {!editing ? <>{value || placeholder || ''}</> :
          <TextCellEditing
            ref={focusToEnd}
            defaultValue={value}
            placeholder={placeholder}
            fieldId={fieldId}
            rowId={rowId}
            onExit={() => {
              setEditing?.(false);
            }}
            onChange={onUpdateCell}
          />}
        {showUrlActions && !editing && cell && cellType === FieldType.URL && (
          <div className={'absolute right-0 top-1'}>
            <UrlActions url={value} />
          </div>
        )}
      </div>
    </>
  );
}
