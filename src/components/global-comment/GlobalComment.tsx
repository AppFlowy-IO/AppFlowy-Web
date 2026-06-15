import { Divider } from '@mui/material';
import CircularProgress from '@mui/material/CircularProgress';
import { useTranslation } from 'react-i18next';

import { AddCommentWrapper } from '@/components/global-comment/add-comment';
import CommentList from '@/components/global-comment/CommentList';
import { useGlobalCommentContext } from '@/components/global-comment/GlobalComment.hooks';

function GlobalComment({ disableFixedAddComment }: { disableFixedAddComment?: boolean }) {
  const { t } = useTranslation();
  const { loading, comments } = useGlobalCommentContext();

  return (
    <div
      data-testid="global-comment"
      className={'mb-[480px] mt-16 flex h-fit w-full justify-center max-md:mb-[100px]'}
    >
      <div
        className={
          'flex w-[952px] min-w-0 max-w-full transform flex-col gap-2 px-24 transition-all duration-300 ease-in-out max-sm:px-6'
        }
      >
        <div className={'text-[24px]'}>{t('globalComment.comments')}</div>
        <Divider />
        <AddCommentWrapper disableFixedAddComment={disableFixedAddComment} />

        {loading && !comments?.length ? (
          <div className={'flex h-[200px] w-full items-center justify-center'}>
            <CircularProgress />
          </div>
        ) : (
          <CommentList />
        )}
      </div>
    </div>
  );
}

export default GlobalComment;
