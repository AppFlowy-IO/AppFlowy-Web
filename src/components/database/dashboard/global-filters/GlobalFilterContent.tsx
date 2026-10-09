import dayjs from 'dayjs';
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  isParameterizedRelativeCondition,
  parseRelativeDateSpec,
  RelativeDateSpec,
  serializeRelativeDateSpec,
} from '@/application/database-yjs/fields/date/relativeDate';
import { SelectOptionColor } from '@/application/database-yjs/fields/select-option/select_option.type';
import { MetadataKey } from '@/application/user-metadata';
import { ReactComponent as CloseCircleIcon } from '@/assets/icons/close_circle.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { ClearSelectionRow } from '@/components/database/components/filters/filter-menu/ClearSelectionItem';
import { GLOBAL_FILTER_INPUT_DEBOUNCE_MS } from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import RelativeDateFilterBuilder from '@/components/database/components/filters/filter-menu/RelativeDateFilterBuilder';
import {
  dateToFilterTimestamp,
  togglePersonContent,
} from '@/components/database/components/filters/value-controls/filter-value';
import { filterValueItemClassName } from '@/components/database/components/filters/value-controls/filter-value-item';
import { FilterTextValueInput } from '@/components/database/components/filters/value-controls/FilterTextValueInput';
import { PersonFilterList } from '@/components/database/components/filters/value-controls/PersonFilterList';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Calendar } from '@/components/ui/calendar';
import { DropdownMenuItemTick } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { normalizeDashboardText } from '@/utils/normalize-text';

import {
  isDateFieldType,
  isDateRangeCondition,
  isPersonFieldType,
  parseDateContent,
  parsePersonContent,
  serializeDateContent,
} from './global-filter.conditions';
import {
  checkedMergedOptionKeys,
  EMPTY_MERGED_SELECTION,
  MergedOptionEntry,
  MergedSelection,
  toggleMergedOption,
} from './global-filter.options';
import { useGlobalFilterDateFormat } from './useGlobalFilterLabel';

const CONTENT_TEST_ID = 'dashboard-global-filter-content';
const CLEAR_TEST_ID = 'dashboard-global-filter-clear-selection';
const LIST_CLASS_NAME = 'max-h-[260px]';
const NO_ENTRIES: MergedOptionEntry[] = [];

type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** What a value control reads: everything but the name and the mappings. */
export type GlobalFilterValue = Pick<
  DashboardGlobalFilter,
  'id' | 'fieldType' | 'condition' | 'content' | 'optionNames'
>;

interface ContentProps {
  filter: GlobalFilterValue;
  onChange: (content: string) => void;
}

// The value controls follow the view filter menus' encodings, so a global
// filter stores exactly what a view filter of the same type stores. Nothing
// here is read-only: a reader's change is a private value (WP07).

/** Focus the first text field of `container` once mounted (the value is what the editor is for). */
function useFocusFirstInput(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLInputElement>('input')?.focus());

    return () => cancelAnimationFrame(frame);
  }, [enabled]);
  return ref;
}

const MergedOptionRow = memo(function MergedOptionRow({
  entry,
  checked,
  onToggle,
}: {
  entry: MergedOptionEntry;
  checked: boolean;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const color = (entry.color as SelectOptionColor | undefined) ?? SelectOptionColor.OptionColor1;

  return (
    <button
      type='button'
      data-testid='dashboard-global-filter-option'
      data-option-id={entry.id}
      data-option-key={entry.key}
      data-checked={checked}
      className={filterValueItemClassName}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(entry.key);
      }}
    >
      <Tag
        label={entry.name || t('untitled', { defaultValue: 'Untitled' })}
        textColor={SelectOptionFgColorMap[color]}
        bgColor={SelectOptionColorMap[color]}
      />
      {checked && <DropdownMenuItemTick />}
    </button>
  );
});

/**
 * The options of every source of a select filter, merged by name (WP08
 * §1.9): one row per name, checked when the selection holds any source's
 * option of that name. A pick writes the ids and the names together.
 */
