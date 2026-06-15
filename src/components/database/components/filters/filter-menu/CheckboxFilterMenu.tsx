import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CheckboxFilter, CheckboxFilterCondition } from '@/application/database-yjs';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';

function CheckboxFilterMenu ({ filter }: { filter: CheckboxFilter }) {
  const { t } = useTranslation();

  const conditions = useMemo(
    () => [
      {
        value: CheckboxFilterCondition.IsChecked,
        text: t('grid.checkboxFilter.isChecked'),
      },
      {
        value: CheckboxFilterCondition.IsUnChecked,
        text: t('grid.checkboxFilter.isUnchecked'),
      },
    ],
    [t],
  );

  return (
    <FieldMenuTitle
      fieldId={filter.fieldId}
      filterId={filter.id}
      renderConditionSelect={<FilterConditionsSelect
        filter={filter}
        conditions={conditions}
      />}
    />
  );
}

export default CheckboxFilterMenu;
