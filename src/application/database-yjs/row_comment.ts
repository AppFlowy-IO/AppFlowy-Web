import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { RowCommentKey } from '@/application/database-yjs/database.type';
import { CommentReactions, RowComment } from '@/application/row-comment.type';
import { CollabOrigin, YDoc, YjsEditorKey, YSharedRoot } from '@/application/types';

export function getCommentsMap(rowDoc: YDoc): Y.Map<Y.Map<unknown>> | undefined {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;

  return rowSharedRoot.get(YjsEditorKey.comment);
}

export function ensureCommentsMap(rowDoc: YDoc): Y.Map<Y.Map<unknown>> {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  let commentsMap = rowSharedRoot.get(YjsEditorKey.comment);

  if (!commentsMap) {
    commentsMap = new Y.Map<Y.Map<unknown>>();
    rowDoc.transact(() => {
      rowSharedRoot.set(YjsEditorKey.comment, commentsMap);
    }, CollabOrigin.Local);
  }

  return commentsMap;
}

export function parseComment(commentMap: Y.Map<unknown>): RowComment {
  const reactionsStr = (commentMap.get(RowCommentKey.Reactions) as string) || '{}';
  const attachmentsStr = (commentMap.get(RowCommentKey.Attachments) as string) || '[]';

  let reactions: CommentReactions = {};
  let attachments: RowComment['attachments'] = [];

  try {
    reactions = JSON.parse(reactionsStr);
  } catch (e) {
    console.warn('[RowComment] Failed to parse reactions:', e);
  }

  try {
    attachments = JSON.parse(attachmentsStr);
  } catch (e) {
    console.warn('[RowComment] Failed to parse attachments:', e);
  }

  return {
    id: (commentMap.get(RowCommentKey.Id) as string) || '',
    parentCommentId: (commentMap.get(RowCommentKey.ParentCommentId) as string) || null,
    content: (commentMap.get(RowCommentKey.Content) as string) || '',
    authorId: String(commentMap.get(RowCommentKey.AuthorId) ?? ''),
    createdAt: Number(commentMap.get(RowCommentKey.CreatedAt) ?? 0),
    updatedAt: Number(commentMap.get(RowCommentKey.UpdatedAt) ?? 0),
    isResolved: Boolean(commentMap.get(RowCommentKey.IsResolved)),
    resolvedBy: (commentMap.get(RowCommentKey.ResolvedBy) as string) || null,
    resolvedAt: commentMap.get(RowCommentKey.ResolvedAt) !== null
      ? Number(commentMap.get(RowCommentKey.ResolvedAt))
      : null,
    reactions,
    attachments,
  };
}

export function getRowComments(rowDoc: YDoc): RowComment[] {
  const commentsMap = getCommentsMap(rowDoc);

  if (!commentsMap) return [];

  const comments: RowComment[] = [];

  commentsMap.forEach((commentMap) => {
    comments.push(parseComment(commentMap));
  });

  return comments;
}

export function addComment(
  rowDoc: YDoc,
  content: string,
  authorId: string,
  parentCommentId?: string
): string {
  const commentsMap = ensureCommentsMap(rowDoc);
  const id = uuidv4();
  const now = dayjs().unix();

  rowDoc.transact(() => {
    const commentMap = new Y.Map<unknown>();

    commentMap.set(RowCommentKey.Id, id);
    commentMap.set(RowCommentKey.ParentCommentId, parentCommentId || '');
    commentMap.set(RowCommentKey.Content, content);
    commentMap.set(RowCommentKey.AuthorId, authorId);
    commentMap.set(RowCommentKey.CreatedAt, now);
    commentMap.set(RowCommentKey.UpdatedAt, now);
    commentMap.set(RowCommentKey.IsResolved, false);
    commentMap.set(RowCommentKey.ResolvedBy, '');
    commentMap.set(RowCommentKey.ResolvedAt, 0);
    commentMap.set(RowCommentKey.Reactions, '{}');
    commentMap.set(RowCommentKey.Attachments, '[]');

    commentsMap.set(id, commentMap);
  }, CollabOrigin.Local);

  return id;
}

