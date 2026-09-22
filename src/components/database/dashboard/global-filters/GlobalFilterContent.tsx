import dayjs from 'dayjs';
import { ChangeEvent, memo, ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { MetadataKey } from '@/application/user-metadata';
import { canonicalizeUserUid } from '@/application/user-uid';
import { ReactComponent as PersonIcon } from '@/assets/icons/person.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import { FilterSearchInput } from '@/components/database/components/filters/filter-menu/FilterSearchInput';
import { useDebouncedFilterInput } from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

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
const itemClassName = cn(dropdownMenuItemVariants({ variant: 'default' }), 'w-full text-left');
// Same rule as the view number filter: optional minus, digits, one decimal point.
const NUMBER_INPUT_PATTERN = /^-?\d*\.?\d*$/;

/** What a value control reads: everything but the name and the mappings. */
export type GlobalFilterValue = Pick<DashboardGlobalFilter, 'id' | 'fieldType' | 'condition' | 'content'>;

interface ContentProps {
  filter: GlobalFilterValue;
  onChange: (content: string) => void;
}

function ClearSelectionButton({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();

  return (
    <>
      <div className={'my-1 border-t border-border-primary'} />
      <button
        type='button'
        data-testid='dashboard-global-filter-clear-selection'
        className={itemClassName}
        onClick={onClear}
      >
        {t('grid.filter.clearSelection')}
      </button>
    </>
  );
}

function TextContent({ filter, onChange, numeric }: ContentProps & { numeric: boolean }) {
  const { t } = useTranslation();
  // Like the view filter updater, a flush without a pending value (no content) is ignored.
  const updateFilter = useCallback(
    ({ content }: { content?: string }) => {
      if (typeof content === 'string') onChange(content);
    },
    [onChange]
  );
  const { value, updateValue } = useDebouncedFilterInput({
    content: filter.content,
    filterId: filter.id,
    fieldId: 'content',
    updateFilter,
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;

    if (numeric && next !== '' && !NUMBER_INPUT_PATTERN.test(next)) return;
    updateValue(next);
  };

  return (
    <Input
      data-testid={CONTENT_TEST_ID}
      data-field-type={filter.fieldType}
      size={'sm'}
      spellCheck={false}
      inputMode={numeric ? 'decimal' : undefined}
      value={value}
      onChange={handleChange}
      placeholder={t('grid.settings.typeAValue')}
    />
  );
}

function OptionContent({ filter, onChange, field }: ContentProps & { field?: GlobalFilterSourceField }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const selected = useMemo(() => new Set(parseOptionContent(filter.content)), [filter.content]);
  const options = useMemo(() => field?.options ?? [], [field]);
  const searchTexts = useMemo(() => options.map((option) => option.name.toLocaleLowerCase()), [options]);
  const keyword = search.trim().toLocaleLowerCase();
  const visible = useMemo(
    () => (keyword ? options.filter((_, index) => searchTexts[index].includes(keyword)) : options),
    [keyword, options, searchTexts]
  );

  const toggle = (optionId: string) => {
    const next = new Set(selected);

    if (next.has(optionId)) {
      next.delete(optionId);
    } else {
      next.add(optionId);
    }

    // Stored in field option order, like the view select filter.
    onChange(
      options
        .filter((option) => next.has(option.id))
        .map((option) => option.id)
        .join(',')
    );
  };

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <FilterSearchInput value={search} onChange={setSearch} />
      <div className={'appflowy-scroller flex max-h-[220px] flex-col overflow-y-auto'}>
        {visible.map((option) => {
          const checked = selected.has(option.id);

          return (
            <button
              type='button'
              key={option.id}
              data-testid='dashboard-global-filter-option'
              data-option-id={option.id}
              data-checked={checked}
              className={itemClassName}
              onClick={() => toggle(option.id)}
            >
              <Tag
                label={option.name}
                textColor={SelectOptionFgColorMap[option.color]}
                bgColor={SelectOptionColorMap[option.color]}
              />
              {checked && <DropdownMenuItemTick />}
            </button>
          );
        })}
        {visible.length === 0 && (
          <div className='py-3 text-center text-sm text-text-tertiary'>{t('inlineActions.noResults')}</div>
        )}
      </div>
      {selected.size > 0 && <ClearSelectionButton onClear={() => onChange('')} />}
    </div>
  );
}

function PersonContent({ filter, onChange }: ContentProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  // Person cells store workspace person ids; Created by / Last edited by store user uids.
  const isAttribution = filter.fieldType !== FieldType.Person;
  const selectedIds = useMemo(() => parsePersonContent(filter.content), [filter.content]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const { users, loading } = useMentionableUsersWithAutoFetch(true);
  const people = useMemo(
    () =>
      users.flatMap((user) => {
        const identifier = isAttribution ? canonicalizeUserUid(user.uid) : user.person_id;

        if (!identifier) return [];
        return [{ identifier, user, searchText: `${user.name ?? ''} ${user.email ?? ''}`.toLocaleLowerCase() }];
      }),
    [isAttribution, users]
  );
  const unknownIds = useMemo(() => {
    const known = new Set(people.map(({ identifier }) => identifier));

    return selectedIds.filter((id) => !known.has(id));
  }, [people, selectedIds]);
  const keyword = search.trim().toLocaleLowerCase();
  const visible = useMemo(
    () => (keyword ? people.filter(({ searchText }) => searchText.includes(keyword)) : people),
    [keyword, people]
  );

  const toggle = (identifier: string) => {
    const next = selectedSet.has(identifier)
      ? selectedIds.filter((id) => id !== identifier)
      : [...selectedIds, identifier];

    onChange(JSON.stringify(next));
  };

  const renderRow = (key: string, checked: boolean, avatar: ReactNode, label: string) => (
    <button
      type='button'
      key={key}
      data-testid='dashboard-global-filter-person'
      data-person-id={key}
      data-checked={checked}
      className={itemClassName}
      onClick={() => toggle(key)}
    >
      {avatar}
      <span className='flex-1 truncate'>{label}</span>
      {checked && <DropdownMenuItemTick />}
    </button>
  );

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <FilterSearchInput value={search} onChange={setSearch} />
      <div className={'appflowy-scroller max-h-[220px] overflow-y-auto'}>
        {loading && people.length === 0 ? (
          <div className='flex items-center justify-center py-3'>
            <Progress />
          </div>
        ) : visible.length === 0 && unknownIds.length === 0 ? (
          <div className='py-3 text-center text-sm text-text-tertiary'>{t('grid.field.person.noMatches')}</div>
        ) : (
          <>
            {visible.map(({ identifier, user }) => {
              const displayName = user.name || user.email || '?';

              return renderRow(
                identifier,
                selectedSet.has(identifier),
                <Avatar className='h-5 w-5'>
                  <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
                  <AvatarFallback className='text-xs' name={displayName}>
                    {displayName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>,
                displayName
              );
            })}
            {unknownIds.map((id) =>
              renderRow(id, true, <PersonIcon className='h-5 w-5 text-icon-primary' />, t('grid.person.unknownUser'))
            )}
          </>
        )}
      </div>
      {selectedIds.length > 0 && <ClearSelectionButton onClear={() => onChange(JSON.stringify([]))} />}
    </div>
  );
}

function DateContent({ filter, onChange }: ContentProps) {
  const { t } = useTranslation();
  const currentUser = useCurrentUserOptional();
  const dateFormat = useGlobalFilterDateFormat();
  const [open, setOpen] = useState(false);
  const range = isDateRangeCondition(filter.condition);
  const value = useMemo(() => parseDateContent(filter.content), [filter.content]);
  const startWeekOn = Number(currentUser?.metadata?.[MetadataKey.StartWeekOn]) || 0;
  const weekStartsOn = (startWeekOn >= 0 && startWeekOn <= 6 ? startWeekOn : 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const toDate = (unix?: number) => (unix === undefined ? undefined : dayjs(unix * 1000).toDate());
  const toUnix = (date?: Date) => (date ? dayjs(date).startOf('day').unix() : undefined);
  const format = (unix?: number) => (unix === undefined ? '' : dayjs(unix * 1000).format(dateFormat));
  const text = range
    ? value.start !== undefined || value.end !== undefined
      ? `${format(value.start)} - ${format(value.end)}`
      : ''
    : format(value.timestamp);

  return (
    <div data-testid={CONTENT_TEST_ID} data-field-type={filter.fieldType}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={'outline'}
            size={'sm'}
            className={'w-full justify-start'}
            data-testid='dashboard-global-filter-date-trigger'
          >
            {text || <span className='text-text-tertiary'>{t('grid.settings.typeAValue')}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={'w-fit p-2'}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onClick={(event) => event.stopPropagation()}
        >
          {range ? (
            <Calendar
              mode='range'
              showOutsideDays
              weekStartsOn={weekStartsOn}
              defaultMonth={toDate(value.start)}
              selected={{ from: toDate(value.start), to: toDate(value.end) }}
              onSelect={(next) =>
                onChange(serializeDateContent(true, { start: toUnix(next?.from), end: toUnix(next?.to) }))
              }
            />
          ) : (
            <Calendar
              mode='single'
              // Clicking the selected day keeps it instead of clearing the filter value.
              required
              showOutsideDays
              weekStartsOn={weekStartsOn}
              defaultMonth={toDate(value.timestamp)}
              selected={toDate(value.timestamp)}
              onSelect={(date) => {
                if (date) onChange(serializeDateContent(false, { timestamp: toUnix(date) }));
                setOpen(false);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
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
      return <TextContent filter={filter} onChange={onChange} numeric={false} />;
    case FieldType.Number:
      return <TextContent filter={filter} onChange={onChange} numeric />;
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
