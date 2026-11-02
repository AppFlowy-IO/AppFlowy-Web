import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { NumberFilter, NumberFilterCondition, useConditionsReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import { numberFilterConditions } from '@/components/database/components/filters/filter-conditions';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { numberConditionShortName } from '@/components/database/components/filters/overview/useFilterChipLabel';
import { FilterTextValueInput } from '@/components/database/components/filters/value-controls/FilterTextValueInput';

function NumberFilterMenu({
  filter,
  conditionLabelStyle = 'words',
}: {
  filter: NumberFilter;
  /**
   * 'words' renders "Equals" / "Is less than"… (standalone Number filters);
   * 'symbols' renders "=" / "<" / "≤"… (rollup→Number filters, per desktop).
   */
  conditionLabelStyle?: 'words' | 'symbols';
}) {
  const { t } = useTranslation();
  const readOnly = useConditionsReadOnly();
  const updateFilter = useUpdateFilter();
  const updateContent = useCallback(
    (content: string) => updateFilter({ filterId: filter.id, fieldId: filter.fieldId, content }),
    [filter.fieldId, filter.id, updateFilter]
  );

  const conditions = useMemo(() => {
    const conditions = numberFilterConditions(t);

    return conditionLabelStyle === 'symbols'
      ? conditions.map(({ value }) => ({ value, text: numberConditionShortName(value, t) }))
      : conditions;
  }, [conditionLabelStyle, t]);

  const displayTextField = useMemo(() => {
    return ![NumberFilterCondition.NumberIsEmpty, NumberFilterCondition.NumberIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  return (
    <div className={'flex flex-col gap-1'}>
      <FieldMenuTitle
        fieldId={filter.fieldId}
        filterId={filter.id}
        renderConditionSelect={<FilterConditionsSelect filter={filter} conditions={conditions} />}
      />
      {displayTextField && (
        <FilterTextValueInput
          autoFocus
          numeric
          data-testid='text-filter-input'
          disabled={readOnly}
          filterId={filter.id}
          fieldId={filter.fieldId}
          content={filter.content}
          onChange={updateContent}
        />
      )}
    </div>
  );
}

export default NumberFilterMenu;
