import { Tooltip } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { GlobalComment } from '@/application/comment.type';
import { ReactComponent as ReplyOutlined } from '@/assets/icons/back_arrow.svg';
import { useGlobalCommentContext } from '@/components/global-comment/GlobalComment.hooks';

function ReplyAction({ comment }: { comment: GlobalComment }) {
  const { t } = useTranslation();
  const replyComment = useGlobalCommentContext().replyComment;

  return (
    <Tooltip title={t('globalComment.reply')}>
      <IconButton
        onClick={() => {
          replyComment(comment.commentId);
        }}
        size='small'
        className={'h-full'}
      >
        <ReplyOutlined className={'h-5 w-5'} />
      </IconButton>
    </Tooltip>
  );
}

export default memo(ReplyAction);
