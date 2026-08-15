import { useCallback } from 'react';

import { parseSelectOptionTypeOptions, SelectOption, useFieldSelector } from '@/application/database-yjs';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function SelectOptionList({
  fieldId,
  selectedIds,
  onSelect,
  showTooltips = false,
}: {
  fieldId: string;
  selectedIds: string[];
  onSelect: (optionId: string) => void;
  /** Desktop parity: the advanced panel shows the full option name in a tooltip above the tag. */
  showTooltips?: boolean;
}) {
  const { field } = useFieldSelector(fieldId);
  // Not memoized: `field` is a Yjs map with a stable identity that mutates in
  // place, so a [field]-keyed memo would serve stale options after edits.
  const typeOption = field ? parseSelectOptionTypeOptions(field) : null;

  const renderOption = useCallback(
    (option: SelectOption) => {
      const isSelected = selectedIds.includes(option.id);
      const tag = (
        <Tag
          label={option.name}
          textColor={SelectOptionFgColorMap[option.color]}
          bgColor={SelectOptionColorMap[option.color]}
        />
      );

      return (
        <div
          key={option.id}
          data-testid={'select-option-list'}
          data-checked={isSelected}
          className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(option.id);
          }}
        >
          {showTooltips ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='min-w-0 truncate'>{tag}</span>
              </TooltipTrigger>
              <TooltipContent side='top'>{option.name}</TooltipContent>
            </Tooltip>
          ) : (
            tag
          )}
          {isSelected && <DropdownMenuItemTick />}
        </div>
      );
    },
    [onSelect, selectedIds, showTooltips]
  );

  if (!field || !typeOption) return null;
  const normalizedOptions = typeOption.options.filter((option) => {
    return Boolean(option && option.id);
  });

  return <div className={'appflowy-scroller flex max-h-[300px] flex-col overflow-y-auto'}>{normalizedOptions.map(renderOption)}</div>;
}
