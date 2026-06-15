import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AddCommentInput from './AddCommentInput';
import { RowCommentProvider, useRowCommentData } from './RowCommentContext';
import RowCommentItem from './RowCommentItem';

const RowCommentListInner = memo(function RowCommentListInner() {
  const { t } = useTranslation();
  const { openComments, loading } = useRowCommentData();

  return (
    <div data-testid={'row-comment-section'} className={'flex flex-col gap-3'} aria-live={'polite'}>
      {/* Header */}
      <h3 className={'text-sm font-medium text-text-tertiary'}>{t('rowComment.comments')}</h3>

      {/* Comment thread: list + input in one continuous column for thread lines */}
      {loading ? (
        <div className={'py-4 text-center text-sm text-text-tertiary'}>...</div>
      ) : (
        <div className={'flex flex-col'}>
          {openComments.map((comment, index) => (
            <RowCommentItem
              key={comment.id}
              comment={comment}
              isFirst={index === 0}
              isLast={false}
            />
          ))}
          <AddCommentInput showThreadLine={openComments.length > 0} />
        </div>
      )}
    </div>
  );
});

export function RowCommentList({ rowId }: { rowId: string }) {
  return (
    <RowCommentProvider rowId={rowId}>
      <RowCommentListInner />
    </RowCommentProvider>
  );
}

export default RowCommentList;
