import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SelectOptionFilter } from '@/application/database-yjs';
import { singleSelectFilterConditions } from '@/components/database/components/filters/filter-conditions';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';

function SingleSelectFilterConditionsSelect({ filter }: { filter: SelectOptionFilter }) {
  const { t } = useTranslation();
  const conditions = useMemo(() => singleSelectFilterConditions(t), [t]);

  return <FilterConditionsSelect filter={filter} conditions={conditions} />;
}

export default SingleSelectFilterConditionsSelect;
