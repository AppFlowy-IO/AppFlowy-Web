import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { useUpdateFilter } from '@/application/database-yjs/dispatch/sort-filter';
import { DateFilter, DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import {
  isRelativeDateComparison,
  isRelativeDateCondition,
  isStartDateCondition,
  toEndDateCondition,
  toStartDateCondition,
} from '@/application/database-yjs/fields/date/relativeDate';
import { useFieldType } from '@/application/database-yjs/selector';
import DateTimeFilterDatePicker from '@/components/database/components/filters/filter-menu/DateTimeFilterDatePicker';
import DateTimeFilterStartEndDateSelect
  from '@/components/database/components/filters/filter-menu/DateTimeFilterStartEndDateSelect';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { useRelativeDateFilterWrites } from '@/components/database/components/filters/hooks/useRelativeDateFilterWrites';

function DateTimeFilterMenu ({ filter }: { filter: DateFilter }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateFilter();
  const fieldType = useFieldType(filter.fieldId);
  const allowRelativeComparisons = useRelativeDateFilterWrites();
  const compatibilityReadOnly = !allowRelativeComparisons && isRelativeDateComparison(filter.condition, filter.content);

  // Derived from filter.condition so it stays in sync if the condition is changed
  // by Yjs sync (e.g., a collaborator editing the same filter).
  const selectedStart = isStartDateCondition(filter.condition);

  const conditions = useMemo(() => {
    const pick = (start: DateFilterCondition): DateFilterCondition =>
      selectedStart ? start : toEndDateCondition(start);
    const isRowTime = fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime;

    return [
      { value: pick(DateFilterCondition.DateStartsOn), text: t('grid.dateFilter.is') },
      { value: pick(DateFilterCondition.DateStartsBefore), text: t('grid.dateFilter.before') },
      { value: pick(DateFilterCondition.DateStartsAfter), text: t('grid.dateFilter.after') },
      { value: pick(DateFilterCondition.DateStartsOnOrBefore), text: t('grid.dateFilter.onOrBefore') },
      { value: pick(DateFilterCondition.DateStartsOnOrAfter), text: t('grid.dateFilter.onOrAfter') },
      { value: pick(DateFilterCondition.DateStartsBetween), text: t('grid.dateFilter.between') },
      { value: pick(DateFilterCondition.DateStartIsEmpty), text: t('grid.dateFilter.empty'), hidden: isRowTime },
      { value: pick(DateFilterCondition.DateStartIsNotEmpty), text: t('grid.dateFilter.notEmpty'), hidden: isRowTime },
      { value: pick(DateFilterCondition.DateStartsToday), text: t('relativeDates.today') },
      { value: pick(DateFilterCondition.DateStartsYesterday), text: t('relativeDates.yesterday') },
      { value: pick(DateFilterCondition.DateStartsTomorrow), text: t('relativeDates.tomorrow') },
      { value: pick(DateFilterCondition.DateStartsThisWeek), text: t('relativeDates.thisWeek') },
      { value: pick(DateFilterCondition.DateStartsLastWeek), text: t('relativeDates.lastWeek') },
      { value: pick(DateFilterCondition.DateStartsNextWeek), text: t('relativeDates.nextWeek') },
    ]
      .filter((condition) => !condition.hidden)
      .map(({ value, text }) => ({ value, text }));
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
      if (compatibilityReadOnly || isStart === isStartDateCondition(filter.condition)) return;

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
    [compatibilityReadOnly, filter.condition, filter.id, filter.fieldId, updateFilter],
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
              disabled={compatibilityReadOnly}
              isStart={selectedStart}
              onSelect={handleSelectStartOrEnd}
            />
            <FilterConditionsSelect
              disabled={compatibilityReadOnly}
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
