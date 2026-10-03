import { useCallback, useMemo } from 'react';

import {
  parseSelectOptionTypeOptions,
  SelectOptionFilter,
  SelectOptionFilterCondition,
  useFieldSelector,
  useConditionsReadOnly,
} from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import ClearSelectionItem from '@/components/database/components/filters/filter-menu/ClearSelectionItem';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import { SelectOptionList } from '@/components/database/components/filters/filter-menu/SelectOptionList';
import SingleSelectFilterConditionsSelect from '@/components/database/components/filters/filter-menu/SingleSelectOptionFilterConditionsSelect';
import { toggleSelectOptionContent } from '@/components/database/components/filters/value-controls/filter-value';

function SingleSelectOptionFilterMenu({ filter }: { filter: SelectOptionFilter }) {
  const readOnly = useConditionsReadOnly();
  const { field } = useFieldSelector(filter.fieldId);
  const displaySelectOptionList = useMemo(() => {
    return ![SelectOptionFilterCondition.OptionIsEmpty, SelectOptionFilterCondition.OptionIsNotEmpty].includes(
      filter.condition
    );
  }, [filter.condition]);

  const updateFilter = useUpdateFilter();
  const handleToggleSelectOption = useCallback(
    (id: string) => {
      if (readOnly) return;
      // Desktop parity: persist the selection in field option order.
      const typeOption = field ? parseSelectOptionTypeOptions(field) : null;

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: toggleSelectOptionContent(filter.optionIds, id, typeOption?.options),
      });
    },
    [field, filter, readOnly, updateFilter]
  );

  const handleClearSelection = useCallback(() => {
    updateFilter({
      filterId: filter.id,
      fieldId: filter.fieldId,
      content: '',
    });
  }, [filter.fieldId, filter.id, updateFilter]);

  return (
    <div className={'flex flex-col gap-1'}>
      <FieldMenuTitle
        fieldId={filter.fieldId}
        filterId={filter.id}
        renderConditionSelect={<SingleSelectFilterConditionsSelect filter={filter} />}
      />
      {displaySelectOptionList && (
        <>
          <SelectOptionList
            fieldId={filter.fieldId}
            selectedIds={filter.optionIds}
            onSelect={handleToggleSelectOption}
          />
          {filter.optionIds.length > 0 && <ClearSelectionItem onClear={handleClearSelection} />}
        </>
      )}
    </div>
  );
}

export default SingleSelectOptionFilterMenu;
