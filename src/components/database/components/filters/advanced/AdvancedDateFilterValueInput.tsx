import { useCallback, useMemo } from 'react';

import { DateFilter } from '@/application/database-yjs/fields/date/date.type';
import {
  isParameterizedRelativeCondition,
  parseRelativeDateSpec,
  RelativeDateSpec,
  serializeRelativeDateSpec,
} from '@/application/database-yjs/fields/date/relativeDate';

import DateFilterValuePicker from '../filter-menu/DateFilterValuePicker';
import { useFilterValueUpdater } from '../filter-menu/FilterEditorContext';
import RelativeDateFilterBuilder from '../filter-menu/RelativeDateFilterBuilder';

/** "Is relative to today" in the advanced panel: direction, amount and unit on one row. */
function AdvancedRelativeDateValueInput({ filter, disabled }: AdvancedDateFilterValueInputProps) {
  const updateFilter = useFilterValueUpdater();
  const spec = useMemo(
    () => parseRelativeDateSpec(filter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter.relative_direction, filter.relative_amount, filter.relative_unit]
  );
  const handleChange = useCallback(
    (next: RelativeDateSpec) =>
      updateFilter({ filterId: filter.id, fieldId: filter.fieldId, content: serializeRelativeDateSpec(next) }),
    [filter.fieldId, filter.id, updateFilter]
  );

  return (
    <RelativeDateFilterBuilder
      compact
      onChange={handleChange}
      readOnly={disabled}
      spec={spec}
      testIdPrefix='advanced-date-filter'
    />
  );
}

interface AdvancedDateFilterValueInputProps {
  filter: DateFilter;
  disabled?: boolean;
}

export default function AdvancedDateFilterValueInput({ filter, disabled }: AdvancedDateFilterValueInputProps) {
  if (isParameterizedRelativeCondition(filter.condition)) {
    return <AdvancedRelativeDateValueInput disabled={disabled} filter={filter} />;
  }

  return <AdvancedAbsoluteDateValueInput disabled={disabled} filter={filter} />;
}

function AdvancedAbsoluteDateValueInput({ filter, disabled }: AdvancedDateFilterValueInputProps) {
  const updateFilter = useFilterValueUpdater();

  return (
    <DateFilterValuePicker
      filter={filter}
      disabled={disabled}
      variant='advanced'
      onChange={(content) => updateFilter({ filterId: filter.id, fieldId: filter.fieldId, content })}
    />
  );
}
