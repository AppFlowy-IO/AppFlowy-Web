import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import {
  useAddCommentDispatch,
  useDeleteCommentDispatch,
  useResolveCommentDispatch,
  useToggleCommentReactionDispatch,
  useUpdateCommentDispatch,
} from '@/application/database-yjs/comment_dispatch';
import { useRowComments } from '@/application/database-yjs/comment_selector';
import { RowComment } from '@/application/row-comment.type';
import { MentionablePerson, User } from '@/application/types';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import { useCurrentUser } from '@/components/main/app.hooks';

/** Volatile comment data — changes on every Yjs update */
interface RowCommentDataValue {
  comments: RowComment[];
  openComments: RowComment[];
  loading: boolean;
}

/** Stable UI state — user info, members, editing state */
interface RowCommentUIValue {
  editingCommentId: string | null;
  replyingCommentId: string | null;
  currentUserId: string;
  currentUserUid: string;
  currentUser: User | undefined;
  members: Map<string, MentionablePerson>;
}

interface RowCommentDispatchValue {
  addComment: (content: string, parentCommentId?: string) => void;
  updateComment: (commentId: string, content: string) => void;
  deleteComment: (commentId: string) => void;
  resolveComment: (commentId: string, isResolved: boolean) => void;
  toggleReaction: (commentId: string, emoji: string) => void;
  setEditingCommentId: (id: string | null) => void;
  setReplyingCommentId: (id: string | null) => void;
}

const RowCommentDataContext = createContext<RowCommentDataValue | null>(null);
const RowCommentUIContext = createContext<RowCommentUIValue | null>(null);
const RowCommentDispatchContext = createContext<RowCommentDispatchValue | null>(null);

export function RowCommentProvider({ rowId, children }: { rowId: string; children: React.ReactNode }) {
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [replyingCommentId, setReplyingCommentId] = useState<string | null>(null);
  const { comments, openComments, loading, refresh } = useRowComments(rowId);
  const currentUser = useCurrentUser();
  // Use uuid (matches person_id in mentionable users) for new comments.
  // Keep uid for backwards compatibility with existing comments.
  const currentUserId = currentUser?.uuid || currentUser?.uid || '';
  const currentUserUid = currentUser?.uid || '';

  // Load workspace members for avatar/name resolution
  const { users: mentionableUsers } = useMentionableUsersWithAutoFetch(true);

  const members = useMemo(() => {
    const map = new Map<string, MentionablePerson>();

    for (const user of mentionableUsers) {
      // Key by person_id (uuid) — matches author_id stored in comments
      map.set(user.person_id, user);
    }

    // Also key the current user by their numeric uid for backwards compat
    // (old comments stored uid instead of uuid as authorId)
    if (currentUserUid && currentUser?.uuid) {
      const currentMember = map.get(currentUser.uuid);

      if (currentMember && !map.has(currentUserUid)) {
        map.set(currentUserUid, currentMember);
      }
    }

    return map;
  }, [mentionableUsers, currentUserUid, currentUser?.uuid]);

  const addCommentDispatch = useAddCommentDispatch(rowId);
  const updateCommentDispatch = useUpdateCommentDispatch(rowId);
  const deleteCommentDispatch = useDeleteCommentDispatch(rowId);
  const resolveCommentDispatch = useResolveCommentDispatch(rowId);
  const toggleReactionDispatch = useToggleCommentReactionDispatch(rowId);

  const addComment = useCallback(
    (content: string, parentCommentId?: string) => {
      if (!content.trim()) return;
      addCommentDispatch(content, currentUserId, parentCommentId);
      setReplyingCommentId(null);
    },
    [addCommentDispatch, currentUserId]
  );

  const updateComment = useCallback(
    (commentId: string, content: string) => {
      if (!content.trim()) return;
      updateCommentDispatch(commentId, content);
      setEditingCommentId(null);
    },
    [updateCommentDispatch]
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      deleteCommentDispatch(commentId);
    },
    [deleteCommentDispatch]
  );

  const resolveComment = useCallback(
    (commentId: string, isResolved: boolean) => {
      resolveCommentDispatch(commentId, isResolved, currentUserId);
      // Explicitly refresh to ensure Yjs state propagates to React
      // (observeDeep may not reliably fire for nested property changes in Yjs 14 pre-release)
      requestAnimationFrame(() => refresh());
    },
    [resolveCommentDispatch, currentUserId, refresh]
  );

  const toggleReaction = useCallback(
    (commentId: string, emoji: string) => {
      toggleReactionDispatch(commentId, emoji, currentUserId);
    },
    [toggleReactionDispatch, currentUserId]
  );

  const dataValue = useMemo(
    () => ({ comments, openComments, loading }),
    [comments, openComments, loading]
  );

  const uiValue = useMemo(
    () => ({
      editingCommentId,
      replyingCommentId,
      currentUserId,
      currentUserUid,
      currentUser,
      members,
    }),
    [editingCommentId, replyingCommentId, currentUserId, currentUserUid, currentUser, members]
  );

  const dispatchValue = useMemo(
    () => ({
      addComment,
      updateComment,
      deleteComment,
      resolveComment,
      toggleReaction,
      setEditingCommentId,
      setReplyingCommentId,
    }),
    [addComment, updateComment, deleteComment, resolveComment, toggleReaction]
  );

  return (
    <RowCommentDispatchContext.Provider value={dispatchValue}>
      <RowCommentUIContext.Provider value={uiValue}>
        <RowCommentDataContext.Provider value={dataValue}>
          {children}
        </RowCommentDataContext.Provider>
      </RowCommentUIContext.Provider>
    </RowCommentDispatchContext.Provider>
  );
}

/** Hook for volatile comment data (comments list, loading state) */
export function useRowCommentData() {
  const context = useContext(RowCommentDataContext);

  if (!context) {
    throw new Error('useRowCommentData must be used within a RowCommentProvider');
  }

  return context;
}

/** Hook for stable UI state (user info, members, editing state) */
export function useRowCommentState() {
  const context = useContext(RowCommentUIContext);

  if (!context) {
    throw new Error('useRowCommentState must be used within a RowCommentProvider');
  }

  return context;
}

export function useRowCommentDispatch() {
  const context = useContext(RowCommentDispatchContext);

  if (!context) {
    throw new Error('useRowCommentDispatch must be used within a RowCommentProvider');
  }

  return context;
}