function OptionContent({
  filter,
  entries,
  onSelectionChange,
  autoFocus,
}: {
  filter: GlobalFilterValue;
  entries: MergedOptionEntry[];
  onSelectionChange: (selection: MergedSelection) => void;
  autoFocus: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  // A pick checks its row at once; the filter it changes (every widget of
  // its sources filters again) applies in a transition, so the click paints
  // first and later input interrupts it. The pick is shown until the filter
  // it was made from is replaced (by the pick itself, or anything else).
  const [pick, setPick] = useState<{ from: GlobalFilterValue; selection: MergedSelection } | null>(null);

  if (pick && pick.from !== filter) setPick(null);
  const selection = pick && pick.from === filter ? pick.selection : filter;
  const checked = useMemo(() => checkedMergedOptionKeys(entries, selection), [entries, selection]);
  const keyword = normalizeDashboardText(search);
  const visible = keyword ? entries.filter((entry) => normalizeDashboardText(entry.name).includes(keyword)) : entries;
  const select = useCallback(
    (next: MergedSelection) => {
      setPick({ from: filter, selection: next });
      startTransition(() => onSelectionChange(next));
    },
    [filter, onSelectionChange]
  );
  const toggle = useCallback(
    (key: string) => select(toggleMergedOption(selection, entries, key)),
    [entries, select, selection]
  );

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <div className='p-1'>
        <input
          aria-label={t('search.label', { defaultValue: 'Search' })}
          autoFocus={autoFocus}
          className='h-7 w-full min-w-0 rounded-200 border border-border-primary bg-transparent px-2 text-sm outline-none focus:border-border-theme-thick'
          data-testid='dashboard-global-filter-option-search'
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('search.label', { defaultValue: 'Search' })}
          value={search}
        />
      </div>
      <div
        className={cn('appflowy-scroller flex flex-col overflow-y-auto', LIST_CLASS_NAME)}
        data-testid='filter-option-results'
        key={search}
      >
        {visible.map((entry) => (
          <MergedOptionRow checked={checked.has(entry.key)} entry={entry} key={entry.key} onToggle={toggle} />
        ))}
        {visible.length === 0 && (
          <div className='py-4 text-center text-sm text-text-tertiary'>
            {t('dashboard.globalFilters.noResults', { defaultValue: 'No results' })}
          </div>
        )}
      </div>
      {selection.content.length > 0 && (
        <ClearSelectionRow data-testid={CLEAR_TEST_ID} onClear={() => select(EMPTY_MERGED_SELECTION)} />
      )}
    </div>
  );
}

function PersonContent({ filter, onChange, autoFocus }: ContentProps & { autoFocus: boolean }) {
  const selectedIds = useMemo(() => parsePersonContent(filter.content), [filter.content]);
  const containerRef = useFocusFirstInput(autoFocus);
  const toggle = useCallback(
    (personId: string) => onChange(togglePersonContent(selectedIds, personId)),
    [onChange, selectedIds]
  );

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType} ref={containerRef}>
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

/**
 * An absolute date: the formatted date (or range) with a clear button above
 * an inline month calendar that has the focus.
 */
function DateContent({ filter, onChange, autoFocus }: ContentProps & { autoFocus: boolean }) {
  const { t } = useTranslation();
  const currentUser = useCurrentUserOptional();
  const dateFormat = useGlobalFilterDateFormat();
  const range = isDateRangeCondition(filter.condition);
  const value = useMemo(() => parseDateContent(filter.content), [filter.content]);
  const startWeekOn = Number(currentUser?.metadata?.[MetadataKey.StartWeekOn]) || 0;
  const weekStartsOn = (startWeekOn >= 0 && startWeekOn <= 6 ? startWeekOn : 0) as WeekStart;
  const format = (unix?: number) => (unix === undefined ? '' : dayjs(unix * 1000).format(dateFormat));
  const text = range
    ? value.start !== undefined || value.end !== undefined
      ? `${format(value.start)} – ${format(value.end)}`
      : ''
    : format(value.timestamp);
  const writeSingle = (date: Date | undefined) =>
    onChange(serializeDateContent(false, { timestamp: dateToFilterTimestamp(date) }));
  const writeRange = (from: Date | undefined, to: Date | undefined) =>
    onChange(serializeDateContent(true, { start: dateToFilterTimestamp(from), end: dateToFilterTimestamp(to) }));
  const defaultMonth = toDate(range ? value.start : value.timestamp);

  return (
    <div className='flex flex-col gap-1' data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <div
        className='flex h-7 items-center gap-1 rounded-200 border border-border-primary px-2 text-sm'
        data-testid='dashboard-global-filter-date-value'
      >
        <span className={cn('min-w-0 flex-1 truncate', !text && 'text-text-tertiary')}>
          {text || t('grid.settings.typeAValue')}
        </span>
        {text && (
          <button
            aria-label={t('button.clear', { defaultValue: 'Clear' })}
            className='text-icon-tertiary hover:text-icon-secondary'
            data-testid='dashboard-global-filter-date-clear'
            onClick={() => onChange('')}
            type='button'
          >
            <CloseCircleIcon className='h-4 w-4' />
          </button>
        )}
      </div>
      <div className='flex justify-center' data-testid='dashboard-global-filter-date-calendar'>
        {range ? (
          <Calendar
            defaultMonth={defaultMonth}
            initialFocus={autoFocus}
            mode='range'
            onSelect={(next) => writeRange(next?.from, next?.to)}
            selected={{ from: toDate(value.start), to: toDate(value.end) }}
            weekStartsOn={weekStartsOn}
          />
        ) : (
          <Calendar
            defaultMonth={defaultMonth}
            initialFocus={autoFocus}
            mode='single'
            onSelect={(date) => writeSingle(date)}
            selected={toDate(value.timestamp)}
            weekStartsOn={weekStartsOn}
          />
        )}
      </div>
    </div>
  );
}

