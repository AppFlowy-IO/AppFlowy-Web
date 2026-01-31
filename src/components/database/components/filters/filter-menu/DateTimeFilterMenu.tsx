import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DateFilter, DateFilterCondition, FieldType, useFieldType } from '@/application/database-yjs';
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

  const [selectedStart, setSelectedStart] = useState<boolean>(() => {
    return filter.condition < 8;
  });

  const conditions = useMemo(
    () => [
      {
        value: selectedStart ? DateFilterCondition.DateStartsOn : DateFilterCondition.DateEndsOn,
        text: t('grid.dateFilter.is'),
      },
      {
        value: selectedStart ? DateFilterCondition.DateStartsBefore : DateFilterCondition.DateEndsAfter,
        text: t('grid.dateFilter.before'),
      },
      {
        value: selectedStart ? DateFilterCondition.DateStartsAfter : DateFilterCondition.DateEndsBefore,
        text: t('grid.dateFilter.after'),
      },
      {
        value: selectedStart ? DateFilterCondition.DateStartsOnOrBefore : DateFilterCondition.DateEndsOnOrAfter,
        text: t('grid.dateFilter.onOrBefore'),
      },
      {
        value: selectedStart ? DateFilterCondition.DateStartsOnOrAfter : DateFilterCondition.DateEndsOnOrBefore,
        text: t('grid.dateFilter.onOrAfter'),
      },
      {
        value: selectedStart ? DateFilterCondition.DateStartsBetween : DateFilterCondition.DateEndsBetween,
        text: t('grid.dateFilter.between'),
      },
      ![
        FieldType.CreatedTime,
        FieldType.LastEditedTime,
      ].includes(fieldType) && {
        value: selectedStart ? DateFilterCondition.DateStartIsEmpty : DateFilterCondition.DateEndIsEmpty,
        text: t('grid.dateFilter.empty'),
      },
      ![
        FieldType.CreatedTime,
        FieldType.LastEditedTime,
      ].includes(fieldType) && {
        value: selectedStart ? DateFilterCondition.DateStartIsNotEmpty : DateFilterCondition.DateEndIsNotEmpty,
        text: t('grid.dateFilter.notEmpty'),
      },
    ].filter(Boolean) as {
      value: DateFilterCondition;
      text: string;
    }[],
    [fieldType, selectedStart, t],
  );

  const displayTextField = useMemo(() => {
    return ![
      DateFilterCondition.DateEndIsEmpty,
      DateFilterCondition.DateEndIsNotEmpty,
      DateFilterCondition.DateStartIsEmpty,
      DateFilterCondition.DateStartIsNotEmpty,
    ].includes(filter.condition);
  }, [filter.condition]);
  const deleteFilter = useRemoveFilter();

  const handleSelectStartOrEnd = useCallback((isStart: boolean) => {
    setSelectedStart(isStart);
    // Update the filter condition based on the selected start or end
    // If the condition is already in the correct range, do nothing
    if (isStart && filter.condition < 8) return;
    if (!isStart && filter.condition >= 8) return;

    const newCondition = conditions.find((c) => c.value === filter.condition);

    if (newCondition) {
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        condition: isStart ? newCondition.value - 8 : newCondition.value + 8,
      });
    }
  }, [conditions, filter.condition, filter.id, filter.fieldId, updateFilter]);

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
