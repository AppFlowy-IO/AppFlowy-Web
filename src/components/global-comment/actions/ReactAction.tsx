import { IconButton, Tooltip } from '@mui/material';
import React, { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { GlobalComment } from '@/application/comment.type';
import { ReactComponent as EmojiIcon } from '@/assets/icons/add_emoji.svg';
import { EmojiPicker } from '@/components/_shared/emoji-picker';
import { Popover } from '@/components/_shared/popover';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import { useGlobalCommentContext } from '@/components/global-comment/GlobalComment.hooks';
import { useIsAuthenticatedOptional, useOpenLoginModalOptional } from '@/components/main/app.hooks';

function ReactAction ({ comment }: { comment: GlobalComment }) {
  const { toggleReaction } = useGlobalCommentContext();
  const { t } = useTranslation();
  const isAuthenticated = useIsAuthenticatedOptional();
  const openLoginModal = useOpenLoginModalOptional();
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleOpen = () => {
    if (!isAuthenticated && openLoginModal) {
      const url = window.location.href + '#comment-' + comment.commentId;

      openLoginModal(url);
      return;
    }

    setOpen(true);
  };

  const handlePickEmoji = useCallback(
    (emoji: string) => {
      toggleReaction(comment.commentId, emoji);
      handleClose();
    },
    [comment.commentId, handleClose, toggleReaction],
  );

  return (
    <>
      <Tooltip title={t('globalComment.addReaction')}>
        <IconButton
          ref={ref}
          onClick={handleOpen}
          size="small"
          className={'h-full'}
        >
          <EmojiIcon />
        </IconButton>
      </Tooltip>
      {open && (
        <Popover
          anchorEl={ref.current}
          open={open}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          sx={{
            '& .MuiPopover-paper': {
              width: 402,
              paddingTop: '12px',
            },
          }}
        >
          <Suspense fallback={<ComponentLoading />}>
            <EmojiPicker
              onEmojiSelect={handlePickEmoji}
            />
          </Suspense>
        </Popover>
      )}
    </>
  );
}

export default memo(ReactAction);
