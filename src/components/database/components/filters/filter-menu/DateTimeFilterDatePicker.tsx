import { useReadOnly } from '@/application/database-yjs/context';
import { useUpdateFilter } from '@/application/database-yjs/dispatch/sort-filter';
import { DateFilter } from '@/application/database-yjs/fields/date/date.type';

import DateFilterValuePicker from './DateFilterValuePicker';

export default function DateTimeFilterDatePicker({ filter }: { filter: DateFilter }) {
  const readOnly = useReadOnly();
  const updateFilter = useUpdateFilter();

  return (
    <DateFilterValuePicker
      filter={filter}
      disabled={readOnly}
      onChange={(content) => updateFilter({ filterId: filter.id, fieldId: filter.fieldId, content })}
    />
  );
}
