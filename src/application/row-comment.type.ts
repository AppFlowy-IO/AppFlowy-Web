export interface RowComment {
  id: string;
  parentCommentId: string | null;
  content: string;
  authorId: string;
  createdAt: number;
  updatedAt: number;
  isResolved: boolean;
  resolvedBy: string | null;
  resolvedAt: number | null;
  reactions: CommentReactions;
  attachments: CommentAttachment[];
}

export type CommentReactions = Record<string, string[]>;

export interface CommentAttachment {
  url: string;
  name: string;
  type: string;
}
