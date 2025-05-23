import { parseSelectOptionTypeOptions, SelectOption, useFieldSelector } from '@/application/database-yjs';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap } from '@/components/database/components/cell/cell.const';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import React, { useCallback, useMemo } from 'react';

export function SelectOptionList ({ fieldId, selectedIds, onSelect }: {
  fieldId: string;
  selectedIds: string[];
  onSelect: (optionId: string) => void;
}) {
  const { field } = useFieldSelector(fieldId);
  const typeOption = useMemo(() => {
    if (!field) return null;
    return parseSelectOptionTypeOptions(field);
  }, [field]);

  const renderOption = useCallback(
    (option: SelectOption) => {
      const isSelected = selectedIds.includes(option.id);

      return (
        <div
          key={option.id}
          data-testid={'select-option-list'}
          data-checked={isSelected}
          className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
          onClick={e => {
            e.stopPropagation();
            onSelect(option.id);
          }}
        >
          <Tag
            label={option.name}
            color={SelectOptionColorMap[option.color]}
          />
          {isSelected && <DropdownMenuItemTick />}
        </div>
      );
    },
    [onSelect, selectedIds],
  );

  if (!field || !typeOption) return null;
  return <div className={'flex flex-col'}>{typeOption.options.map(renderOption)}</div>;
}
