import { ChangeEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useDebouncedFilterInput } from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { Input } from '@/components/ui/input';

import { NUMBER_INPUT_PATTERN } from './filter-value';

export interface FilterTextValueInputProps {
  /** The filter (and what the draft belongs to: a change of either resets the draft). */
  filterId: string;
  fieldId: string;
  content: string;
  /** A number filter: an edit that is not a number is rejected. */
  numeric?: boolean;
  /** The debounced value; also flushed when the input unmounts. */
  onChange: (content: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  'data-testid'?: string;
  'data-field-type'?: number;
}

/**
 * The text value of a filter (text, URL, number): a debounced input. Shared
 * by the view filter menus and the dashboard's global filter editor.
 */
export function FilterTextValueInput({
  filterId,
  fieldId,
  content,
  numeric = false,
  onChange,
  disabled,
  autoFocus,
  ...attributes
}: FilterTextValueInputProps) {
  const { t } = useTranslation();
  // A flush without a pending edit carries no content: like the view filter updater, ignore it.
  const updateFilter = useCallback(
    ({ content }: { content?: string }) => {
      if (typeof content === 'string') onChange(content);
    },
    [onChange]
  );
  const { value, updateValue } = useDebouncedFilterInput({ content, filterId, fieldId, updateFilter });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;

    // Keep the previous value when the edit doesn't match the numeric pattern.
    if (numeric && next !== '' && !NUMBER_INPUT_PATTERN.test(next)) return;
    updateValue(next);
  };

  return (
    <Input
      {...attributes}
      autoFocus={autoFocus}
      disabled={disabled}
      spellCheck={false}
      size={'sm'}
      inputMode={numeric ? 'decimal' : undefined}
      value={value}
      onChange={handleChange}
      placeholder={t('grid.settings.typeAValue')}
    />
  );
}

export default FilterTextValueInput;
