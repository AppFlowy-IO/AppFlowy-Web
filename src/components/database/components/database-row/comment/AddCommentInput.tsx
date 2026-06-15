import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AttachmentIcon } from '@/assets/icons/attachment.svg';
import { ReactComponent as AtIcon } from '@/assets/icons/at.svg';
import { ReactComponent as ArrowUpIcon } from '@/assets/icons/arrow_up.svg';
import { Button } from '@/components/ui/button';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import MemberAvatar from './MemberAvatar';
import { useRowCommentDispatch, useRowCommentState } from './RowCommentContext';

function AddCommentInput({ parentCommentId, showThreadLine = false }: { parentCommentId?: string; showThreadLine?: boolean }) {
  const { t } = useTranslation();
  const { addComment, setReplyingCommentId } = useRowCommentDispatch();
  const { currentUserId } = useRowCommentState();
  const [content, setContent] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isReply = !!parentCommentId;
  const collapsed = !focused && !content;
  const canSend = content.trim().length > 0;

  // Focus the textarea when expanded
  useEffect(() => {
    if (focused && inputRef.current) {
      inputRef.current.focus();
    }
  }, [focused]);

  const handleSubmit = useCallback(() => {
    if (!content.trim()) return;

    addComment(content, parentCommentId);
    setContent('');
    setFocused(false);
    setReplyingCommentId(null);
  }, [content, addComment, parentCommentId, setReplyingCommentId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        handleSubmit();
      }

      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
        setContent('');
        setFocused(false);
        setReplyingCommentId(null);
        inputRef.current?.blur();
      }
    },
    [handleSubmit, setReplyingCommentId]
  );

  const handleBlur = useCallback(() => {
    if (!content) {
      setFocused(false);
    }
  }, [content]);

  const handleCancel = useCallback(() => {
    setContent('');
    setFocused(false);
    setReplyingCommentId(null);
    inputRef.current?.blur();
  }, [setReplyingCommentId]);

  return (
    <div className={'flex gap-3 px-2 py-2'}>
      {/* Avatar column — matches RowCommentItem layout */}
      {!isReply && (
        <div className={'-my-2 flex w-8 flex-shrink-0 flex-col items-center'}>
          <div className={cn('w-px flex-1', showThreadLine ? 'bg-border-primary' : 'bg-transparent')} />
          <div className={'flex-shrink-0 py-1'}>
            <MemberAvatar uid={currentUserId} size={'md'} />
          </div>
          <div className={'w-px flex-1 bg-transparent'} />
        </div>
      )}

      {/* Collapsed state: placeholder click target */}
      {collapsed ? (
        <div
          role={'button'}
          tabIndex={0}
          onClick={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setFocused(true);
            }
          }}
          data-testid={'row-comment-collapsed-input'}
          className={'flex-1 cursor-text self-center rounded text-sm text-text-tertiary focus:outline-none focus:ring-2 focus:ring-border-theme-thick'}
        >
          {t('rowComment.addReply')}
        </div>
      ) : (
        /* Expanded state: textarea + action icons */
        <div className={'flex flex-1 items-end gap-1'}>
          <div
            className={cn(
              'flex-1 rounded-lg border px-3 py-1.5 transition-colors',
              focused ? 'border-border-theme-thick' : 'border-border-primary'
            )}
          >
            <TextareaAutosize
              ref={inputRef}
              data-testid={'row-comment-input'}
              variant={'ghost'}
              autoFocus
              minRows={1}
              maxRows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder={t('rowComment.addReply')}
              className={'w-full bg-transparent'}
            />
          </div>

          {/* Action icons */}
          <div className={'flex items-center gap-0.5'}>
            {isReply && (
              <Button variant={'ghost'} size={'sm'} onClick={handleCancel}>
                {t('button.cancel')}
              </Button>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={t('rowComment.attachFile')}
                  className={'rounded p-1 text-text-tertiary hover:text-text-primary disabled:opacity-40'}
                  disabled
                >
                  <AttachmentIcon className={'h-5 w-5'} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('rowComment.attachFile')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={t('rowComment.mention')}
                  className={'rounded p-1 text-text-tertiary hover:text-text-primary disabled:opacity-40'}
                  disabled
                >
                  <AtIcon className={'h-5 w-5'} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('rowComment.mention')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-testid={'row-comment-send-button'}
                  aria-label={t('button.add')}
                  disabled={!canSend}
                  onClick={handleSubmit}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full transition-colors',
                    canSend
                      ? 'bg-fill-theme-thick text-text-on-fill hover:opacity-90'
                      : 'bg-border-primary text-text-tertiary'
                  )}
                >
                  <ArrowUpIcon className={'h-3 w-3'} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('button.add')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(AddCommentInput);
