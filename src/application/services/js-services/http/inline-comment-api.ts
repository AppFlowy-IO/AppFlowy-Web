import {
  ApplyInlineCommentAnchorUpdateParams,
  CreateInlineCommentParams,
  InlineComment,
  InlineCommentReaction,
  InlineCommentsPage,
  InlineCommentUser,
} from '@/application/inline-comment';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

interface InlineCommentUserResponse {
  uuid: string;
  name: string;
  avatar_url: string | null;
}

interface InlineCommentResponse {
  user: InlineCommentUserResponse | null;
  comment_id: string;
  view_id: string;
  block_id: string | null;
  content: string;
  reply_comment_id: string | null;
  is_resolved: boolean;
  is_deleted: boolean;
  can_be_deleted: boolean;
  created_at: string;
  updated_at: string;
}

interface InlineCommentsResponse {
  comments: InlineCommentResponse[];
  has_more: boolean;
  next_offset: number | null;
}

interface InlineCommentReactionResponse {
  reaction_type: string;
  react_users: InlineCommentUserResponse[];
  comment_id: string;
}

function mapUser(user: InlineCommentUserResponse): InlineCommentUser {
  return {
    uuid: user.uuid,
    name: user.name,
    avatarUrl: user.avatar_url,
  };
}

export function mapInlineComment(comment: InlineCommentResponse): InlineComment {
  return {
    user: comment.user ? mapUser(comment.user) : null,
    commentId: comment.comment_id,
    viewId: comment.view_id,
    blockId: comment.block_id,
    content: comment.content,
    replyCommentId: comment.reply_comment_id,
    isResolved: comment.is_resolved,
    isDeleted: comment.is_deleted,
    canBeDeleted: comment.can_be_deleted,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
  };
}

function getInlineCommentUrl(workspaceId: string, viewId: string) {
  return `/api/workspace/${workspaceId}/document/${viewId}/inline-comment`;
}

export async function getInlineComments(
  workspaceId: string,
  viewId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<InlineCommentsPage> {
  const response = await executeAPIRequest<InlineCommentsResponse>(() =>
    getAxios()?.get<APIResponse<InlineCommentsResponse>>(getInlineCommentUrl(workspaceId, viewId), {
      params: options,
    })
  );

  return {
    comments: response.comments.map(mapInlineComment),
    hasMore: response.has_more,
    nextOffset: response.next_offset,
  };
}

/**
 * The cloud API is paginated even though the desktop repository exposes a single list.
 * Keep pagination here so editor and UI callers cannot accidentally miss an anchor.
 */
export async function getAllInlineComments(workspaceId: string, viewId: string): Promise<InlineComment[]> {
  const comments: InlineComment[] = [];
  const seenOffsets = new Set<number>();
  let nextOffset: number | null = 0;

  while (nextOffset !== null) {
    const offset: number = nextOffset;

    if (seenOffsets.has(offset)) {
      throw new Error('Inline comment pagination returned the same offset twice');
    }

    seenOffsets.add(offset);
    const page: InlineCommentsPage = await getInlineComments(workspaceId, viewId, { limit: 100, offset });

    comments.push(...page.comments);

    if (!page.hasMore || page.nextOffset === null) {
      return comments;
    }

    nextOffset = page.nextOffset;
  }

  return comments;
}

export async function createInlineComment(
  workspaceId: string,
  viewId: string,
  params: CreateInlineCommentParams
): Promise<string | null> {
  const response = await executeAPIRequest<{ comment_id: string } | undefined>(() =>
    getAxios()?.post<APIResponse<{ comment_id: string }>>(getInlineCommentUrl(workspaceId, viewId), {
      content: params.content,
      block_id: params.blockId,
      reply_comment_id: params.replyCommentId,
      mentioned_user_uuids: params.mentionedUserUuids ?? [],
    })
  );

  // During a rolling deploy an older Cloud node can still return the legacy
  // success envelope without data. Top-level creation reconciles that case
  // through the comment list; replies only need the request to succeed.
  return response?.comment_id ?? null;
}

/**
 * Persist an anchor-only Yjs update for a user whose effective access permits
 * comments but not arbitrary document writes. The server validates that this
 * update only formats text with the supplied comment id before applying it.
 */
export async function applyInlineCommentAnchorUpdate(
  workspaceId: string,
  viewId: string,
  params: ApplyInlineCommentAnchorUpdateParams
): Promise<void> {
  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(`${getInlineCommentUrl(workspaceId, viewId)}/anchor`, {
      comment_id: params.commentId,
      doc_state: Array.from(params.update),
    })
  );
}

export async function deleteInlineComment(workspaceId: string, viewId: string, commentId: string): Promise<void> {
  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(getInlineCommentUrl(workspaceId, viewId), {
      data: { comment_id: commentId },
    })
  );
}

export async function resolveInlineComment(
  workspaceId: string,
  viewId: string,
  commentId: string,
  isResolved: boolean
): Promise<void> {
  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(`${getInlineCommentUrl(workspaceId, viewId)}/resolve`, {
      comment_id: commentId,
      is_resolved: isResolved,
    })
  );
}

export async function getInlineCommentReactions(
  workspaceId: string,
  viewId: string,
  commentId?: string
): Promise<InlineCommentReaction[]> {
  const response = await executeAPIRequest<{ reactions: InlineCommentReactionResponse[] }>(() =>
    getAxios()?.get<APIResponse<{ reactions: InlineCommentReactionResponse[] }>>(
      `${getInlineCommentUrl(workspaceId, viewId)}/reaction`,
      { params: commentId ? { comment_id: commentId } : undefined }
    )
  );

  return response.reactions.map((reaction) => ({
    reactionType: reaction.reaction_type,
    reactUsers: reaction.react_users.map(mapUser),
    commentId: reaction.comment_id,
  }));
}

export async function createInlineCommentReaction(
  workspaceId: string,
  viewId: string,
  commentId: string,
  reactionType: string
): Promise<void> {
  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(`${getInlineCommentUrl(workspaceId, viewId)}/reaction`, {
      reaction_type: reactionType,
      comment_id: commentId,
    })
  );
}

export async function deleteInlineCommentReaction(
  workspaceId: string,
  viewId: string,
  commentId: string,
  reactionType: string
): Promise<void> {
  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(`${getInlineCommentUrl(workspaceId, viewId)}/reaction`, {
      data: {
        reaction_type: reactionType,
        comment_id: commentId,
      },
    })
  );
}
