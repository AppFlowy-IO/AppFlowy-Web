import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  parseSelectOptionTypeOptions,
  SelectOptionFilter,
  SelectOptionFilterCondition,
} from '@/application/database-yjs';
import { YDatabaseField } from '@/application/types';


function SelectFilterContentOverview({ filter, field }: { filter: SelectOptionFilter; field: YDatabaseField }) {
  const typeOption = parseSelectOptionTypeOptions(field);
  const { t } = useTranslation();
  const value = useMemo(() => {
    if (!filter.optionIds?.length) return '';

    const options = filter.optionIds
      .map((optionId) => {
      const option = typeOption?.options?.find((option) => option?.id === optionId);

        return option?.name;
      })
      .filter(Boolean)
      .join(', ');

    switch (filter.condition) {
      case SelectOptionFilterCondition.OptionIsNot:
      case SelectOptionFilterCondition.OptionDoesNotContain:
        return `: ${t('grid.textFilter.choicechipPrefix.isNot')} ${options}`;
      case SelectOptionFilterCondition.OptionIsEmpty:
        return `: ${t('grid.textFilter.choicechipPrefix.isEmpty')}`;
      case SelectOptionFilterCondition.OptionIsNotEmpty:
        return `: ${t('grid.textFilter.choicechipPrefix.isNotEmpty')}`;
      case SelectOptionFilterCondition.OptionContains:
      case SelectOptionFilterCondition.OptionIs:
        return `: ${options}`;

      default:
        return '';
    }
  }, [filter.condition, filter.optionIds, t, typeOption?.options]);

  return <>{value}</>;
}

export default SelectFilterContentOverview;
