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
import { useRemoveFilter, useUpdateFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import DateTimeFilterDatePicker from '@/components/database/components/filters/filter-menu/DateTimeFilterDatePicker';
import DateTimeFilterStartEndDateSelect
  from '@/components/database/components/filters/filter-menu/DateTimeFilterStartEndDateSelect';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function TextFilterMenu ({ filter }: { filter: DateFilter }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateFilter();
  const fieldType = useFieldType(filter.fieldId);

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
      { value: pick(DateFilterCondition.DateStartsToday), text: t('relativeDates.today') },
      { value: pick(DateFilterCondition.DateStartsYesterday), text: t('relativeDates.yesterday') },
      { value: pick(DateFilterCondition.DateStartsTomorrow), text: t('relativeDates.tomorrow') },
      { value: pick(DateFilterCondition.DateStartsThisWeek), text: t('relativeDates.thisWeek') },
      { value: pick(DateFilterCondition.DateStartsLastWeek), text: t('relativeDates.lastWeek') },
      { value: pick(DateFilterCondition.DateStartsNextWeek), text: t('relativeDates.nextWeek') },
      !isRowTime && { value: pick(DateFilterCondition.DateStartIsEmpty), text: t('grid.dateFilter.empty') },
      !isRowTime && { value: pick(DateFilterCondition.DateStartIsNotEmpty), text: t('grid.dateFilter.notEmpty') },
    ].filter(Boolean) as { value: DateFilterCondition; text: string }[];
  }, [fieldType, selectedStart, t]);

  const displayTextField =
    !isRelativeDateCondition(filter.condition) &&
    ![
      DateFilterCondition.DateEndIsEmpty,
      DateFilterCondition.DateEndIsNotEmpty,
      DateFilterCondition.DateStartIsEmpty,
      DateFilterCondition.DateStartIsNotEmpty,
    ].includes(filter.condition);

  const deleteFilter = useRemoveFilter();

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
      className={'flex flex-col gap-2'}
      data-testid="date-filter"
    >
      <div className={'flex text-text-primary text-sm items-center justify-between gap-2'}>
        {fieldType === FieldType.CreatedTime ? t('grid.field.createdAtFieldName') : fieldType === FieldType.LastEditedTime ? t('grid.field.updatedAtFieldName') :
          <DateTimeFilterStartEndDateSelect
            isStart={selectedStart}
            onSelect={handleSelectStartOrEnd}
          />}

        <div className={'flex flex-1 items-center justify-end'}>
          <FilterConditionsSelect
            filter={filter}
            conditions={conditions}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size={'icon-sm'}
              onClick={(e) => {
                e.stopPropagation();
                deleteFilter(filter.id);
              }}
              variant={'ghost'}
              danger
              data-testid="delete-filter-button"
            >
              <DeleteIcon className={'w-5 h-5'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('grid.settings.deleteFilter')}
          </TooltipContent>
        </Tooltip>
      </div>
      {displayTextField && (
        <DateTimeFilterDatePicker filter={filter} />
      )}
    </div>
  );
}

export default TextFilterMenu;
