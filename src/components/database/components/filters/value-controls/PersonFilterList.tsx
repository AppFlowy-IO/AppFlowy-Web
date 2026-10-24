import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as PersonIcon } from '@/assets/icons/person.svg';
import { FilterSearchInput } from '@/components/database/components/filters/filter-menu/FilterSearchInput';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenuItemTick } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import { filterValueItemClassName } from './filter-value-item';
import { usePersonFilterOptions } from './usePersonFilterOptions';

const PersonFilterRow = memo(function PersonFilterRow({
  identifier,
  label,
  avatarUrl,
  unknown = false,
  checked,
  testId,
  onToggle,
}: {
  identifier: string;
  label: string;
  avatarUrl?: string | null;
  /** A selected id without a workspace member: a person glyph instead of an avatar. */
  unknown?: boolean;
  checked: boolean;
  testId: string;
  onToggle: (personId: string) => void;
}) {
  return (
    <button
      type='button'
      data-testid={testId}
      data-person-id={identifier}
      data-checked={checked}
      className={filterValueItemClassName}
      onClick={() => onToggle(identifier)}
    >
      {unknown ? (
        <PersonIcon className='h-5 w-5 text-icon-primary' />
      ) : (
        <Avatar className='h-5 w-5'>
          <AvatarImage src={avatarUrl || undefined} alt={label} />
          <AvatarFallback className='text-xs' name={label}>
            {label.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <span className='flex-1 truncate'>{label}</span>
      {checked && <DropdownMenuItemTick />}
    </button>
  );
});

/** The line below a capped people list: how many more a search can reach. */
export function PersonFilterMoreHint({ count }: { count: number }) {
  const { t } = useTranslation();

  return (
    <div className='px-2 py-1.5 text-xs text-text-tertiary' data-testid='person-filter-more'>
      {t('grid.field.person.searchForMore', {
        count,
        defaultValue: 'Search to find {{count}} more people',
        defaultValue_one: 'Search to find {{count}} more person',
        defaultValue_other: 'Search to find {{count}} more people',
      })}
    </div>
  );
}

export interface PersonFilterListProps {
  /** Person, Created by or Last edited by: decides which id of a member the filter stores. */
  fieldType: FieldType;
  selectedIds: readonly string[];
  /** A stable callback keeps the rows from re-rendering on every toggle. */
  onToggle: (personId: string) => void;
  optionTestId?: string;
  /** Height limit of the scrolling list. */
  listClassName?: string;
}

/**
 * The people picker of a person filter: a search box above the workspace
 * members. It reads no database context, so the view filter menu and the
 * dashboard's global filter editor share it. The list returns to the top when
 * the search changes.
 */
export function PersonFilterList({
  fieldType,
  selectedIds,
  onToggle,
  optionTestId = 'person-filter-option',
  listClassName = 'max-h-[240px]',
}: PersonFilterListProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const { loading, users, unknownIds, hiddenCount } = usePersonFilterOptions({ fieldType, selectedIds, search });

  return (
    <div>
      <FilterSearchInput value={search} onChange={setSearch} />
      <div
        key={search}
        data-testid='filter-option-results'
        className={cn('appflowy-scroller overflow-y-auto', listClassName)}
      >
        {loading ? (
          <div className='flex items-center justify-center py-4'>
            <Progress />
          </div>
        ) : users.length === 0 && unknownIds.length === 0 ? (
          <div className='py-4 text-center text-sm text-text-tertiary'>{t('grid.field.person.noMatches')}</div>
        ) : (
          <>
            {users.map(({ identifier, user }) => (
              <PersonFilterRow
                key={identifier}
                identifier={identifier}
                label={user.name || user.email || '?'}
                avatarUrl={user.avatar_url}
                checked={selectedIds.includes(identifier)}
                testId={optionTestId}
                onToggle={onToggle}
              />
            ))}
            {unknownIds.map((id) => (
              <PersonFilterRow
                key={id}
                identifier={id}
                label={t('grid.person.unknownUser')}
                unknown
                checked
                testId={optionTestId}
                onToggle={onToggle}
              />
            ))}
            {hiddenCount > 0 && <PersonFilterMoreHint count={hiddenCount} />}
          </>
        )}
      </div>
    </div>
  );
}

export default PersonFilterList;
