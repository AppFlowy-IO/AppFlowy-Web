import { useCallback } from 'react';

import { FieldType, NumberFilter, TextFilter, useFieldSelector } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import NumberFilterMenu from '@/components/database/components/filters/filter-menu/NumberFilterMenu';
import TextFilterConditionsSelect from '@/components/database/components/filters/filter-menu/TextFilterConditionsSelect';
import TextFilterMenu from '@/components/database/components/filters/filter-menu/TextFilterMenu';
import { useRollupData } from '@/components/database/components/property/rollup/useRollupData';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function RollupFilterMenu({ filter }: { filter: TextFilter | NumberFilter }) {
  const { field } = useFieldSelector(filter.fieldId);
  const { targetField, selectOptions } = useRollupData(filter.fieldId);

  if (isNumericRollupField(field)) {
    return <NumberFilterMenu filter={filter as NumberFilter} />;
  }

  const isSelectTarget =
    targetField?.type === FieldType.SingleSelect || targetField?.type === FieldType.MultiSelect;

  if (isSelectTarget && selectOptions.length > 0) {
    return <RollupSelectOptionFilter filter={filter as TextFilter} options={selectOptions} />;
  }

  return <TextFilterMenu filter={filter as TextFilter} />;
}

function RollupSelectOptionFilter({ filter, options }: { filter: TextFilter; options: SelectOption[] }) {
  const updateFilter = useUpdateFilter();

  const handleToggleOption = useCallback(
    (optionName: string) => {
      // Mirrors desktop: clicking the selected option clears the filter content,
      // clicking a different option replaces it. Single-selection only.
      const next = filter.content === optionName ? '' : optionName;

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: next,
      });
    },
    [filter.content, filter.id, filter.fieldId, updateFilter],
  );

  return (
    <div className={'flex flex-col'}>
      <FieldMenuTitle
        filterId={filter.id}
        fieldId={filter.fieldId}
        renderConditionSelect={<TextFilterConditionsSelect filter={filter} />}
      />
      <div className={'flex flex-col'}>
        {options
          .filter((option) => Boolean(option && option.id))
          .map((option) => {
            const isSelected = filter.content === option.name;

            return (
              <div
                key={option.id}
                data-testid={'rollup-filter-option'}
                data-checked={isSelected}
                className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleOption(option.name);
                }}
              >
                <Tag
                  label={option.name}
                  textColor={SelectOptionFgColorMap[option.color]}
                  bgColor={SelectOptionColorMap[option.color]}
                />
                {isSelected && <DropdownMenuItemTick />}
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default RollupFilterMenu;
