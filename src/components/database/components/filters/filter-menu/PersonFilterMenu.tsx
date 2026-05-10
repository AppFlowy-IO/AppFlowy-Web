import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PersonFilter, PersonFilterCondition } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const EMPTY_USER_IDS: readonly string[] = [];

function PersonFilterMenu({ filter }: { filter: PersonFilter }) {
  const { t } = useTranslation();
  const updateFilter = useUpdateFilter();

  const conditions = useMemo(
    () => [
      { value: PersonFilterCondition.PersonContains, text: t('grid.personFilter.contains') },
      { value: PersonFilterCondition.PersonDoesNotContain, text: t('grid.personFilter.doesNotContain') },
      { value: PersonFilterCondition.PersonIsEmpty, text: t('grid.personFilter.isEmpty') },
      { value: PersonFilterCondition.PersonIsNotEmpty, text: t('grid.personFilter.isNotEmpty') },
    ],
    [t],
  );

  const showPicker =
    filter.condition !== PersonFilterCondition.PersonIsEmpty &&
    filter.condition !== PersonFilterCondition.PersonIsNotEmpty;

  const selectedUserIds = filter.userIds ?? EMPTY_USER_IDS;
  const selectedUserIdSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);

  // Skip the API call when the condition doesn't need the picker (empty/notempty).
  const { users: mentionableUsers, loading } = useMentionableUsersWithAutoFetch(showPicker);

  const handleToggleUser = useCallback(
    (userId: string) => {
      const next = selectedUserIdSet.has(userId)
        ? selectedUserIds.filter((id) => id !== userId)
        : [...selectedUserIds, userId];

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: JSON.stringify(next),
      });
    },
    [filter.id, filter.fieldId, selectedUserIds, selectedUserIdSet, updateFilter],
  );

  return (
    <div className={'flex flex-col'} data-testid='person-filter'>
      <FieldMenuTitle
        fieldId={filter.fieldId}
        filterId={filter.id}
        renderConditionSelect={<FilterConditionsSelect filter={filter} conditions={conditions} />}
      />
      {showPicker && (
        <div className={'max-h-[240px] overflow-y-auto p-1'}>
          {loading ? (
            <div className={'flex items-center justify-center py-4'}>
              <Progress />
            </div>
          ) : !mentionableUsers || mentionableUsers.length === 0 ? (
            <div className={'py-4 text-center text-sm text-text-tertiary'}>
              {t('grid.field.person.noMatches')}
            </div>
          ) : (
            mentionableUsers.map((user) => {
              const isSelected = selectedUserIdSet.has(user.person_id);
              const displayName = user.name || user.email || '?';

              return (
                <div
                  key={user.person_id}
                  data-testid={'person-filter-option'}
                  data-checked={isSelected}
                  className={cn(
                    'flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-2 py-1',
                    'hover:bg-fill-content-hover',
                    isSelected && 'bg-fill-content-hover',
                  )}
                  onClick={() => handleToggleUser(user.person_id)}
                >
                  <Avatar className={'h-6 w-6'}>
                    <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
                    <AvatarFallback className={'text-xs'}>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className={'flex flex-1 flex-col overflow-hidden'}>
                    <span className={'truncate text-sm'}>{user.name || user.email}</span>
                    {user.name && user.email && (
                      <span className={'truncate text-xs text-text-tertiary'}>{user.email}</span>
                    )}
                  </div>
                  {isSelected && <CheckIcon className={'h-4 w-4 flex-shrink-0 text-text-action'} />}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default PersonFilterMenu;
