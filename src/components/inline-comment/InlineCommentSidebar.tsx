import dayjs from 'dayjs';
import { CheckCircle2, MessageSquare, Reply, RotateCcw, SmilePlus, Trash2, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineComment } from '@/application/inline-comment';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { INLINE_COMMENT_DRAWER_WIDTH, InlineCommentFilter, useInlineCommentContext } from './InlineCommentContext';

const DESKTOP_PERSON_MENTION_PATTERN = /@\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const EmojiPicker = lazy(() => import('@/components/_shared/emoji-picker/EmojiPicker'));

function renderCommentContent(content: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  DESKTOP_PERSON_MENTION_PATTERN.lastIndex = 0;

  while ((match = DESKTOP_PERSON_MENTION_PATTERN.exec(content)) !== null) {
    const [raw, name, personId] = match;

    if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index));

    parts.push(
      <span key={`${personId}-${match.index}`} data-mention-id={personId} className={'text-text-action'}>
        @{name}
      </span>
    );
    lastIndex = match.index + raw.length;
  }

  if (parts.length === 0) return content;
  if (lastIndex < content.length) parts.push(content.slice(lastIndex));
  return parts;
}

function CommentAvatar({ comment }: { comment: InlineComment }) {
  const name = comment.user?.name || 'Anonymous';

  return (
    <Avatar size={'md'}>
      {comment.user?.avatarUrl ? <AvatarImage src={comment.user.avatarUrl} alt={name} /> : null}
      <AvatarFallback>{name}</AvatarFallback>
    </Avatar>
  );
}

