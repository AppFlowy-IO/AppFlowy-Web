import { memo } from 'react';

import { CommentReactions } from '@/application/row-comment.type';
import { cn } from '@/lib/utils';

import { useRowCommentDispatch, useRowCommentState } from './RowCommentContext';

function RowCommentReactions({
  commentId,
  reactions,
}: {
  commentId: string;
  reactions: CommentReactions;
}) {
  const { currentUserId } = useRowCommentState();
  const { toggleReaction } = useRowCommentDispatch();

  const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);

  if (entries.length === 0) return null;

  return (
    <div className={'flex flex-wrap gap-1'}>
      {entries.map(([emoji, users]) => {
        const hasReacted = users.includes(currentUserId);

        return (
          <button
            key={emoji}
            data-testid={`row-comment-reaction-${emoji}`}
            aria-label={`${hasReacted ? 'Remove' : 'Add'} ${emoji} reaction (${users.length})`}
            onClick={() => toggleReaction(commentId, emoji)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
              hasReacted
                ? 'border-border-theme-thick bg-fill-theme-light text-text-theme'
                : 'border-border-primary bg-transparent text-text-secondary hover:bg-fill-content-hover'
            )}
          >
            <span>{emoji}</span>
            <span>{users.length}</span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(RowCommentReactions, (prev, next) => {
  const prevEntries = Object.entries(prev.reactions);
  const nextEntries = Object.entries(next.reactions);

  if (prev.commentId !== next.commentId) return false;
  if (prevEntries.length !== nextEntries.length) return false;

  for (const [emoji, users] of prevEntries) {
    const nextUsers = next.reactions[emoji];

    if (!nextUsers || nextUsers.length !== users.length) return false;
    // Check actual user IDs — needed so hasReacted badge updates correctly
    for (let i = 0; i < users.length; i++) {
      if (users[i] !== nextUsers[i]) return false;
    }
  }

  return true;
});
