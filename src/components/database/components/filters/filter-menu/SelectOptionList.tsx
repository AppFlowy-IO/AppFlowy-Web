import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { SelectOptionFilterList } from '@/components/database/components/filters/value-controls/SelectOptionFilterList';

/**
 * `SelectOptionFilterList` for a view filter: the options come from the
 * filter's field unless the caller already resolved them.
 */
export function SelectOptionList({
  fieldId,
  selectedIds,
  onSelect,
  showTooltips = false,
  options,
}: {
  fieldId: string;
  options?: SelectOption[];
  selectedIds: string[];
  onSelect: (optionId: string) => void;
  /** Desktop parity: the advanced panel shows the full option name in a tooltip above the tag. */
  showTooltips?: boolean;
}) {
  const { field } = useFieldSelector(fieldId);
  // Not memoized: `field` is a Yjs map with a stable identity that mutates in
  // place, so a [field]-keyed memo would serve stale options after edits.
  const typeOption = field ? parseSelectOptionTypeOptions(field) : null;

  if (!options && !typeOption) return null;

  return (
    <SelectOptionFilterList
      options={options ?? typeOption?.options ?? []}
      selectedIds={selectedIds}
      onToggle={onSelect}
      showTooltips={showTooltips}
    />
  );
}
