import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChecklistFilter, ChecklistFilterCondition } from '@/application/database-yjs';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';

function ChecklistFilterMenu ({ filter }: { filter: ChecklistFilter }) {
  const { t } = useTranslation();

  const conditions = useMemo(
    () => [
      {
        value: ChecklistFilterCondition.IsComplete,
        text: t('grid.checklistFilter.isComplete'),
      },
      {
        value: ChecklistFilterCondition.IsIncomplete,
        text: t('grid.checklistFilter.isIncomplted'),
      },
    ],
    [t],
  );

  return <FieldMenuTitle
    fieldId={filter.fieldId}
    filterId={filter.id}
    renderConditionSelect={<FilterConditionsSelect
      filter={filter}
      conditions={conditions}
    />}
  />;
}

export default ChecklistFilterMenu;
