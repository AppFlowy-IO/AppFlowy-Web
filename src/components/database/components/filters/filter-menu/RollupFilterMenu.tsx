import { useCallback } from 'react';

import { useReadOnly } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useUpdateAdvancedFilter, UpdateFilterParams } from '@/application/database-yjs/dispatch/sort-filter';
import { NumberFilter } from '@/application/database-yjs/fields/number/number.type';
import { RollupFilterMetadata } from '@/application/database-yjs/fields/rollup/rollup.type';
import { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilter } from '@/application/database-yjs/fields/text/text.type';
import { newRollupFilterMetadata, rollupPredicateType } from '@/application/database-yjs/rollup/filter';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import TextFilterConditionsSelect from '@/components/database/components/filters/filter-menu/TextFilterConditionsSelect';
import { useRollupData } from '@/components/database/components/property/rollup/useRollupData';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import RollupFilterControls from './RollupFilterControls';

function RollupFilterMenu({ filter }: { filter: TextFilter | NumberFilter }) {
  return filter.rollupMetadata ? <RollupFilterMenuBody filter={filter} /> : <LegacyRollupFilterMenu filter={filter} />;
}

function RollupFilterMenuBody({ filter }: { filter: TextFilter | NumberFilter }) {
  return (
    <div className='flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2 p-2'>
      <FieldMenuTitle filterId={filter.id} fieldId={filter.fieldId} renderConditionSelect={null} />
      <RollupFilterControls filter={filter} />
    </div>
  );
}

function LegacyRollupFilterMenu({ filter }: { filter: TextFilter | NumberFilter }) {
  const { field } = useFieldSelector(filter.fieldId);
  const { targetField, selectOptions } = useRollupData(filter.fieldId);

  const isSelectTarget = targetField?.type === FieldType.SingleSelect || targetField?.type === FieldType.MultiSelect;

  if (rollupPredicateType(filter, field) === FieldType.RichText && isSelectTarget && selectOptions.length > 0) {
    return (
      <RollupSelectOptionFilter
        filter={filter as TextFilter}
        options={selectOptions}
        expectedMetadata={field ? newRollupFilterMetadata(field, targetField?.type) : undefined}
      />
    );
  }

  return <RollupFilterMenuBody filter={filter} />;
}

function RollupSelectOptionFilter({
  filter,
  options,
  expectedMetadata,
}: {
  filter: TextFilter;
  options: SelectOption[];
  expectedMetadata?: RollupFilterMetadata;
}) {
  const updateFilter = useUpdateAdvancedFilter();
  const readOnly = useReadOnly();
  const update = useCallback(
    (params: UpdateFilterParams) => {
      if (readOnly) return;
      updateFilter({ ...params, expectedRollupMetadata: expectedMetadata });
    },
    [expectedMetadata, readOnly, updateFilter]
  );

  const handleToggleOption = useCallback(
    (optionName: string) => {
      if (readOnly) return;
      // Mirrors desktop: clicking the selected option clears the filter content,
      // clicking a different option replaces it. Single-selection only.
      const next = filter.content === optionName ? '' : optionName;

      update({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: next,
      });
    },
    [filter.content, filter.id, filter.fieldId, readOnly, update]
  );

  return (
    <div className={'flex flex-col'}>
      <FieldMenuTitle
        filterId={filter.id}
        fieldId={filter.fieldId}
        renderConditionSelect={
          <TextFilterConditionsSelect
            filter={filter}
            onSelect={(condition) => update({ filterId: filter.id, fieldId: filter.fieldId, condition })}
          />
        }
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
