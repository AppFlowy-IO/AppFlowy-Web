import { useCallback, useMemo } from 'react';

import { NumberFormat } from '@/application/database-yjs';
import { CellProps, NumberCell as NumberCellType } from '@/application/database-yjs/cell.type';
import EnhancedBigStats from '@/application/database-yjs/fields/number/EnhancedBigStats';
import { YjsDatabaseKey } from '@/application/types';
import { useFieldTypeOption } from '@/components/database/components/cell/Cell.hooks';
import NumberCellEditing from '@/components/database/components/cell/number/NumberCellEditing';
import { cn } from '@/lib/utils';

export function NumberCell({
  cell,
  fieldId,
  style,
  placeholder,
  editing,
  setEditing,
  readOnly,
  rowId,
  wrap,
}: CellProps<NumberCellType>) {
  const typeOption = useFieldTypeOption(fieldId);

  const format = typeOption ? (Number(typeOption.get(YjsDatabaseKey.format)) as NumberFormat) : NumberFormat.Num;

  const value = useMemo(() => {
    if (!cell) return '';

    return EnhancedBigStats.parse(cell.data, format) || '';
  }, [cell, format]);

  const focusToEnd = useCallback((el: HTMLTextAreaElement) => {
    if (el) {
      const length = el.value.length;

      el.setSelectionRange(length, length);
      el.focus();
    }
  }, []);

  const undefinedValue = value === undefined;

  return (
    <div
      style={style}
      className={cn(
        'w-full select-text',
        readOnly ? 'cursor-text' : 'cursor-pointer',
        undefinedValue && placeholder ? 'text-text-tertiary' : '',
        wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-nowrap'
      )}
    >
      {undefinedValue ? (
        placeholder
      ) : editing ? (
        <NumberCellEditing
          ref={focusToEnd}
          fieldId={fieldId}
          rowId={rowId}
          defaultValue={value}
          onExit={() => {
            setEditing?.(false);
          }}
        />
      ) : (
        <>{value}</>
      )}
    </div>
  );
}
