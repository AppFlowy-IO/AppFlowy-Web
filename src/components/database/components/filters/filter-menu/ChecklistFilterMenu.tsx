import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChecklistFilter, ChecklistFilterCondition, useReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { useConditionsContext } from '../../conditions/context';

// Desktop parity: like the checkbox editor, the checklist editor's body is the
// value list (Is complete / Is incomplete) and picking a value closes the popover.
function ChecklistFilterMenu({ filter }: { filter: ChecklistFilter }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const updateFilter = useUpdateFilter();
  const setOpenFilterId = useConditionsContext()?.setOpenFilterId;

  const conditions = useMemo(
    () => [
      {
        value: ChecklistFilterCondition.IsComplete,
        text: t('grid.checklistFilter.isComplete'),
      },
      {
        value: ChecklistFilterCondition.IsIncomplete,
        text: t('grid.checklistFilter.isIncomplted'),
      },
    ],
    [t]
  );

  return (
    <div className={'flex flex-col gap-1'} data-testid='checklist-filter'>
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

export default ChecklistFilterMenu;
