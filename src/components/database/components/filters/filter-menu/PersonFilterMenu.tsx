import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, PersonFilter, PersonFilterCondition, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as PersonIcon } from '@/assets/icons/person.svg';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import ClearSelectionItem from '@/components/database/components/filters/filter-menu/ClearSelectionItem';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import FilterConditionsSelect from '@/components/database/components/filters/filter-menu/FilterConditionsSelect';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const EMPTY_USER_IDS: readonly string[] = [];

function PersonFilterMenu({ filter }: { filter: PersonFilter }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const updateFilter = useUpdateFilter();
  const { field } = useFieldSelector(filter.fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isAttributionField = fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy;

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
  const mentionableUserOptions = useMemo(
    () =>
      mentionableUsers.flatMap((user) => {
        const identifier = isAttributionField ? canonicalizeUserUid(user.uid) : user.person_id;

        return identifier ? [{ identifier, user }] : [];
      }),
    [isAttributionField, mentionableUsers],
  );

  // Desktop parity: user ids kept in the filter that no longer resolve to a
  // known person still render as selectable "Unknown user" rows.
  const unknownUserIds = useMemo(() => {
    const knownIds = new Set(mentionableUserOptions.map(({ identifier }) => identifier));

    return selectedUserIds.filter((id) => !knownIds.has(id));
  }, [mentionableUserOptions, selectedUserIds]);

  const handleToggleUser = useCallback(
    (userId: string) => {
      if (readOnly) return;
      const next = selectedUserIdSet.has(userId)
        ? selectedUserIds.filter((id) => id !== userId)
        : [...selectedUserIds, userId];

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content: JSON.stringify(next),
      });
    },
    [filter.id, filter.fieldId, readOnly, selectedUserIds, selectedUserIdSet, updateFilter],
  );

  const handleClearSelection = useCallback(() => {
    updateFilter({
      filterId: filter.id,
      fieldId: filter.fieldId,
      content: JSON.stringify([]),
    });
  }, [filter.fieldId, filter.id, updateFilter]);

  return (
    <div className={'flex flex-col gap-1'} data-testid='person-filter'>
      <FieldMenuTitle
        fieldId={filter.fieldId}
        filterId={filter.id}
        renderConditionSelect={<FilterConditionsSelect filter={filter} conditions={conditions} />}
      />
      {showPicker && (
        <div className={'appflowy-scroller max-h-[240px] overflow-y-auto'}>
          {loading ? (
            <div className={'flex items-center justify-center py-4'}>
              <Progress />
            </div>
          ) : mentionableUserOptions.length === 0 ? (
            <div className={'py-4 text-center text-sm text-text-tertiary'}>
              {t('grid.field.person.noMatches')}
            </div>
          ) : (
            <>
              {mentionableUserOptions.map(({ identifier, user }) => {
                const isSelected = selectedUserIdSet.has(identifier);
                const displayName = user.name || user.email || '?';

                return (
                  <button
                    type='button'
                    key={identifier}
                    data-testid={'person-filter-option'}
                    data-checked={isSelected}
                    className={cn(
                      'flex min-h-[32px] w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left',
                      'hover:bg-fill-content-hover',
                    )}
                    onClick={() => handleToggleUser(identifier)}
                  >
                    <Avatar className={'h-5 w-5'}>
                      <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
                      <AvatarFallback className={'text-xs'}>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className={'flex-1 truncate text-sm'}>{displayName}</span>
                    {isSelected && <CheckIcon className={'h-5 w-5 flex-shrink-0 text-icon-info-thick'} />}
                  </button>
                );
              })}
              {unknownUserIds.map((id) => (
                <button
                  type='button'
                  key={id}
                  data-testid={'person-filter-option'}
                  data-checked={true}
                  className={cn(
                    'flex min-h-[32px] w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left',
                    'hover:bg-fill-content-hover',
                  )}
                  onClick={() => handleToggleUser(id)}
                >
                  <PersonIcon className={'h-5 w-5 text-icon-primary'} />
                  <span className={'flex-1 truncate text-sm'}>{t('grid.person.unknownUser')}</span>
                  <CheckIcon className={'h-5 w-5 flex-shrink-0 text-icon-info-thick'} />
                </button>
              ))}
            </>
          )}
          {selectedUserIds.length > 0 && <ClearSelectionItem onClear={handleClearSelection} />}
        </div>
      )}
    </div>
  );
}

export default PersonFilterMenu;
