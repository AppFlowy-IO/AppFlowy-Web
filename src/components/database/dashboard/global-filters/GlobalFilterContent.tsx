import dayjs from 'dayjs';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { ClearSelectionRow } from '@/components/database/components/filters/filter-menu/ClearSelectionItem';
import {
  DateFilterSelection,
  DateFilterValuePicker,
} from '@/components/database/components/filters/value-controls/DateFilterValuePicker';
import {
  dateToFilterTimestamp,
  togglePersonContent,
  toggleSelectOptionContent,
} from '@/components/database/components/filters/value-controls/filter-value';
import { FilterTextValueInput } from '@/components/database/components/filters/value-controls/FilterTextValueInput';
import { PersonFilterList } from '@/components/database/components/filters/value-controls/PersonFilterList';
import { SelectOptionFilterList } from '@/components/database/components/filters/value-controls/SelectOptionFilterList';

import {
  isDateFieldType,
  isDateRangeCondition,
  isPersonFieldType,
  parseDateContent,
  parseOptionContent,
  parsePersonContent,
  serializeDateContent,
} from './global-filter.conditions';
import { GlobalFilterSourceField } from './global-filter.utils';
import { useGlobalFilterDateFormat } from './useGlobalFilterLabel';

const CONTENT_TEST_ID = 'dashboard-global-filter-content';
const CLEAR_TEST_ID = 'dashboard-global-filter-clear-selection';
// The editor also holds the name, the mappings and the condition: its lists are shorter than a view filter's.
const LIST_CLASS_NAME = 'max-h-[220px]';
const NO_OPTIONS: SelectOption[] = [];

/** What a value control reads: everything but the name and the mappings. */
export type GlobalFilterValue = Pick<DashboardGlobalFilter, 'id' | 'fieldType' | 'condition' | 'content'>;

interface ContentProps {
  filter: GlobalFilterValue;
  onChange: (content: string) => void;
}

// The value controls are the ones of the view filter menus
// (`components/filters/value-controls`), so a global filter stores exactly what
// a view filter of the same type stores. Nothing here is read-only: a viewer
// edits a local override that only they see.

function OptionContent({ filter, onChange, field }: ContentProps & { field?: GlobalFilterSourceField }) {
  const selectedIds = useMemo(() => parseOptionContent(filter.content), [filter.content]);
  const options = field?.options ?? NO_OPTIONS;
  const toggle = useCallback(
    (optionId: string) => onChange(toggleSelectOptionContent(selectedIds, optionId, options)),
    [onChange, options, selectedIds]
  );

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <SelectOptionFilterList
        options={options}
        selectedIds={selectedIds}
        onToggle={toggle}
        optionTestId='dashboard-global-filter-option'
        listClassName={LIST_CLASS_NAME}
      />
      {selectedIds.length > 0 && <ClearSelectionRow data-testid={CLEAR_TEST_ID} onClear={() => onChange('')} />}
    </div>
  );
}

function PersonContent({ filter, onChange }: ContentProps) {
  const selectedIds = useMemo(() => parsePersonContent(filter.content), [filter.content]);
  const toggle = useCallback(
    (personId: string) => onChange(togglePersonContent(selectedIds, personId)),
    [onChange, selectedIds]
  );

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <PersonFilterList
        fieldType={filter.fieldType}
        selectedIds={selectedIds}
        onToggle={toggle}
        optionTestId='dashboard-global-filter-person'
        listClassName={LIST_CLASS_NAME}
      />
      {selectedIds.length > 0 && (
        <ClearSelectionRow data-testid={CLEAR_TEST_ID} onClear={() => onChange(JSON.stringify([]))} />
      )}
    </div>
  );
}

function toDate(unix: number | undefined) {
  return unix === undefined ? undefined : new Date(unix * 1000);
}

function DateContent({ filter, onChange }: ContentProps) {
  const { t } = useTranslation();
  const dateFormat = useGlobalFilterDateFormat();
  const range = isDateRangeCondition(filter.condition);
  const value = useMemo(() => parseDateContent(filter.content), [filter.content]);
  const selected = useMemo<DateFilterSelection>(
    () => (range ? { from: toDate(value.start), to: toDate(value.end) } : { from: toDate(value.timestamp) }),
    [range, value]
  );
  const format = (unix?: number) => (unix === undefined ? '' : dayjs(unix * 1000).format(dateFormat));
  const text = range
    ? value.start !== undefined || value.end !== undefined
      ? `${format(value.start)} - ${format(value.end)}`
      : ''
    : format(value.timestamp);
  // A cleared picker yields empty content (see `serializeDateContent`).
  const handleSelect = useCallback(
    ({ from, to }: DateFilterSelection) =>
      onChange(
        serializeDateContent(
          range,
          range
            ? { start: dateToFilterTimestamp(from), end: dateToFilterTimestamp(to) }
            : { timestamp: dateToFilterTimestamp(from) }
        )
      ),
    [onChange, range]
  );

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <DateFilterValuePicker
        isRange={range}
        selected={selected}
        onSelect={handleSelect}
        closeOnSingleSelect
        label={text || <span className='text-text-tertiary'>{t('grid.settings.typeAValue')}</span>}
        data-testid='dashboard-global-filter-date-trigger'
      />
    </div>
  );
}

/**
 * The value control of a global filter. Content uses the view-filter encoding
 * of the property type (text, number string, comma-separated option ids, JSON
 * person ids, JSON date), so it evaluates exactly like a view filter.
 */
export const GlobalFilterContent = memo(function GlobalFilterContent({
  filter,
  primaryField,
  onChange,
}: ContentProps & {
  /** The primary target's property; select options come from it. */
  primaryField?: GlobalFilterSourceField;
}) {
  switch (filter.fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
    case FieldType.Number:
      return (
        <FilterTextValueInput
          data-testid={CONTENT_TEST_ID}
          data-field-type={filter.fieldType}
          filterId={filter.id}
          fieldId='content'
          content={filter.content}
          numeric={filter.fieldType === FieldType.Number}
          onChange={onChange}
        />
      );
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return <OptionContent filter={filter} onChange={onChange} field={primaryField} />;
    default:
      if (isPersonFieldType(filter.fieldType)) return <PersonContent filter={filter} onChange={onChange} />;
      if (isDateFieldType(filter.fieldType)) return <DateContent filter={filter} onChange={onChange} />;
      return null;
  }
});

export default GlobalFilterContent;
