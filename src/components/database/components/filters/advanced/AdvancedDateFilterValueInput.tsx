import { DateFilter } from '@/application/database-yjs/fields/date/date.type';

import DateFilterValuePicker from '../filter-menu/DateFilterValuePicker';
import { useFilterValueUpdater } from '../filter-menu/FilterEditorContext';

export default function AdvancedDateFilterValueInput({ filter, disabled }: { filter: DateFilter; disabled?: boolean }) {
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