/** "Is relative to today": the relative builder, writing the spec as the content. */
function RelativeContent({ filter, onChange, autoFocus }: ContentProps & { autoFocus: boolean }) {
  const spec = useMemo(() => parseRelativeDateSpec(filter.content), [filter.content]);
  const handleChange = useCallback((next: RelativeDateSpec) => onChange(serializeRelativeDateSpec(next)), [onChange]);

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <RelativeDateFilterBuilder
        autoFocus={autoFocus}
        onChange={handleChange}
        spec={spec}
        testIdPrefix='dashboard-global-filter'
      />
    </div>
  );
}

/**
 * The value control of a global filter, focused when the editor opens (WP08
 * §1.6). Content uses the view-filter encoding of the property type (text,
 * number string, comma-separated option ids with their names, JSON person
 * ids, JSON date or a relative spec), so it evaluates like a view filter.
 */
export const GlobalFilterContent = memo(function GlobalFilterContent({
  filter,
  onChange,
  onSelectionChange,
  optionEntries = NO_ENTRIES,
  autoFocus = false,
}: ContentProps & {
  /**
   * Select filters: the selection, ids and names together. The names are what
   * matches the options of the other sources (WP08 §1.9), so a select pick
   * never goes through `onChange` with the ids alone.
   */
  onSelectionChange: (selection: MergedSelection) => void;
  /** Select filters: the merged options of every source. */
  optionEntries?: MergedOptionEntry[];
  autoFocus?: boolean;
}) {
  // A typed value re-filters every widget of its sources: as a transition, so
  // keys typed meanwhile paint at once and interrupt it. The value is kept in
  // the dashboard's scope at once, so a save or a close still finds it.
  const applyTypedValue = useCallback((content: string) => startTransition(() => onChange(content)), [onChange]);

  switch (filter.fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
    case FieldType.Number:
      return (
        <FilterTextValueInput
          autoFocus={autoFocus}
          data-testid={CONTENT_TEST_ID}
          data-field-type={filter.fieldType}
          debounceMs={GLOBAL_FILTER_INPUT_DEBOUNCE_MS}
          filterId={filter.id}
          fieldId='content'
          content={filter.content}
          numeric={filter.fieldType === FieldType.Number}
          onChange={applyTypedValue}
        />
      );
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return (
        <OptionContent
          autoFocus={autoFocus}
          entries={optionEntries}
          filter={filter}
          onSelectionChange={onSelectionChange}
        />
      );
    default:
      if (isPersonFieldType(filter.fieldType)) {
        return <PersonContent autoFocus={autoFocus} filter={filter} onChange={onChange} />;
      }

      if (isDateFieldType(filter.fieldType)) {
        return isParameterizedRelativeCondition(filter.condition) ? (
          <RelativeContent autoFocus={autoFocus} filter={filter} onChange={onChange} />
        ) : (
          <DateContent autoFocus={autoFocus} filter={filter} onChange={onChange} />
        );
      }

      return null;
  }
});

export default GlobalFilterContent;
