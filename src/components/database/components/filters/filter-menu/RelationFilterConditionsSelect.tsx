import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Filter, RelationFilterCondition } from '@/application/database-yjs';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';

function RelationFilterConditionsSelect({ filter }: { filter: Filter }) {
  const { t } = useTranslation();

  const conditions = useMemo(
    () => [
      {
        value: RelationFilterCondition.RelationContains,
        text: t('grid.personFilter.contains'),
      },
      {
        value: RelationFilterCondition.RelationDoesNotContain,
        text: t('grid.personFilter.doesNotContain'),
      },
      {
        value: RelationFilterCondition.RelationIsEmpty,
        text: t('grid.personFilter.isEmpty'),
      },
      {
        value: RelationFilterCondition.RelationIsNotEmpty,
        text: t('grid.personFilter.isNotEmpty'),
      },
    ],
    [t]
  );

  return <FilterConditionsSelect filter={filter} conditions={conditions} />;
}

export default RelationFilterConditionsSelect;
