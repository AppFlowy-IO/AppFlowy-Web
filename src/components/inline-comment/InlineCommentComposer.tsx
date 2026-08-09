import { Portal } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ArrowUpIcon } from '@/assets/icons/arrow_up.svg';
import { Button } from '@/components/ui/button';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { cn } from '@/lib/utils';

import { useInlineCommentContext } from './InlineCommentContext';

const COMPOSER_WIDTH = 320;
const COMPOSER_ESTIMATED_HEIGHT = 196;

export function InlineCommentComposer() {
  const { t } = useTranslation();
  const { cancelPendingComment, mutatingCommentIds, pendingComment, submitPendingComment } = useInlineCommentContext();
  const [content, setContent] = useState('');
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitting = mutatingCommentIds.has('new');

  useEffect(() => {
    if (!pendingComment) {
      setContent('');
      return;
    }

    inputRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) {
        cancelPendingComment();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [cancelPendingComment, pendingComment]);

  const position = useMemo(() => {
    if (!pendingComment) return null;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(Math.max(8, pendingComment.rect.left), Math.max(8, viewportWidth - COMPOSER_WIDTH - 8));
    const below = pendingComment.rect.bottom + 8;
    const top =
      below + COMPOSER_ESTIMATED_HEIGHT <= viewportHeight
        ? below
        : Math.max(8, pendingComment.rect.top - COMPOSER_ESTIMATED_HEIGHT - 8);

    return { left, top };
  }, [pendingComment]);

  const submit = useCallback(() => {
    if (!content.trim() || submitting) return;
    void submitPendingComment(content);
  }, [content, submitPendingComment, submitting]);

  if (!pendingComment || !position) return null;

  return (
    <Portal>
      <div
        ref={composerRef}
        data-testid={'inline-comment-composer'}
        className={'fixed z-[1500] rounded-lg border border-border-primary bg-background-primary p-3 shadow-lg'}
        style={{ left: position.left, top: position.top, width: COMPOSER_WIDTH }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={'mb-2 truncate border-l-2 border-border-warning-thick pl-2 text-xs text-text-secondary'}>
          {pendingComment.selection.quotedText}
        </div>
        <TextareaAutosize
          ref={inputRef}
          autoFocus
          data-testid={'inline-comment-input'}
          maxLength={2000}
          maxRows={8}
          minRows={3}
          placeholder={t('inlineComment.addComment')}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancelPendingComment();
              return;
            }

            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className={'w-full rounded-md bg-fill-content px-2 py-2'}
        />
        <div className={'mt-2 flex items-center justify-between'}>
          <span className={'text-xs text-text-tertiary'}>{t('inlineComment.submitHint')}</span>
          <div className={'flex items-center gap-2'}>
            <Button variant={'ghost'} size={'sm'} disabled={submitting} onClick={cancelPendingComment}>
              {t('button.cancel')}
            </Button>
            <button
              aria-label={t('inlineComment.addComment')}
              data-testid={'inline-comment-submit'}
              disabled={!content.trim() || submitting}
              onClick={submit}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                content.trim() && !submitting
                  ? 'bg-fill-theme-thick text-text-on-fill hover:opacity-90'
                  : 'bg-border-primary text-text-tertiary'
              )}
            >
              <ArrowUpIcon className={'h-4 w-4'} />
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
