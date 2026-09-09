import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AddCommentInput from './AddCommentInput';
import { RowCommentProvider, useRowCommentData } from './RowCommentContext';
import RowCommentItem from './RowCommentItem';

interface CommentListOptions {
  includeResolved?: boolean;
}

const RowCommentListInner = memo(function RowCommentListInner({
  includeResolved = false,
}: CommentListOptions) {
  const { t } = useTranslation();
  const { comments, openComments, loading } = useRowCommentData();
  const visibleComments = includeResolved ? comments : openComments;

  return (
    <div data-testid={'row-comment-section'} className={'flex flex-col gap-3'} aria-live={'polite'}>
      {/* Header */}
      <h3 className={'text-sm font-medium text-text-tertiary'}>{t('rowComment.comments')}</h3>

      {/* Comment thread: list + input in one continuous column for thread lines */}
      {loading ? (
        <div className={'py-4 text-center text-sm text-text-tertiary'}>...</div>
      ) : (
        <div className={'flex flex-col'}>
          {visibleComments.map((comment, index) => (
            <RowCommentItem
              key={comment.id}
              comment={comment}
              isFirst={index === 0}
              showResolveAction={includeResolved ? !comment.parentCommentId : index === 0}
            />
          ))}
          <AddCommentInput showThreadLine={visibleComments.length > 0} />
        </div>
      )}
    </div>
  );
});

export function RowCommentList({ rowId, ...options }: { rowId: string } & CommentListOptions) {
  return (
    <RowCommentProvider rowId={rowId}>
      <RowCommentListInner {...options} />
    </RowCommentProvider>
  );
}

export default RowCommentList;
