import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { TextFilter } from '@/application/database-yjs/fields/text/text.type';
import { textFilterConditions } from '@/components/database/components/filters/filter-conditions';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';

function TextFilterConditionsSelect({
  filter,
  onSelect,
}: {
  filter: TextFilter;
  onSelect?: (condition: number) => void;
}) {
  const { t } = useTranslation();
  const conditions = useMemo(() => textFilterConditions(t), [t]);

  return <FilterConditionsSelect filter={filter} conditions={conditions} onSelect={onSelect} />;
}

export default TextFilterConditionsSelect;
