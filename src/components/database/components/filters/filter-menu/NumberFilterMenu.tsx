import { NumberFilter, NumberFilterCondition, useReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { Input } from '@/components/ui/input';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

function NumberFilterMenu ({ filter }: { filter: NumberFilter }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const updateFilter = useUpdateFilter();
  const [value, setValue] = useState<string>(filter.content);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    updateFilter({
      filterId: filter.id,
      content: e.target.value,
    });
  };

  const conditions = useMemo(() => {
    return [
      {
        value: NumberFilterCondition.Equal,
        text: t('grid.numberFilter.equal'),
      },
      {
        value: NumberFilterCondition.NotEqual,
        text: t('grid.numberFilter.notEqual'),
      },
      {
        value: NumberFilterCondition.GreaterThan,
        text: t('grid.numberFilter.greaterThan'),
      },
      {
        value: NumberFilterCondition.LessThan,
        text: t('grid.numberFilter.lessThan'),
      },
      {
        value: NumberFilterCondition.GreaterThanOrEqualTo,
        text: t('grid.numberFilter.greaterThanOrEqualTo'),
      },
      {
        value: NumberFilterCondition.LessThanOrEqualTo,
        text: t('grid.numberFilter.lessThanOrEqualTo'),
      },
      {
        value: NumberFilterCondition.NumberIsEmpty,
        text: t('grid.textFilter.isEmpty'),
      },
      {
        value: NumberFilterCondition.NumberIsNotEmpty,
        text: t('grid.textFilter.isNotEmpty'),
      },
    ];
  }, [t]);
  
  const displayTextField = useMemo(() => {
    return ![NumberFilterCondition.NumberIsEmpty, NumberFilterCondition.NumberIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  return (
    <div className={'flex flex-col gap-2 p-2'}>
      <FieldMenuTitle
        fieldId={filter.fieldId}
        filterId={filter.id}
        renderConditionSelect={<FilterConditionsSelect
          filter={filter}
          conditions={conditions}
        />}
      />
      {displayTextField && (
        <Input
          autoFocus
          data-testid="text-filter-input"
          disabled={readOnly}
          spellCheck={false}
          size={'sm'}
          value={value}
          onChange={handleChange}
          placeholder={t('grid.settings.typeAValue')}
        />
      )}
    </div>
  );
}

export default NumberFilterMenu;
