import { TextFilter, TextFilterCondition, useReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import TextFilterConditionsSelect
  from '@/components/database/components/filters/filter-menu/TextFilterConditionsSelect';
import { Input } from '@/components/ui/input';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

function TextFilterMenu ({ filter }: { filter: TextFilter }) {
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

  const displayTextField = useMemo(() => {
    return ![TextFilterCondition.TextIsEmpty, TextFilterCondition.TextIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  return (
    <div
      className={'flex flex-col gap-2'}
      data-testid="text-filter"
    >

      <FieldMenuTitle
        filterId={filter.id}
        fieldId={filter.fieldId}
        renderConditionSelect={<TextFilterConditionsSelect filter={filter} />}
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

export default TextFilterMenu;
