import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConditionsReadOnly } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import { PersonFilter, PersonFilterCondition } from '@/application/database-yjs/fields/person/person.type';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YjsDatabaseKey } from '@/application/types';
import { personFilterConditions } from '@/components/database/components/filters/filter-conditions';
import ClearSelectionItem from '@/components/database/components/filters/filter-menu/ClearSelectionItem';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { togglePersonContent } from '@/components/database/components/filters/value-controls/filter-value';
import { PersonFilterList } from '@/components/database/components/filters/value-controls/PersonFilterList';

const EMPTY_USER_IDS: readonly string[] = [];

function PersonFilterMenu({ filter }: { filter: PersonFilter }) {
  const { t } = useTranslation();
  const readOnly = useConditionsReadOnly();
  const updateFilter = useUpdateFilter();
  const { field } = useFieldSelector(filter.fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const conditions = useMemo(() => personFilterConditions(t), [t]);

  // The picker (and its member request) is skipped when the condition needs no value.
  const showPicker =
    filter.condition !== PersonFilterCondition.PersonIsEmpty &&
    filter.condition !== PersonFilterCondition.PersonIsNotEmpty;

  const selectedUserIds = filter.userIds ?? EMPTY_USER_IDS;

  const handleToggleUser = useCallback(
    (userId: string) => {
      if (readOnly) return;
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: togglePersonContent(selectedUserIds, userId),
      });
    },
    [filter.id, filter.fieldId, readOnly, selectedUserIds, updateFilter]
  );

  const handleClearSelection = useCallback(() => {
    updateFilter({
      filterId: filter.id,
      fieldId: filter.fieldId,
      content: JSON.stringify([]),
    });
  }, [filter.fieldId, filter.id, updateFilter]);

  return (
    <div className={'flex flex-col gap-1'} data-testid='person-filter'>
      <FieldMenuTitle
        fieldId={filter.fieldId}
        filterId={filter.id}
        renderConditionSelect={<FilterConditionsSelect filter={filter} conditions={conditions} />}
      />
      {showPicker && (
        <>
          <PersonFilterList fieldType={fieldType} selectedIds={selectedUserIds} onToggle={handleToggleUser} />
          {selectedUserIds.length > 0 && <ClearSelectionItem onClear={handleClearSelection} />}
        </>
      )}
    </div>
  );
}

export default PersonFilterMenu;
