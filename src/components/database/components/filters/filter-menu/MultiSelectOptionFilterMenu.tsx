import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  parseSelectOptionTypeOptions,
  SelectOptionFilter,
  SelectOptionFilterCondition,
  useFieldSelector,
  useReadOnly,
} from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import ClearSelectionItem from '@/components/database/components/filters/filter-menu/ClearSelectionItem';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { SelectOptionList } from '@/components/database/components/filters/filter-menu/SelectOptionList';

import FieldMenuTitle from './FieldMenuTitle';

function MultiSelectOptionFilterMenu({ filter }: { filter: SelectOptionFilter }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const { field } = useFieldSelector(filter.fieldId);
  const conditions = useMemo(() => {
    return [
      {
        value: SelectOptionFilterCondition.OptionContains,
        text: t('grid.selectOptionFilter.contains'),
      },
      {
        value: SelectOptionFilterCondition.OptionDoesNotContain,
        text: t('grid.selectOptionFilter.doesNotContain'),
      },
      {
        value: SelectOptionFilterCondition.OptionIsEmpty,
        text: t('grid.selectOptionFilter.isEmpty'),
      },
      {
        value: SelectOptionFilterCondition.OptionIsNotEmpty,
        text: t('grid.selectOptionFilter.isNotEmpty'),
      },
    ];
  }, [t]);

  const displaySelectOptionList = useMemo(() => {
    return ![SelectOptionFilterCondition.OptionIsEmpty, SelectOptionFilterCondition.OptionIsNotEmpty].includes(
      filter.condition
    );
  }, [filter.condition]);

  const updateFilter = useUpdateFilter();
  const handleToggleSelectOption = useCallback(
    (id: string) => {
      if (readOnly) return;
      const selectedIds = new Set(filter.optionIds);

      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }

      // Desktop parity: persist the selection in field option order.
      const typeOption = field ? parseSelectOptionTypeOptions(field) : null;
      const orderedIds = typeOption
        ? typeOption.options.filter((option) => option && selectedIds.has(option.id)).map((option) => option.id)
        : [...selectedIds];

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: orderedIds.filter((id) => id !== '').join(','),
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
        renderConditionSelect={<FilterConditionsSelect filter={filter} conditions={conditions} />}
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

export default MultiSelectOptionFilterMenu;
