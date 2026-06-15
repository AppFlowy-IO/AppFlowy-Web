import { useCallback, useMemo } from 'react';

import { SelectOptionFilter, SelectOptionFilterCondition } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import { SelectOptionList } from '@/components/database/components/filters/filter-menu/SelectOptionList';
import SingleSelectFilterConditionsSelect from '@/components/database/components/filters/filter-menu/SingleSelectOptionFilterConditionsSelect';

function SingleSelectOptionFilterMenu({ filter }: { filter: SelectOptionFilter }) {
  const displaySelectOptionList = useMemo(() => {
    return ![SelectOptionFilterCondition.OptionIsEmpty, SelectOptionFilterCondition.OptionIsNotEmpty].includes(
      filter.condition
    );
  }, [filter.condition]);

  const updateFilter = useUpdateFilter();
  const handleToggleSelectOption = useCallback(
    (id: string) => {
      const selectedIds = filter.optionIds;
      const newSelectedIds = selectedIds.slice();
      const index = newSelectedIds.indexOf(id);

      if (index > -1) {
        newSelectedIds.splice(index, 1);
      } else {
        newSelectedIds.push(id);
      }

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: newSelectedIds.filter((id) => id !== '').join(','),
      });
    },
    [filter, updateFilter]
  );

  return (
    <div className={'flex flex-col'}>
      <FieldMenuTitle
        fieldId={filter.fieldId}
        filterId={filter.id}
        renderConditionSelect={<SingleSelectFilterConditionsSelect filter={filter} />}
      />
      {displaySelectOptionList && (
        <SelectOptionList fieldId={filter.fieldId} selectedIds={filter.optionIds} onSelect={handleToggleSelectOption} />
      )}
    </div>
  );
}

export default SingleSelectOptionFilterMenu;
