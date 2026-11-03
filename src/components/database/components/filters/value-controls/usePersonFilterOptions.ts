import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { MentionablePerson } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';

/**
 * How many people a person filter lists at once. A workspace can have
 * thousands of members and every row loads an avatar, so the list stops here
 * and the search box narrows it down. Selected people are always listed.
 */
export const PERSON_FILTER_LIST_LIMIT = 50;

export interface PersonFilterOption {
  /** What the filter stores for this person (see `usePersonFilterOptions`). */
  identifier: string;
  user: MentionablePerson;
}

interface SearchablePersonFilterOption extends PersonFilterOption {
  searchText: string;
}

export interface PersonFilterOptions {
  /** The member list is being fetched and there is nothing to show yet. */
  loading: boolean;
  /** Every member the filter can store, whatever the search: for a summary of the selection. */
  members: PersonFilterOption[];
  /** The people to list, in workspace order. */
  users: PersonFilterOption[];
  /**
   * Selected ids that no longer resolve to a workspace member (desktop parity:
   * they stay listed as "Unknown user" so they can be removed).
   */
  unknownIds: string[];
  /** Matching people left out by `PERSON_FILTER_LIST_LIMIT`. */
  hiddenCount: number;
}

/**
 * The people a person filter offers. A Person property stores workspace
 * person ids; Created by / Last edited by store user uids.
 *
 * One implementation for every person filter editor (the view filter menu,
 * the advanced panel, the dashboard's global filter editor): the search
 * matches name and email, unknown selected ids are searched as
 * "Unknown user <id>", and the list is capped.
 */
export function usePersonFilterOptions({
  fieldType,
  selectedIds,
  search,
  enabled = true,
}: {
  fieldType: FieldType;
  selectedIds: readonly string[];
  search: string;
  /** `false` skips the member request (the picker is not shown). */
  enabled?: boolean;
}): PersonFilterOptions {
  const { t } = useTranslation();
  const isAttribution = fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy;
  const { users: members, loading } = useMentionableUsersWithAutoFetch(enabled);
  const options = useMemo(
    () =>
      members.flatMap((user): SearchablePersonFilterOption[] => {
        const identifier = isAttribution ? canonicalizeUserUid(user.uid) : user.person_id;

        if (!identifier) return [];
        return [{ identifier, user, searchText: `${user.name ?? ''} ${user.email ?? ''}`.toLocaleLowerCase() }];
      }),
    [isAttribution, members]
  );
  const unknownUserLabel = t('grid.person.unknownUser');

  return useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    const selected = new Set(selectedIds);
    const known = new Set(options.map(({ identifier }) => identifier));
    const matches = keyword ? options.filter(({ searchText }) => searchText.includes(keyword)) : options;
    const users = matches.filter(
      ({ identifier }, index) => index < PERSON_FILTER_LIST_LIMIT || selected.has(identifier)
    );

    return {
      loading: loading && options.length === 0,
      members: options,
      users,
      unknownIds: selectedIds.filter(
        (id) => !known.has(id) && `${unknownUserLabel} ${id}`.toLocaleLowerCase().includes(keyword)
      ),
      hiddenCount: matches.length - users.length,
    };
  }, [loading, options, search, selectedIds, unknownUserLabel]);
}
