import { useCallback, useMemo, useState } from 'react';

import { DateFilter, DateFilterCondition, useConditionsReadOnly } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import { DateFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import {
  DateFilterSelection,
  DateFilterValuePicker,
} from '@/components/database/components/filters/value-controls/DateFilterValuePicker';
import { dateSelectionToFilterContent } from '@/components/database/components/filters/value-controls/filter-value';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getDateFormat, renderDate } from '@/utils/time';

function DateTimeFilterDatePicker({ filter }: { filter: DateFilter }) {
  const currentUser = useCurrentUser();
  const readOnly = useConditionsReadOnly();

  const isRange = useMemo(() => {
    return [DateFilterCondition.DateStartsBetween, DateFilterCondition.DateEndsBetween].includes(filter.condition);
  }, [filter.condition]);

  // The picked days are kept here, so the calendar and the inputs follow a pick at once.
  const [selection, setSelection] = useState<DateFilterSelection>(() => {
    const { start, end, timestamp } = filter;
    const from =
      isRange && start ? new Date(Number(start) * 1000) : timestamp ? new Date(Number(timestamp) * 1000) : undefined;
    const to = isRange && end ? new Date(Number(filter.end) * 1000) : undefined;

    return {
      from,
      to,
    };
  });

  const updateFilter = useUpdateFilter();

  const onSelect = useCallback(
    (next: DateFilterSelection) => {
      setSelection(next);
      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: dateSelectionToFilterContent(isRange, next),
      });
    },
    [filter.id, filter.fieldId, isRange, updateFilter]
  );

  const text = useMemo(() => {
    if (!filter.content) return;

    const { timestamp, end, start } = filter;

    if (isRange && start && end) {
      const dateFormat = currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat | DateFormat.Local;

      return `${renderDate(start.toString(), getDateFormat(dateFormat), true)} - ${renderDate(
        end.toString(),
        getDateFormat(dateFormat),
        true
      )}`;
    }

    if (!timestamp) return '';

    return renderDate(timestamp.toString(), getDateFormat(DateFormat.Local), true);
  }, [filter, isRange, currentUser?.metadata]);

  return (
    <DateFilterValuePicker
      isRange={isRange}
      selected={selection}
      onSelect={onSelect}
      label={text}
      withInputs
      disabled={readOnly}
      data-testid='date-filter-date-picker'
    />
  );
}

export default DateTimeFilterDatePicker;
