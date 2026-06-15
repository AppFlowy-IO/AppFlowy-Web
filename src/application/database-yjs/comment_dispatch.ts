import { useCallback } from 'react';

import { useRowMap } from '@/application/database-yjs/context';
import {
  addComment,
  addCommentReaction,
  deleteComment,
  getCommentsMap,
  parseComment,
  removeCommentReaction,
  resolveComment,
  updateCommentContent,
} from '@/application/database-yjs/row_comment';

export function useAddCommentDispatch(rowId: string) {
  const rowMap = useRowMap();
  const rowDoc = rowMap?.[rowId];

  return useCallback(
    (content: string, authorId: string, parentCommentId?: string) => {
      if (!rowDoc) return;

      return addComment(rowDoc, content, authorId, parentCommentId);
    },
    [rowDoc]
  );
}

export function useUpdateCommentDispatch(rowId: string) {
  const rowMap = useRowMap();
  const rowDoc = rowMap?.[rowId];

  return useCallback(
    (commentId: string, content: string) => {
      if (!rowDoc) return;

      updateCommentContent(rowDoc, commentId, content);
    },
    [rowDoc]
  );
}

export function useDeleteCommentDispatch(rowId: string) {
  const rowMap = useRowMap();
  const rowDoc = rowMap?.[rowId];

  return useCallback(
    (commentId: string) => {
      if (!rowDoc) return;

      deleteComment(rowDoc, commentId);
    },
    [rowDoc]
  );
}

export function useResolveCommentDispatch(rowId: string) {
  const rowMap = useRowMap();
  const rowDoc = rowMap?.[rowId];

  return useCallback(
    (commentId: string, isResolved: boolean, resolvedBy?: string) => {
      if (!rowDoc) return;

      resolveComment(rowDoc, commentId, isResolved, resolvedBy);
    },
    [rowDoc]
  );
}

export function useToggleCommentReactionDispatch(rowId: string) {
  const rowMap = useRowMap();
  const rowDoc = rowMap?.[rowId];

  return useCallback(
    (commentId: string, emoji: string, userId: string) => {
      if (!rowDoc) return;

      const commentsMap = getCommentsMap(rowDoc);

      if (!commentsMap) return;

      const commentMap = commentsMap.get(commentId);

      if (!commentMap) return;

      const comment = parseComment(commentMap);
      const hasReacted = comment.reactions[emoji]?.includes(userId);

      if (hasReacted) {
        removeCommentReaction(rowDoc, commentId, emoji, userId);
      } else {
        addCommentReaction(rowDoc, commentId, emoji, userId);
      }
    },
    [rowDoc]
  );
}
