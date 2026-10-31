import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { useUpdateFilter } from '@/application/database-yjs/dispatch/sort-filter';
import { DateFilter, DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import {
  DEFAULT_RELATIVE_DATE_SPEC,
  isParameterizedRelativeCondition,
  isRelativeDateComparison,
  isRelativeDateCondition,
  isStartDateCondition,
  parseRelativeDateSpec,
  RelativeDateSpec,
  serializeRelativeDateSpec,
  toEndDateCondition,
  toStartDateCondition,
} from '@/application/database-yjs/fields/date/relativeDate';
import { useConditionsReadOnly } from '@/application/database-yjs/context';
import { useFieldType } from '@/application/database-yjs/selector';
import { dateFilterConditions } from '@/components/database/components/filters/filter-conditions';
import DateTimeFilterDatePicker from '@/components/database/components/filters/filter-menu/DateTimeFilterDatePicker';
import DateTimeFilterStartEndDateSelect
  from '@/components/database/components/filters/filter-menu/DateTimeFilterStartEndDateSelect';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import RelativeDateFilterBuilder from '@/components/database/components/filters/filter-menu/RelativeDateFilterBuilder';
import { useRelativeDateFilterWrites } from '@/components/database/components/filters/hooks/useRelativeDateFilterWrites';

function DateTimeFilterMenu ({ filter }: { filter: DateFilter }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateFilter();
  const readOnly = useConditionsReadOnly();
  const fieldType = useFieldType(filter.fieldId);
  const relative = isParameterizedRelativeCondition(filter.condition);
  const relativeSpec = useMemo(
    () => parseRelativeDateSpec(filter),
    // The spec keys are what `parseFilter` spread from the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter.relative_direction, filter.relative_amount, filter.relative_unit]
  );
  const allowRelativeComparisons = useRelativeDateFilterWrites();
  const compatibilityReadOnly = !allowRelativeComparisons && isRelativeDateComparison(filter.condition, filter.content);

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

  // Into "Is relative to today" the spec starts as This week; back to an
  // absolute condition the date is picked again.
  const handleSelectCondition = useCallback(
    (condition: number) => {
      if (compatibilityReadOnly || condition === filter.condition) return;
      const intoRelative = isParameterizedRelativeCondition(condition);

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        condition,
        ...(intoRelative
          ? { content: serializeRelativeDateSpec(DEFAULT_RELATIVE_DATE_SPEC) }
          : relative
          ? { content: '' }
          : {}),
      });
    },
    [compatibilityReadOnly, filter.condition, filter.fieldId, filter.id, relative, updateFilter]
  );
  const handleRelativeChange = useCallback(
    (spec: RelativeDateSpec) =>
      updateFilter({ filterId: filter.id, fieldId: filter.fieldId, content: serializeRelativeDateSpec(spec) }),
    [filter.fieldId, filter.id, updateFilter]
  );

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
              onSelect={handleSelectCondition}
            />
          </>
        }
      />
      {displayTextField && (
        <DateTimeFilterDatePicker filter={filter} />
      )}
      {relative && (
        <div className={'px-1 pb-1'}>
          <RelativeDateFilterBuilder
            spec={relativeSpec}
            onChange={handleRelativeChange}
            testIdPrefix={'date-filter'}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  );
}

export default DateTimeFilterMenu;
