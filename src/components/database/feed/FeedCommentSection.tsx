import dayjs from 'dayjs';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRowMap } from '@/application/database-yjs';
import { useAddCommentDispatch } from '@/application/database-yjs/comment_dispatch';
import { getCommentsMap, getRowComments } from '@/application/database-yjs/row_comment';
import { RowComment } from '@/application/row-comment.type';
import { YjsEditorKey } from '@/application/types';
import { ReactComponent as ArrowUpIcon } from '@/assets/icons/arrow_up.svg';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { cn } from '@/lib/utils';

import { FeedAvatar } from './FeedAvatar';
import { useFeedMembers } from './FeedMembersContext';
import { formatFeedRelativeTime } from './feed.utils';

interface FeedRowCommentsState {
  count: number;
  latest: RowComment | null;
}

const EMPTY_COMMENTS: FeedRowCommentsState = { count: 0, latest: null };

function summarizeComments(comments: RowComment[]): FeedRowCommentsState {
  let latest: RowComment | null = null;

  // Ties resolve to the later map entry so a reply added within the same
  // second as an older comment still wins.
  comments.forEach((comment) => {
    if (!latest || comment.createdAt >= latest.createdAt) latest = comment;
  });

  return { count: comments.length, latest };
}

/**
 * Observe a row's comments without creating the comments map. Feed cards are
 * summary surfaces and must not write to rows they only display.
 */
export function useFeedRowComments(rowId: string): FeedRowCommentsState {
  const rowDoc = useRowMap()?.[rowId];
  const [state, setState] = useState<FeedRowCommentsState>(EMPTY_COMMENTS);

  useEffect(() => {
    if (!rowDoc) {
      setState(EMPTY_COMMENTS);
      return;
    }

    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    let commentsMap = getCommentsMap(rowDoc);

    const update = () => {
      const next = summarizeComments(getRowComments(rowDoc));

      setState((current) =>
        current.count === next.count && current.latest?.id === next.latest?.id ? current : next
      );
    };

    const syncCommentsMap = () => {
      const nextCommentsMap = getCommentsMap(rowDoc);

      if (nextCommentsMap !== commentsMap) {
        commentsMap?.unobserveDeep(update);
        commentsMap = nextCommentsMap;
        commentsMap?.observeDeep(update);
      }

      update();
    };

    rowSharedRoot.observe(syncCommentsMap);
    commentsMap?.observeDeep(update);
    update();

    return () => {
      rowSharedRoot.unobserve(syncCommentsMap);
      commentsMap?.unobserveDeep(update);
    };
  }, [rowDoc]);

  return state;
}

function FeedCommentSummary({ count, latest, rowId }: { count: number; latest: RowComment; rowId: string }) {
  const { t } = useTranslation();
  const { resolveMember } = useFeedMembers();
  const commenter = resolveMember(latest.authorId);
  const relativeTime = formatFeedRelativeTime(latest.createdAt, t, dayjs());

  return (
    <div className='mt-3 flex items-center gap-2' data-testid={`feed-comment-summary-${rowId}`}>
      <FeedAvatar member={commenter} />
      <span className='text-[13px] text-text-secondary' data-testid={`feed-comment-count-${rowId}`}>
        {t('globalComment.replies', { count })}
      </span>
      <span className='text-[13px] text-text-tertiary'>{relativeTime}</span>
    </div>
  );
}

function FeedAddCommentInput({ rowId }: { rowId: string }) {
  const { t } = useTranslation();
  const { currentCommentAuthorId, currentUser, resolveMember } = useFeedMembers();
  const addComment = useAddCommentDispatch(rowId);
  const [content, setContent] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const collapsed = !focused && !content;
  const canSend = content.trim().length > 0;
  const author = resolveMember(currentCommentAuthorId) ?? {
    name: currentUser?.name ?? '',
    email: currentUser?.email ?? '',
    avatarUrl: currentUser?.avatar ?? null,
  };

  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused]);

  const reset = useCallback(() => {
    setContent('');
    setFocused(false);
    inputRef.current?.blur();
  }, []);

  const submit = useCallback(() => {
    const trimmed = content.trim();

    if (!trimmed || !currentCommentAuthorId) return;

    const commentId = addComment(trimmed, currentCommentAuthorId);

    if (commentId) reset();
  }, [addComment, content, currentCommentAuthorId, reset]);

  return (
    <div
      className='mt-3 flex items-center gap-2'
      data-feed-interactive='true'
      data-testid={`feed-add-comment-${rowId}`}
      onClick={(event) => event.stopPropagation()}
    >
      <FeedAvatar member={author} />
      {collapsed ? (
        <div
          className='flex h-8 flex-1 cursor-text items-center rounded-lg border border-border-primary px-3 text-sm text-text-tertiary hover:border-border-primary-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
          data-testid={`feed-add-comment-collapsed-${rowId}`}
          onClick={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setFocused(true);
            }
          }}
          role='button'
          tabIndex={0}
        >
          {t('rowComment.addComment')}
        </div>
      ) : (
        <div className='flex flex-1 items-end gap-1'>
          <div
            className={cn(
              'flex-1 rounded-lg border px-3 py-1.5 transition-colors',
              focused ? 'border-border-theme-thick' : 'border-border-primary'
            )}
          >
            <TextareaAutosize
              autoFocus
              className='w-full bg-transparent'
              data-testid={`feed-add-comment-input-${rowId}`}
              maxRows={6}
              minRows={1}
              onBlur={() => {
                if (!content) setFocused(false);
              }}
              onChange={(event) => setContent(event.target.value)}
              onFocus={() => setFocused(true)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;

                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
                  event.preventDefault();
                  submit();
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  event.nativeEvent.stopImmediatePropagation();
                  reset();
                }
              }}
              placeholder={t('rowComment.addComment')}
              ref={inputRef}
              value={content}
              variant='ghost'
            />
          </div>
          <button
            aria-label={t('rowComment.reply')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full',
              canSend ? 'bg-fill-theme-thick text-text-on-fill' : 'bg-fill-content-hover text-text-tertiary'
            )}
            data-testid={`feed-add-comment-submit-${rowId}`}
            disabled={!canSend}
            onClick={submit}
            type='button'
          >
            <ArrowUpIcon aria-hidden='true' className='h-4 w-4' />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Desktop `FeedCard._buildCommentSection`: a summary of the latest reply when
 * comments exist, otherwise an inline add-comment input when allowed.
 */
export const FeedCommentSection = memo(function FeedCommentSection({ rowId }: { rowId: string }) {
  const { count, latest } = useFeedRowComments(rowId);
  const { canComment, currentCommentAuthorId } = useFeedMembers();

  if (count > 0 && latest) return <FeedCommentSummary count={count} latest={latest} rowId={rowId} />;
  if (!canComment || !currentCommentAuthorId) return null;

  return <FeedAddCommentInput rowId={rowId} />;
});

export default FeedCommentSection;