export function updateCommentContent(
  rowDoc: YDoc,
  commentId: string,
  content: string
): void {
  const commentsMap = getCommentsMap(rowDoc);

  if (!commentsMap) return;

  const commentMap = commentsMap.get(commentId);

  if (!commentMap) return;

  rowDoc.transact(() => {
    commentMap.set(RowCommentKey.Content, content);
    commentMap.set(RowCommentKey.UpdatedAt, dayjs().unix());
  }, CollabOrigin.Local);
}

export function deleteComment(rowDoc: YDoc, commentId: string): void {
  const commentsMap = getCommentsMap(rowDoc);

  if (!commentsMap) return;

  // Collect child IDs first to avoid mutating the map during iteration
  const childIds: string[] = [];

  commentsMap.forEach((commentMap, id) => {
    if ((commentMap.get(RowCommentKey.ParentCommentId) as string) === commentId) {
      childIds.push(id);
    }
  });

  rowDoc.transact(() => {
    for (const id of childIds) {
      commentsMap.delete(id);
    }

    commentsMap.delete(commentId);
  }, CollabOrigin.Local);
}

export function resolveComment(
  rowDoc: YDoc,
  commentId: string,
  isResolved: boolean,
  resolvedBy?: string
): void {
  const commentsMap = getCommentsMap(rowDoc);

  if (!commentsMap) return;

  const commentMap = commentsMap.get(commentId);

  if (!commentMap) return;

  rowDoc.transact(() => {
    commentMap.set(RowCommentKey.IsResolved, isResolved);
    commentMap.set(RowCommentKey.ResolvedBy, isResolved ? (resolvedBy || '') : '');
    commentMap.set(RowCommentKey.ResolvedAt, isResolved ? dayjs().unix() : 0);
    commentMap.set(RowCommentKey.UpdatedAt, dayjs().unix());
  }, CollabOrigin.Local);
}

export function addCommentReaction(
  rowDoc: YDoc,
  commentId: string,
  emoji: string,
  userId: string
): void {
  const commentsMap = getCommentsMap(rowDoc);

  if (!commentsMap) return;

  const commentMap = commentsMap.get(commentId);

  if (!commentMap) return;

  const reactionsStr = (commentMap.get(RowCommentKey.Reactions) as string) || '{}';
  let reactions: CommentReactions = {};

  try {
    reactions = JSON.parse(reactionsStr);
  } catch (e) {
    console.warn('[RowComment] Failed to parse reactions for add:', e);
  }

  const users = reactions[emoji] || [];

  if (!users.includes(userId)) {
    users.push(userId);
  }

  reactions[emoji] = users;

  rowDoc.transact(() => {
    commentMap.set(RowCommentKey.Reactions, JSON.stringify(reactions));
    commentMap.set(RowCommentKey.UpdatedAt, dayjs().unix());
  }, CollabOrigin.Local);
}

export function removeCommentReaction(
  rowDoc: YDoc,
  commentId: string,
  emoji: string,
  userId: string
): void {
  const commentsMap = getCommentsMap(rowDoc);

  if (!commentsMap) return;

  const commentMap = commentsMap.get(commentId);

  if (!commentMap) return;

  const reactionsStr = (commentMap.get(RowCommentKey.Reactions) as string) || '{}';
  let reactions: CommentReactions = {};

  try {
    reactions = JSON.parse(reactionsStr);
  } catch (e) {
    console.warn('[RowComment] Failed to parse reactions for remove:', e);
  }

  const users = reactions[emoji] || [];
  const idx = users.indexOf(userId);

  if (idx !== -1) {
    users.splice(idx, 1);
  }

  if (users.length === 0) {
    delete reactions[emoji];
  } else {
    reactions[emoji] = users;
  }

  rowDoc.transact(() => {
    commentMap.set(RowCommentKey.Reactions, JSON.stringify(reactions));
    commentMap.set(RowCommentKey.UpdatedAt, dayjs().unix());
  }, CollabOrigin.Local);
}
