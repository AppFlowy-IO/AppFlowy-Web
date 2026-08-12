export interface InlineCommentUser {
  uuid: string;
  name: string;
  avatarUrl: string | null;
}

export interface InlineComment {
  user: InlineCommentUser | null;
  commentId: string;
  viewId: string;
  blockId: string | null;
  content: string;
  replyCommentId: string | null;
  isResolved: boolean;
  isDeleted: boolean;
  canBeDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InlineCommentsPage {
  comments: InlineComment[];
  hasMore: boolean;
  nextOffset: number | null;
}

export interface CreateInlineCommentParams {
  content: string;
  blockId?: string;
  replyCommentId?: string;
  mentionedUserUuids?: string[];
}

export interface ApplyInlineCommentAnchorUpdateParams {
  commentId: string;
  update: Uint8Array;
}

export interface InlineCommentReaction {
  reactionType: string;
  reactUsers: InlineCommentUser[];
  commentId: string;
}
