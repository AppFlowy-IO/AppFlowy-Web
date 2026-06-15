import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { TextFilter, TextFilterCondition } from '@/application/database-yjs';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';


function TextFilterConditionsSelect ({ filter }: { filter: TextFilter }) {
  const { t } = useTranslation();

  const conditions = useMemo(() => {
    return [
      {
        value: TextFilterCondition.TextContains,
        text: t('grid.textFilter.contains'),
      },
      {
        value: TextFilterCondition.TextDoesNotContain,
        text: t('grid.textFilter.doesNotContain'),
      },
      {
        value: TextFilterCondition.TextStartsWith,
        text: t('grid.textFilter.startWith'),
      },
      {
        value: TextFilterCondition.TextEndsWith,
        text: t('grid.textFilter.endsWith'),
      },
      {
        value: TextFilterCondition.TextIs,
        text: t('grid.textFilter.is'),
      },
      {
        value: TextFilterCondition.TextIsNot,
        text: t('grid.textFilter.isNot'),
      },
      {
        value: TextFilterCondition.TextIsEmpty,
        text: t('grid.textFilter.isEmpty'),
      },
      {
        value: TextFilterCondition.TextIsNotEmpty,
        text: t('grid.textFilter.isNotEmpty'),
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

export default TextFilterConditionsSelect;