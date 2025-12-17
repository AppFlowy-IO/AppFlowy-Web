import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SelectOptionFilter, SelectOptionFilterCondition } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { SelectOptionList } from '@/components/database/components/filters/filter-menu/SelectOptionList';

import FieldMenuTitle from './FieldMenuTitle';

function MultiSelectOptionFilterMenu({ filter }: { filter: SelectOptionFilter }) {
  const { t } = useTranslation();
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
        renderConditionSelect={<FilterConditionsSelect filter={filter} conditions={conditions} />}
      />
      {displaySelectOptionList && (
        <SelectOptionList fieldId={filter.fieldId} selectedIds={filter.optionIds} onSelect={handleToggleSelectOption} />
      )}
    </div>
  );
}

export default MultiSelectOptionFilterMenu;
