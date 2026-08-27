import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { NumberFilter, NumberFilterCondition, useReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { useDebouncedFilterInput } from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { numberConditionShortName } from '@/components/database/components/filters/overview/useFilterChipLabel';
import { Input } from '@/components/ui/input';

// Desktop parity: `_NumberFilterTextFormatter` — reject any edit that doesn't
// match an optional minus, digits, at most one decimal point.
const NUMBER_INPUT_PATTERN = /^-?\d*\.?\d*$/;

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
  const readOnly = useReadOnly();
  const updateFilter = useUpdateFilter();
  const { value, updateValue } = useDebouncedFilterInput({
    content: filter.content,
    filterId: filter.id,
    fieldId: filter.fieldId,
    updateFilter,
  });
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;

      // Keep the previous value when the edit doesn't match the numeric pattern.
      if (next !== '' && !NUMBER_INPUT_PATTERN.test(next)) return;
      updateValue(next);
    },
    [updateValue]
  );

  const conditions = useMemo(() => {
    const wordLabels: Record<number, string> = {
      [NumberFilterCondition.Equal]: t('grid.numberFilter.equal'),
      [NumberFilterCondition.NotEqual]: t('grid.numberFilter.notEqual'),
      [NumberFilterCondition.LessThan]: t('grid.numberFilter.lessThan'),
      [NumberFilterCondition.LessThanOrEqualTo]: t('grid.numberFilter.lessThanOrEqualTo'),
      [NumberFilterCondition.GreaterThan]: t('grid.numberFilter.greaterThan'),
      [NumberFilterCondition.GreaterThanOrEqualTo]: t('grid.numberFilter.greaterThanOrEqualTo'),
      [NumberFilterCondition.NumberIsEmpty]: t('grid.numberFilter.isEmpty'),
      [NumberFilterCondition.NumberIsNotEmpty]: t('grid.numberFilter.isNotEmpty'),
    };

    // Desktop order: protobuf ordinal order (=, ≠, <, ≤, >, ≥, empty, not empty).
    const values = [
      NumberFilterCondition.Equal,
      NumberFilterCondition.NotEqual,
      NumberFilterCondition.LessThan,
      NumberFilterCondition.LessThanOrEqualTo,
      NumberFilterCondition.GreaterThan,
      NumberFilterCondition.GreaterThanOrEqualTo,
      NumberFilterCondition.NumberIsEmpty,
      NumberFilterCondition.NumberIsNotEmpty,
    ];

    return values.map((value) => ({
      value,
      text: conditionLabelStyle === 'symbols' ? numberConditionShortName(value, t) : wordLabels[value],
    }));
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
        <Input
          autoFocus
          data-testid='text-filter-input'
          disabled={readOnly}
          spellCheck={false}
          size={'sm'}
          inputMode={'decimal'}
          value={value}
          onChange={handleChange}
          placeholder={t('grid.settings.typeAValue')}
        />
      )}
    </div>
  );
}

export default NumberFilterMenu;
