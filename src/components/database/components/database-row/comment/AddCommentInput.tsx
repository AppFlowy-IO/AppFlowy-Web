import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { CommentComposer } from './CommentComposer';
import MemberAvatar from './MemberAvatar';
import { useRowCommentDispatch, useRowCommentState } from './RowCommentContext';

function AddCommentInput({
  parentCommentId,
  showThreadLine = false,
}: {
  parentCommentId?: string;
  showThreadLine?: boolean;
}) {
  const { t } = useTranslation();
  const { addComment, setReplyingCommentId } = useRowCommentDispatch();
  const { currentUserId, members, canComment } = useRowCommentState();
  const mentionableUsers = useMemo(() => [...new Set(members.values())], [members]);

  if (!canComment) return null;

  return (
    <div className='flex gap-3 px-2 py-2'>
      {!parentCommentId && (
        <div className='-my-2 flex w-8 shrink-0 flex-col items-center'>
          <div className={cn('w-px flex-1', showThreadLine ? 'bg-border-primary' : 'bg-transparent')} />
          <div className='shrink-0 py-1'>
            <MemberAvatar uid={currentUserId} size='md' />
          </div>
          <div className='w-px flex-1 bg-transparent' />
        </div>
      )}
      <CommentComposer
        placeholder={t('rowComment.addReply')}
        members={mentionableUsers}
        testIds={{
          collapsed: 'row-comment-collapsed-input',
          input: 'row-comment-input',
          submit: 'row-comment-send-button',
          attachment: 'row-comment-attachment-input',
        }}
        onSubmit={(content, attachments) => addComment(content, parentCommentId, attachments)}
        onCancel={parentCommentId ? () => setReplyingCommentId(null) : undefined}
      />
    </div>
  );
}

export default memo(AddCommentInput);
