import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CheckboxFilter, CheckboxFilterCondition, useReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { useConditionsContext } from '../../conditions/context';

// Desktop parity: the checkbox editor has no condition dropdown — the body is
// the value list (Checked / Unchecked) and picking a value closes the popover.
function CheckboxFilterMenu({ filter }: { filter: CheckboxFilter }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const updateFilter = useUpdateFilter();
  const setOpenFilterId = useConditionsContext()?.setOpenFilterId;

  const conditions = useMemo(
    () => [
      {
        value: CheckboxFilterCondition.IsChecked,
        text: t('grid.checkboxFilter.isChecked'),
      },
      {
        value: CheckboxFilterCondition.IsUnChecked,
        text: t('grid.checkboxFilter.isUnchecked'),
      },
    ],
    [t]
  );

  return (
    <div className={'flex flex-col gap-1'} data-testid='checkbox-filter'>
      <FieldMenuTitle fieldId={filter.fieldId} filterId={filter.id} renderConditionSelect={null} />
      {conditions.map((condition) => (
        <div
          key={condition.value}
          data-testid={`filter-condition-${condition.value}`}
          data-checked={filter.condition === condition.value}
          className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
          onClick={(e) => {
            e.stopPropagation();
            if (readOnly) return;
            updateFilter({
              filterId: filter.id,
              fieldId: filter.fieldId,
              condition: condition.value,
            });
            setOpenFilterId?.(undefined);
          }}
        >
          {condition.text}
          {filter.condition === condition.value && <DropdownMenuItemTick />}
        </div>
      ))}
    </div>
  );
}

export default CheckboxFilterMenu;
