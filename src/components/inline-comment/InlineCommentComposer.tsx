import { Portal } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as SendCommentIcon } from '@/assets/icons/send_comment.svg';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { cn } from '@/lib/utils';

import { useInlineCommentContext } from './InlineCommentContext';

// Matches the desktop compose menu: a 320px wide single-row popup anchored to
// the selection (inline_comment_compose_menu.dart).
const COMPOSER_WIDTH = 320;
const COMPOSER_ESTIMATED_HEIGHT = 56;

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
        className={
          'fixed z-[1500] flex items-end gap-1 rounded-lg border border-border-primary bg-background-primary px-2 py-1.5 shadow-lg'
        }
        style={{ left: position.left, top: position.top, width: COMPOSER_WIDTH }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <TextareaAutosize
          ref={inputRef}
          autoFocus
          // Desktop's compose field is borderless inside the menu shell.
          variant={'ghost'}
          data-testid={'inline-comment-input'}
          disabled={submitting}
          maxLength={2000}
          maxRows={8}
          minRows={1}
          placeholder={t('inlineComment.writeComment')}
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
          className={'w-full flex-1 bg-transparent px-1 py-1.5 text-sm'}
        />
        <button
          aria-label={t('inlineComment.addComment')}
          data-testid={'inline-comment-submit'}
          disabled={!content.trim() || submitting}
          onClick={submit}
          className={cn(
            'mb-0.5 flex shrink-0 items-center justify-center p-1 transition-colors',
            // Desktop keeps the send glyph in its brand color while it can be
            // submitted and greys it out otherwise.
            content.trim() && !submitting ? 'text-brand-skyline hover:opacity-90' : 'text-icon-tertiary'
          )}
        >
          <SendCommentIcon className={'h-5 w-5'} />
        </button>
      </div>
    </Portal>
  );
}
