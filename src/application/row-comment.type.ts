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
  id: string;
  url: string;
  name: string;
  file_type: string;
  size: number;
  uploaded_at: number;
}
