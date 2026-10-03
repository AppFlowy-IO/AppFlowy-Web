import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DateFilter,
  DateFilterCondition,
  FieldType,
  isRelativeDateCondition,
  isStartDateCondition,
  toEndDateCondition,
  toStartDateCondition,
  useFieldType,
} from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import { dateFilterConditions } from '@/components/database/components/filters/filter-conditions';
import DateTimeFilterDatePicker from '@/components/database/components/filters/filter-menu/DateTimeFilterDatePicker';
import DateTimeFilterStartEndDateSelect
  from '@/components/database/components/filters/filter-menu/DateTimeFilterStartEndDateSelect';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';

function DateTimeFilterMenu ({ filter }: { filter: DateFilter }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateFilter();
  const fieldType = useFieldType(filter.fieldId);

  // Derived from filter.condition so it stays in sync if the condition is changed
  // by Yjs sync (e.g., a collaborator editing the same filter).
  const selectedStart = isStartDateCondition(filter.condition);

  const conditions = useMemo(() => {
    // A row's created / last edited time is never empty.
    const isRowTime = fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime;

    return dateFilterConditions(t, { start: selectedStart, emptiness: !isRowTime });
  }, [fieldType, selectedStart, t]);

  const displayTextField =
    !isRelativeDateCondition(filter.condition) &&
    ![
      DateFilterCondition.DateEndIsEmpty,
      DateFilterCondition.DateEndIsNotEmpty,
      DateFilterCondition.DateStartIsEmpty,
      DateFilterCondition.DateStartIsNotEmpty,
    ].includes(filter.condition);

  const handleSelectStartOrEnd = useCallback(
    (isStart: boolean) => {
      if (isStart === isStartDateCondition(filter.condition)) return;

      const newCondition = isStart
        ? toStartDateCondition(filter.condition)
        : toEndDateCondition(filter.condition);

      if (newCondition !== filter.condition) {
        updateFilter({
          filterId: filter.id,
          fieldId: filter.fieldId,
          condition: newCondition,
        });
      }
    },
    [filter.condition, filter.id, filter.fieldId, updateFilter],
  );

  return (
    <div
      className={'flex flex-col gap-1'}
      data-testid="date-filter"
    >
      <FieldMenuTitle
        fieldId={filter.fieldId}
        filterId={filter.id}
        nameMaxWidthClassName={'max-w-[120px]'}
        renderConditionSelect={
          <>
            <DateTimeFilterStartEndDateSelect
              isStart={selectedStart}
              onSelect={handleSelectStartOrEnd}
            />
            <FilterConditionsSelect
              filter={filter}
              conditions={conditions}
            />
          </>
        }
      />
      {displayTextField && (
        <DateTimeFilterDatePicker filter={filter} />
      )}
    </div>
  );
}

export default DateTimeFilterMenu;
