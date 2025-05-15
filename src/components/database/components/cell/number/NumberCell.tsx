import {
  NumberFormat,
  getFormatValue,
} from '@/application/database-yjs';
import { CellProps, NumberCell as NumberCellType } from '@/application/database-yjs/cell.type';
import { YjsDatabaseKey } from '@/application/types';
import { useFieldTypeOption } from '@/components/database/components/cell/Cell.hooks';
import NumberCellEditing from '@/components/database/components/cell/number/NumberCellEditing';
import { cn } from '@/lib/utils';
import React, { useCallback, useMemo } from 'react';

export function NumberCell ({
  cell,
  fieldId,
  style,
  placeholder,
  editing,
  setEditing,
  readOnly,
  rowId,
  setNeedResizeRowId,
}: CellProps<NumberCellType>) {

  const typeOption = useFieldTypeOption(fieldId);

  const format = typeOption ? Number(typeOption.get(YjsDatabaseKey.format)) as NumberFormat : NumberFormat.Num;

  const value = useMemo(() => {
    if (!cell) return '';

    return getFormatValue(cell.data, format);
  }, [cell, format]);

  const focusToEnd = useCallback((el: HTMLTextAreaElement) => {
    if (el) {
      const length = el.value.length;

      el.setSelectionRange(length, length);
      el.focus();
    }
  }, []);

  const undefinedValue = value === undefined;

  if (undefinedValue)
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
      className={cn('select-text w-full whitespace-pre-wrap break-all', readOnly ? 'cursor-text' : 'cursor-pointer', undefinedValue && placeholder ? 'text-text-placeholder' : '')}
    >
      {undefinedValue ? placeholder : editing ? <NumberCellEditing
        ref={focusToEnd}
        fieldId={fieldId}
        rowId={rowId}
        defaultValue={value}
        onExit={() => {
          setEditing?.(false);
          setNeedResizeRowId?.(rowId);
        }}
      /> : (
        <>{value}</>
      )}
    </div>
  );
}