function ReplyInput({ parentCommentId, onClose }: { parentCommentId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { createReply, mutatingCommentIds } = useInlineCommentContext();
  const [content, setContent] = useState('');
  const submitting = mutatingCommentIds.has(parentCommentId);

  const submit = useCallback(async () => {
    if (!content.trim() || submitting) return;

    try {
      await createReply(parentCommentId, content);
      setContent('');
      onClose();
    } catch {
      // The context already reports the API error.
    }
  }, [content, createReply, onClose, parentCommentId, submitting]);

  return (
    <div className={'mt-3 rounded-lg border border-border-primary bg-background-primary p-2'}>
      <TextareaAutosize
        autoFocus
        data-testid={'inline-comment-reply-input'}
        maxLength={2000}
        maxRows={6}
        minRows={2}
        placeholder={t('inlineComment.addReply')}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        className={'w-full bg-transparent'}
      />
      <div className={'mt-2 flex justify-end gap-2'}>
        <Button size={'sm'} variant={'ghost'} disabled={submitting} onClick={onClose}>
          {t('button.cancel')}
        </Button>
        <Button size={'sm'} disabled={!content.trim() || submitting} onClick={() => void submit()}>
          {t('inlineComment.reply')}
        </Button>
      </div>
    </div>
  );
}

function CommentBody({ comment, isReply = false }: { comment: InlineComment; isReply?: boolean }) {
  const { t } = useTranslation();
  const { canComment, currentUserUuid, deleteComment, mutatingCommentIds, reactions, toggleReaction } =
    useInlineCommentContext();
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const mutating = mutatingCommentIds.has(comment.commentId);
  const commentReactions = reactions.filter(
    (reaction) => reaction.commentId === comment.commentId && reaction.reactUsers.length > 0
  );
  const timestamp = dayjs(comment.createdAt);
  const now = dayjs();
  const diffSeconds = now.diff(timestamp, 'second');
  const diffMinutes = now.diff(timestamp, 'minute');
  const diffHours = now.diff(timestamp, 'hour');
  const diffDays = now.diff(timestamp, 'day');
  const timeLabel = !timestamp.isValid()
    ? ''
    : diffSeconds < 60
    ? t('globalComment.showSeconds', { count: Math.max(0, diffSeconds) })
    : diffMinutes < 60
    ? t('globalComment.showMinutes', { count: diffMinutes })
    : diffHours < 24
    ? t('globalComment.showHours', { count: diffHours })
    : t('globalComment.showDays', { count: diffDays });

  return (
    <div className={cn('flex gap-2', isReply && 'ml-8 border-l border-border-primary pl-3')}>
      <CommentAvatar comment={comment} />
      <div className={'min-w-0 flex-1'}>
        <div className={'flex items-center gap-2'}>
          <span className={'truncate text-sm font-semibold text-text-primary'}>
            {comment.user?.name || t('inlineComment.anonymous')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={'shrink-0 text-xs text-text-tertiary'}>{timeLabel}</span>
            </TooltipTrigger>
            <TooltipContent>{timestamp.isValid() ? timestamp.format('YYYY-MM-DD HH:mm:ss') : ''}</TooltipContent>
          </Tooltip>
          {canComment && comment.canBeDeleted && (
            <button
              aria-label={t('inlineComment.delete')}
              disabled={mutating}
              className={
                'ml-auto rounded p-1 text-text-tertiary opacity-0 hover:bg-fill-content-hover hover:text-text-error group-hover:opacity-100'
              }
              onClick={(event) => {
                event.stopPropagation();
                void deleteComment(comment.commentId).catch(() => undefined);
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <p className={'mt-1 whitespace-pre-wrap break-words text-sm text-text-primary'}>
          {comment.isDeleted ? t('globalComment.hasBeenDeleted') : renderCommentContent(comment.content)}
        </p>
        {!comment.isDeleted && (commentReactions.length > 0 || canComment) && (
          <div className={'mt-2 flex flex-wrap items-center gap-1'} onClick={(event) => event.stopPropagation()}>
            {commentReactions.map((reaction) => {
              const hasReacted = reaction.reactUsers.some((user) => user.uuid === currentUserUuid);
              const names = reaction.reactUsers
                .map((user) => user.name)
                .filter(Boolean)
                .join(', ');

              return (
                <Tooltip key={reaction.reactionType}>
                  <TooltipTrigger asChild>
                    <button
                      data-testid={`inline-comment-reaction-${reaction.reactionType}`}
                      aria-label={t(hasReacted ? 'inlineComment.removeReaction' : 'inlineComment.addReactionLabel', {
                        emoji: reaction.reactionType,
                        count: reaction.reactUsers.length,
                      })}
                      disabled={!canComment || mutating}
                      className={cn(
                        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                        hasReacted
                          ? 'bg-fill-theme-light text-text-theme border-border-theme-thick'
                          : 'border-border-primary text-text-secondary',
                        canComment && 'hover:bg-fill-content-hover',
                        !canComment && 'cursor-default'
                      )}
                      onClick={() =>
                        void toggleReaction(comment.commentId, reaction.reactionType).catch(() => undefined)
                      }
                    >
                      <span>{reaction.reactionType}</span>
                      <span>{reaction.reactUsers.length}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('inlineComment.reactedBy', { names })}</TooltipContent>
                </Tooltip>
              );
            })}
            {canComment && (
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        aria-label={t('inlineComment.addReaction')}
                        disabled={mutating}
                        className={
                          'rounded-full border border-transparent p-1 text-text-tertiary hover:bg-fill-content-hover'
                        }
                      >
                        <SmilePlus size={14} />
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t('inlineComment.addReaction')}</TooltipContent>
                </Tooltip>
                <PopoverContent align={'start'} className={'z-[80] w-auto min-w-0 p-0'}>
                  <Suspense
                    fallback={
                      <div className={'flex h-[360px] w-[320px] items-center justify-center text-sm text-text-tertiary'}>
                        {t('inlineComment.loadingReactions')}
                      </div>
                    }
                  >
                    <EmojiPicker
                      onEmojiSelect={(emoji) => {
                        setEmojiPickerOpen(false);
                        void toggleReaction(comment.commentId, emoji).catch(() => undefined);
                      }}
                    />
                  </Suspense>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentThread({ comment, replies }: { comment: InlineComment; replies: InlineComment[] }) {
  const { t } = useTranslation();
  const { anchors, canComment, focusComment, focusedCommentId, mutatingCommentIds, resolveComment } =
    useInlineCommentContext();
  const [replying, setReplying] = useState(false);
  const focused = focusedCommentId === comment.commentId;
  const mutating = mutatingCommentIds.has(comment.commentId);
  const quote = anchors.get(comment.commentId)?.quotedText;

  return (
    <article
      id={`inline-comment-${comment.commentId}`}
      data-testid={'inline-comment-thread'}
      className={cn(
        'group cursor-pointer rounded-lg border p-3 transition-colors',
        focused
          ? 'border-border-theme-thick bg-fill-list-active'
          : 'border-border-primary bg-background-primary hover:bg-fill-content-hover'
      )}
      onClick={() => focusComment(comment.commentId)}
    >
      {quote && (
        <div
          className={cn(
            'mb-3 line-clamp-3 border-l-2 border-border-warning-thick pl-2 text-xs text-text-secondary',
            comment.isResolved && 'line-through opacity-70'
          )}
        >
          {quote}
        </div>
      )}

      <CommentBody comment={comment} />

      {replies.length > 0 && (
        <div className={'mt-3 flex flex-col gap-3'}>
          {replies.map((reply) => (
            <CommentBody key={reply.commentId} comment={reply} isReply />
          ))}
        </div>
      )}

      {canComment && (
        <div className={'mt-3 flex items-center gap-1'} onClick={(event) => event.stopPropagation()}>
          <Button size={'sm'} variant={'ghost'} onClick={() => setReplying((value) => !value)}>
            <Reply size={14} />
            {t('inlineComment.reply')}
          </Button>
          <Button
            size={'sm'}
            variant={'ghost'}
            disabled={mutating}
            onClick={() => void resolveComment(comment.commentId, !comment.isResolved).catch(() => undefined)}
          >
            {comment.isResolved ? <RotateCcw size={14} /> : <CheckCircle2 size={14} />}
            {comment.isResolved ? t('inlineComment.reopen') : t('inlineComment.resolve')}
          </Button>
        </div>
      )}

      {canComment && replying && (
        <div onClick={(event) => event.stopPropagation()}>
          <ReplyInput parentCommentId={comment.commentId} onClose={() => setReplying(false)} />
        </div>
      )}
    </article>
  );
}

const FILTERS: InlineCommentFilter[] = ['open', 'resolved', 'all'];

export function InlineCommentSidebar({ rightOffset = 0 }: { rightOffset?: number }) {
  const { t } = useTranslation();
  const { active, anchors, comments, filter, isPanelOpen, loading, setFilter, setPanelOpen } = useInlineCommentContext();

  const repliesByParent = useMemo(() => {
    const result = new Map<string, InlineComment[]>();

    for (const comment of comments) {
      if (!comment.replyCommentId || comment.isDeleted) continue;

      const replies = result.get(comment.replyCommentId) ?? [];

      replies.push(comment);
      result.set(comment.replyCommentId, replies);
    }

    for (const replies of result.values()) {
      replies.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    }

    return result;
  }, [comments]);

  const threads = useMemo(
    () =>
      comments
        .filter(
          (comment) =>
            !comment.replyCommentId &&
            !comment.isDeleted &&
            anchors.has(comment.commentId) &&
            (filter === 'all' || (filter === 'resolved' ? comment.isResolved : !comment.isResolved))
        )
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [anchors, comments, filter]
  );

  if (!active || !isPanelOpen) return null;

  return (
    <aside
      aria-label={t('inlineComment.comments')}
      data-testid={'inline-comment-sidebar'}
      className={
        'fixed bottom-0 top-0 z-[60] flex flex-col border-l border-border-primary bg-background-primary shadow-lg'
      }
      style={{ right: rightOffset, width: INLINE_COMMENT_DRAWER_WIDTH }}
    >
      <div className={'flex h-12 shrink-0 items-center border-b border-border-primary px-4'}>
        <MessageSquare size={18} className={'mr-2 text-icon-primary'} />
        <h2 className={'text-sm font-semibold text-text-primary'}>{t('inlineComment.comments')}</h2>
        <button
          aria-label={t('button.close')}
          className={'ml-auto rounded p-1 text-icon-secondary hover:bg-fill-content-hover'}
          onClick={() => setPanelOpen(false)}
        >
          <X size={18} />
        </button>
      </div>

      <div className={'flex shrink-0 gap-1 border-b border-border-primary px-3 py-2'}>
        {FILTERS.map((item) => (
          <button
            key={item}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium',
              filter === item
                ? 'bg-fill-list-active text-text-action'
                : 'text-text-secondary hover:bg-fill-content-hover'
            )}
            onClick={() => setFilter(item)}
          >
            {t(`inlineComment.${item}`)}
          </button>
        ))}
      </div>

      <div className={'flex-1 overflow-y-auto p-3'} aria-live={'polite'}>
        {loading ? (
          <div className={'py-10 text-center text-sm text-text-tertiary'}>{t('inlineComment.loading')}</div>
        ) : threads.length === 0 ? (
          <div className={'flex flex-col items-center py-16 text-center text-text-tertiary'}>
            <MessageSquare size={28} className={'mb-3'} />
            <span className={'text-sm'}>{t('inlineComment.noComments')}</span>
          </div>
        ) : (
          <div className={'flex flex-col gap-3'}>
            {threads.map((comment) => (
              <CommentThread
                key={comment.commentId}
                comment={comment}
                replies={repliesByParent.get(comment.commentId) ?? []}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
