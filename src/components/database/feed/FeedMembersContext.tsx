import { createContext, ReactNode, useContext, useMemo } from 'react';

import { useDatabaseContext, useReadOnly } from '@/application/database-yjs';
import { resolveUserAttributionUid } from '@/application/database-yjs/attribution';
import { MentionablePerson, User } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import {
  getMentionableUserIndex,
  useMentionableUsersWithAutoFetch,
} from '@/components/database/components/cell/person/useMentionableUsers';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

export interface FeedMember {
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface FeedMembersValue {
  /** Resolve a member by numeric uid (row attribution) or person uuid (comments). */
  resolveMember: (id: string | null | undefined) => FeedMember | undefined;
  currentUser: User | undefined;
  /** Exact numeric uid used for row reactions; null when unknown. */
  currentUid: string | null;
  /** Person uuid (or legacy uid) used as the comment author id. */
  currentCommentAuthorId: string;
  /** Desktop `PageAccessLevelBloc.canComment`: reactions and comments are allowed. */
  canComment: boolean;
}

const EMPTY_VALUE: FeedMembersValue = {
  resolveMember: () => undefined,
  currentUser: undefined,
  currentUid: null,
  currentCommentAuthorId: '',
  canComment: false,
};

const FeedMembersContext = createContext<FeedMembersValue>(EMPTY_VALUE);

function toFeedMember(person: MentionablePerson | undefined): FeedMember | undefined {
  if (!person) return undefined;

  return { name: person.name, email: person.email, avatarUrl: person.avatar_url };
}

/**
 * One member lookup per feed, matching Desktop's `FeedProfileSettingScope`,
 * so cards do not each fetch and index the workspace member list.
 */
export function FeedMembersProvider({ children }: { children: ReactNode }) {
  const readOnly = useReadOnly();
  const { canComment: contextCanComment } = useDatabaseContext();
  const currentUser = useCurrentUserOptional();
  const { users } = useMentionableUsersWithAutoFetch(true);
  const usersByUid = useMemo(() => getMentionableUserIndex(users), [users]);
  const usersByPersonId = useMemo(() => {
    const index = new Map<string, MentionablePerson>();

    users.forEach((user) => {
      if (user.person_id) index.set(user.person_id, user);
    });

    return index;
  }, [users]);

  const value = useMemo<FeedMembersValue>(() => {
    const currentUid = resolveUserAttributionUid(currentUser) ?? canonicalizeUserUid(currentUser?.uid);
    const resolveMember = (id: string | null | undefined): FeedMember | undefined => {
      if (!id) return undefined;

      const byPersonId = usersByPersonId.get(id);

      if (byPersonId) return toFeedMember(byPersonId);

      const uid = canonicalizeUserUid(id);
      const byUid = uid ? usersByUid.get(uid) : undefined;

      if (byUid) return toFeedMember(byUid);

      if (currentUser && (currentUser.uuid === id || currentUser.uid === id || (uid && currentUid === uid))) {
        return {
          name: currentUser.name ?? '',
          email: currentUser.email ?? '',
          avatarUrl: currentUser.avatar,
        };
      }

      return undefined;
    };

    return {
      resolveMember,
      currentUser,
      currentUid,
      currentCommentAuthorId: currentUser?.uuid || currentUser?.uid || '',
      canComment: Boolean(currentUser) && (contextCanComment === true || !readOnly),
    };
  }, [contextCanComment, currentUser, readOnly, usersByPersonId, usersByUid]);

  return <FeedMembersContext.Provider value={value}>{children}</FeedMembersContext.Provider>;
}

export function useFeedMembers(): FeedMembersValue {
  return useContext(FeedMembersContext);
}
