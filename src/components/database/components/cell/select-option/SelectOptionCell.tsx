import { useFieldSelector, parseSelectOptionTypeOptions, useFieldWrap } from '@/application/database-yjs';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap } from '@/components/database/components/cell/cell.const';
import { CellProps, SelectOptionCell as SelectOptionCellType } from '@/application/database-yjs/cell.type';
import SelectOptionCellMenu from '@/components/database/components/cell/select-option/SelectOptionCellMenu';
import { cn } from '@/lib/utils';
import React, { useCallback, useMemo } from 'react';

export function SelectOptionCell ({
  editing,
  setEditing,
  cell,
  fieldId,
  style,
  placeholder,
  rowId,
}: CellProps<SelectOptionCellType>) {
  const selectOptionIds = useMemo(() => (!cell?.data || typeof cell.data !== 'string' ? [] : cell.data.split(',')), [cell]);
  const { field, clock } = useFieldSelector(fieldId);
  const typeOption = useMemo(() => {
    if (!field) return null;
    return parseSelectOptionTypeOptions(field);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, clock]);

  const renderSelectedOptions = useCallback(
    (selected: string[]) =>
      selected.map((id) => {
        const option = typeOption?.options?.find((option) => option.id === id);

        if (!option) return null;
        return <div className={'min-w-fit max-w-[120px]'}><Tag
          key={option.id}
          color={SelectOptionColorMap[option.color]}
          label={option.name}
        /></div>;
      }),
    [typeOption],
  );

  const isEmpty = !typeOption || !selectOptionIds?.length;

  const handleOpenChange = useCallback((status: boolean) => {
    setEditing?.(status);
  }, [setEditing]);

  const wrap = useFieldWrap(fieldId);

  return (
    <div
      style={style}
      className={cn('select-option-cell flex w-full items-center gap-1 overflow-x-hidden', isEmpty && placeholder ? 'text-text-placeholder' : '', wrap ? 'flex-wrap' : 'flex-nowrap')}
    >
      {isEmpty ? placeholder || null : renderSelectedOptions(selectOptionIds)}
      {editing ? (
        <SelectOptionCellMenu
          cell={cell}
          fieldId={fieldId}
          rowId={rowId}
          open={editing}
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </div>
  );
}
