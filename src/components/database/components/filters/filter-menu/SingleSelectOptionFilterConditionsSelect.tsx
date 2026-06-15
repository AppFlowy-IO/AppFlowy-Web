import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  SelectOptionFilter,
  SelectOptionFilterCondition,
} from '@/application/database-yjs';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';


function SingleSelectFilterConditionsSelect ({ filter }: { filter: SelectOptionFilter }) {
  const { t } = useTranslation();
  const conditions = useMemo(() => {
    return [
      {
        value: SelectOptionFilterCondition.OptionIs,
        text: t('grid.selectOptionFilter.is'),
      },
      {
        value: SelectOptionFilterCondition.OptionIsNot,
        text: t('grid.selectOptionFilter.isNot'),
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

  return (
    <FilterConditionsSelect
      filter={filter}
      conditions={conditions}
    />
  );
}

export default SingleSelectFilterConditionsSelect;