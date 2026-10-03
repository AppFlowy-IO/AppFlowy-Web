import { useCallback, useMemo } from 'react';

import { TextFilter, TextFilterCondition, useConditionsReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import TextFilterConditionsSelect from '@/components/database/components/filters/filter-menu/TextFilterConditionsSelect';
import { FilterTextValueInput } from '@/components/database/components/filters/value-controls/FilterTextValueInput';

function TextFilterMenu({ filter }: { filter: TextFilter }) {
  const readOnly = useConditionsReadOnly();
  const updateFilter = useUpdateFilter();
  const updateContent = useCallback(
    (content: string) => updateFilter({ filterId: filter.id, fieldId: filter.fieldId, content }),
    [filter.fieldId, filter.id, updateFilter]
  );

  const displayTextField = useMemo(() => {
    return ![TextFilterCondition.TextIsEmpty, TextFilterCondition.TextIsNotEmpty].includes(filter.condition);
  }, [filter.condition]);

  return (
    <div className={'flex flex-col gap-1'} data-testid='text-filter'>
      <FieldMenuTitle
        filterId={filter.id}
        fieldId={filter.fieldId}
        renderConditionSelect={<TextFilterConditionsSelect filter={filter} />}
      />
      {displayTextField && (
        <FilterTextValueInput
          autoFocus
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

export default TextFilterMenu;
