import { useCallback } from 'react';
import { validate as isUuid } from 'uuid';

import { useDatabaseContext, useRowMap } from '@/application/database-yjs/context';
import {
  addComment,
  addCommentReaction,
  deleteComment,
  getCommentsMap,
  getRowComments,
  parseComment,
  removeCommentReaction,
  resolveComment,
  updateCommentContent,
} from '@/application/database-yjs/row_comment';
import { CommentAttachment } from '@/application/row-comment.type';
import { RowService } from '@/application/services/domains';
import { YDoc } from '@/application/types';
import { Log } from '@/utils/log';

function mentionedUserUuids(content: string): string[] {
  return [...new Set([...content.matchAll(/@\[[^\]\n]+\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter(isUuid))];
}

function useNotifyRowComment(rowId: string) {
  const { workspaceId, activeViewId, databasePageId } = useDatabaseContext();

  return useCallback(
    (
      rowDoc: YDoc,
      commentId: string,
      content: string,
      {
        authorId,
        parentCommentId,
        previousContent = '',
      }: {
        authorId?: string;
        parentCommentId?: string;
        previousContent?: string;
      } = {}
    ) => {
      const previousMentions = new Set(mentionedUserUuids(previousContent));
      const mentionedUsers = mentionedUserUuids(content).filter((id) => !previousMentions.has(id));
      const participants = parentCommentId
        ? [
            ...new Set(
              getRowComments(rowDoc)
                .filter((comment) => comment.id === parentCommentId || comment.parentCommentId === parentCommentId)
                .map((comment) => comment.authorId)
                .filter((id) => id !== authorId && isUuid(id))
            ),
          ]
        : [];

      if (!workspaceId || (!mentionedUsers.length && !participants.length)) return;
      void RowService.notifyComment(workspaceId, activeViewId || databasePageId, rowId, {
        comment_id: commentId,
        content: content.slice(0, 2000),
        parent_comment_id: parentCommentId,
        mentioned_user_uuids: mentionedUsers,
        reply_participant_uuids: participants,
      }).catch((error) => Log.warn('[RowComment] Notification failed; comment remains saved', error));
    },
    [workspaceId, activeViewId, databasePageId, rowId]
  );
}

export function useAddCommentDispatch(rowId: string) {
  const notify = useNotifyRowComment(rowId);
  const rowMap = useRowMap();
  const rowDoc = rowMap?.[rowId];

  return useCallback(
    (content: string, authorId: string, parentCommentId?: string, attachments?: CommentAttachment[]) => {
      if (!rowDoc) return;

      const id = addComment(rowDoc, content, authorId, parentCommentId, attachments);

      notify(rowDoc, id, content || attachments?.map((attachment) => attachment.name).join(', ') || '', {
        authorId,
        parentCommentId,
      });
      return id;
    },
    [rowDoc, notify]
  );
}

export function useUpdateCommentDispatch(rowId: string) {
  const notify = useNotifyRowComment(rowId);
  const rowMap = useRowMap();
  const rowDoc = rowMap?.[rowId];

  return useCallback(
    (commentId: string, content: string) => {
      if (!rowDoc) return;
      const comment = getCommentsMap(rowDoc)?.get(commentId);

      if (!comment) return;
      const previousContent = parseComment(comment).content;

      updateCommentContent(rowDoc, commentId, content);
      notify(rowDoc, commentId, content, { previousContent });
    },
    [rowDoc, notify]
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
