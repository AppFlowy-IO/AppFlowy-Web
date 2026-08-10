import dayjs from 'dayjs';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineComment, InlineCommentReaction } from '@/application/inline-comment';
// The same glyphs the desktop card uses (FlowySvgs.comment_* / three_dots).
import { ReactComponent as AddReactionIcon } from '@/assets/icons/add_comment_reaction.svg';
import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as ChevronUpIcon } from '@/assets/icons/alt_arrow_up.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ReopenIcon } from '@/assets/icons/comment_reopen.svg';
import { ReactComponent as ReplyIcon } from '@/assets/icons/comment_reply.svg';
import { ReactComponent as ResolveIcon } from '@/assets/icons/comment_resolve.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EmptyCommentIcon } from '@/assets/icons/empty_comment.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  INLINE_COMMENT_DRAWER_WIDTH,
  InlineCommentFilter,
  useInlineCommentActions,
  useInlineCommentContext,
  useInlineCommentStatus,
} from './InlineCommentContext';

const DESKTOP_PERSON_MENTION_PATTERN = /@\[([^\]\n]+)\]\(([^)\s]+)\)/g;
// Desktop truncates a comment body past this many characters behind a
// "See more" affordance (inline_comment_card_entry.dart).
const TRUNCATE_THRESHOLD = 150;
// Hoisted so entries without reactions/replies keep a stable prop identity.
const EMPTY_REACTIONS: InlineCommentReaction[] = [];
const EMPTY_REPLIES: InlineComment[] = [];
const EmojiPicker = lazy(() => import('@/components/_shared/emoji-picker/EmojiPicker'));
const InlineCommentPortalContainerContext = createContext<HTMLElement | null>(null);

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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const INVALID_COMMENT_DATE = { label: '', tooltip: '' };

interface ParsedCommentTimestamp {
  absolute: string;
  tooltip: string;
  value: number;
}

function parseCommentTimestamp(createdAt: string): ParsedCommentTimestamp | null {
  const parsed = dayjs(createdAt);

  return parsed.isValid()
    ? {
        absolute: parsed.format('MMM D, YYYY'),
        tooltip: parsed.format('YYYY-MM-DD HH:mm:ss'),
        value: parsed.valueOf(),
      }
    : null;
}

/**
 * Mirrors the desktop `formatCommentDate`: relative within the last week,
 * absolute afterwards. Integer math over a cached parse.
 */
function useCommentDate(createdAt: string) {
  const { t } = useTranslation();
  const timestamp = useMemo(() => parseCommentTimestamp(createdAt), [createdAt]);

  if (!timestamp) return INVALID_COMMENT_DATE;

  const elapsed = Math.max(0, Date.now() - timestamp.value);
  const days = Math.floor(elapsed / DAY_MS);

  const label =
    days === 0
      ? elapsed < MINUTE_MS
        ? t('globalComment.showSeconds', { count: Math.floor(elapsed / 1000) })
        : elapsed < HOUR_MS
        ? t('globalComment.showMinutes', { count: Math.floor(elapsed / MINUTE_MS) })
        : t('globalComment.showHours', { count: Math.floor(elapsed / HOUR_MS) })
      : days < 7
      ? t('globalComment.showDays', { count: days })
      : timestamp.absolute;

  return { label, tooltip: timestamp.tooltip };
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

function ActionIconButton({
  children,
  disabled,
  label,
  testId,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          data-testid={testId}
          disabled={disabled}
          className={'rounded p-1 text-icon-secondary hover:bg-fill-content-hover hover:text-icon-primary'}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function AddReactionButton({ commentId, disabled, testId }: { commentId: string; disabled: boolean; testId: string }) {
  const { t } = useTranslation();
  const { toggleReaction } = useInlineCommentActions();
  const [open, setOpen] = useState(false);
  const portalContainer = useContext(InlineCommentPortalContainerContext);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              aria-label={t('inlineComment.addReaction')}
              data-testid={testId}
              disabled={disabled}
              className={'rounded p-1 text-icon-secondary hover:bg-fill-content-hover hover:text-icon-primary'}
              onClick={(event) => event.stopPropagation()}
            >
              <AddReactionIcon className={'h-5 w-5'} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('inlineComment.addReaction')}</TooltipContent>
      </Tooltip>
      <PopoverContent container={portalContainer} align={'end'} className={'z-[80] w-auto min-w-0 p-0'}>
        <Suspense
          fallback={
            <div className={'flex h-[360px] w-[320px] items-center justify-center text-sm text-text-tertiary'}>
              {t('inlineComment.loadingReactions')}
            </div>
          }
        >
          <EmojiPicker
            onEmojiSelect={(emoji) => {
              setOpen(false);
              void toggleReaction(commentId, emoji).catch(() => undefined);
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

function DeleteMenu({
  commentId,
  disabled,
  isReply,
  testIdSuffix,
}: {
  commentId: string;
  disabled: boolean;
  isReply: boolean;
  testIdSuffix: string;
}) {
  const { t } = useTranslation();
  const { deleteComment } = useInlineCommentActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const portalContainer = useContext(InlineCommentPortalContainerContext);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  return (
    <div ref={menuRef} className={'relative'}>
      <ActionIconButton
        label={t('inlineComment.moreOptions')}
        testId={`inline-comment-action-menu-button${testIdSuffix}`}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <MoreIcon className={'h-5 w-5'} />
      </ActionIconButton>

      {menuOpen && (
        <div
          role={'menu'}
          className={
            'absolute right-0 top-full z-[70] mt-1 w-[180px] rounded-lg border border-border-primary bg-background-primary py-1 shadow-lg'
          }
        >
          <button
            role={'menuitem'}
            data-testid={`inline-comment-delete-button${testIdSuffix}`}
            disabled={disabled}
            className={
              'flex w-full items-center gap-2 px-3 py-1.5 text-sm text-text-primary hover:bg-fill-content-hover hover:text-text-error'
            }
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              setConfirmOpen(true);
            }}
          >
            <DeleteIcon className={'h-4 w-4'} />
            {t(isReply ? 'inlineComment.deleteReply' : 'inlineComment.delete')}
          </button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent container={portalContainer} onClick={(event) => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle className={'text-sm font-medium text-text-primary'}>
              {t(isReply ? 'inlineComment.deleteReplyTitle' : 'inlineComment.delete')}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>{t('globalComment.confirmDeleteDescription')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('button.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid={`inline-comment-delete-confirm-button${testIdSuffix}`}
              className={'bg-fill-error-thick text-text-on-fill hover:bg-fill-error-thick-hover'}
              onClick={() => void deleteComment(commentId).catch(() => undefined)}
            >
              {t('button.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ReactionBar({ comment, reactions }: { comment: InlineComment; reactions: InlineCommentReaction[] }) {
  const { t } = useTranslation();
  const { canComment, currentUserUuid, mutatingCommentIds } = useInlineCommentStatus();
  const { toggleReaction } = useInlineCommentActions();

  if (comment.isDeleted || reactions.length === 0) return null;

  const mutating = mutatingCommentIds.has(comment.commentId);
  const commentReactions = reactions.filter((reaction) => reaction.reactUsers.length > 0);

  if (commentReactions.length === 0) return null;

  return (
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
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors',
                  hasReacted ? 'bg-fill-button-active text-text-info-on-fill' : 'bg-surface-layer-01 text-text-secondary',
                  canComment && !hasReacted && 'hover:bg-fill-content-hover',
                  !canComment && 'cursor-default'
                )}
                onClick={() => void toggleReaction(comment.commentId, reaction.reactionType).catch(() => undefined)}
              >
                <span>{reaction.reactionType}</span>
                <span>{reaction.reactUsers.length}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('inlineComment.reactedBy', { names })}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function CommentContent({ comment }: { comment: InlineComment }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (comment.isDeleted) {
    return <p className={'mt-1 text-sm text-text-secondary'}>{t('globalComment.hasBeenDeleted')}</p>;
  }

  const isLong = comment.content.length > TRUNCATE_THRESHOLD;

  if (!isLong || expanded) {
    return (
      <p className={'mt-1 whitespace-pre-wrap break-words text-sm text-text-primary'}>
        {renderCommentContent(comment.content)}
      </p>
    );
  }

  return (
    <p
      data-testid={'inline-comment-see-more'}
      className={'mt-1 cursor-pointer whitespace-pre-wrap break-words text-sm text-text-primary'}
      onClick={(event) => {
        event.stopPropagation();
        setExpanded(true);
      }}
    >
      {renderCommentContent(comment.content.slice(0, TRUNCATE_THRESHOLD))}
      <span className={'text-text-secondary'}>{`...${t('inlineComment.seeMore')}`}</span>
    </p>
  );
}

/**
 * One comment row — used for both the thread root and its replies, matching the
 * desktop `InlineCommentCardEntry` / `InlineCommentReplyEntry` pair: identical
 * layout with the actions revealed on hover.
 */
function CommentEntry({
  comment,
  isReply = false,
  onReply,
  quote,
  reactions = EMPTY_REACTIONS,
}: {
  comment: InlineComment;
  isReply?: boolean;
  onReply?: () => void;
  quote?: string;
  reactions?: InlineCommentReaction[];
}) {
  const { t } = useTranslation();
  const { canComment, canResolveAllComments, currentUserUuid, mutatingCommentIds } = useInlineCommentStatus();
  const { resolveComment } = useInlineCommentActions();
  const { label: timeLabel, tooltip: timeTooltip } = useCommentDate(comment.createdAt);
  const mutating = mutatingCommentIds.has(comment.commentId);
  const testIdSuffix = isReply ? `-${comment.commentId}` : '';
  const showActions = canComment && !comment.isDeleted;
  const canReply = Boolean(onReply) && !comment.isResolved;
  const canResolve =
    !isReply &&
    (canResolveAllComments ||
      comment.canBeDeleted ||
      (Boolean(currentUserUuid) && comment.user?.uuid === currentUserUuid));

  // Desktop reveals the thread root's actions while the pointer is anywhere on
  // the card, and each reply's actions only while that reply is hovered.
  const revealActions = isReply
    ? 'group-hover/entry:pointer-events-auto group-hover/entry:opacity-100'
    : 'group-hover/card:pointer-events-auto group-hover/card:opacity-100';

  return (
    <div
      data-testid={isReply ? 'inline-comment-reply-entry' : 'inline-comment-entry'}
      className={'group/entry px-4 py-2'}
    >
      <div className={'flex items-start gap-2'}>
        <CommentAvatar comment={comment} />
        <div className={'min-w-0 flex-1'}>
          <div className={'truncate text-sm font-semibold text-text-primary'}>
            {comment.user?.name || t('inlineComment.anonymous')}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={'text-xs text-text-secondary'}>{timeLabel}</span>
            </TooltipTrigger>
            <TooltipContent>{timeTooltip}</TooltipContent>
          </Tooltip>
        </div>

        {showActions && (
          <div
            className={cn(
              'pointer-events-none ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100',
              revealActions
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <AddReactionButton
              commentId={comment.commentId}
              disabled={mutating}
              testId={`inline-comment-add-reaction-button${testIdSuffix}`}
            />
            {canReply && (
              <ActionIconButton
                label={t('inlineComment.reply')}
                testId={`inline-comment-reply-button${testIdSuffix}`}
                onClick={() => onReply?.()}
              >
                <ReplyIcon className={'h-5 w-5'} />
              </ActionIconButton>
            )}
            {canResolve && (
              <ActionIconButton
                disabled={mutating}
                label={t(comment.isResolved ? 'inlineComment.reopen' : 'inlineComment.resolve')}
                testId={`inline-comment-resolve-button${testIdSuffix}`}
                onClick={() => void resolveComment(comment.commentId, !comment.isResolved).catch(() => undefined)}
              >
                {comment.isResolved ? <ReopenIcon className={'h-5 w-5'} /> : <ResolveIcon className={'h-5 w-5'} />}
              </ActionIconButton>
            )}
            {comment.canBeDeleted && (
              <DeleteMenu
                commentId={comment.commentId}
                disabled={mutating}
                isReply={isReply}
                testIdSuffix={testIdSuffix}
              />
            )}
          </div>
        )}
      </div>

      {quote ? (
        <div className={'mt-2 truncate border-l-[3px] border-brand-lemon pl-2 text-sm text-text-secondary'}>
          {quote}
        </div>
      ) : null}

      <CommentContent comment={comment} />
      <ReactionBar comment={comment} reactions={reactions} />
    </div>
  );
}

function ReplyInput({ parentCommentId, onClose }: { parentCommentId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { mutatingCommentIds } = useInlineCommentStatus();
  const { createReply } = useInlineCommentActions();
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
    <div className={'px-4 pb-3 pt-1'}>
      <div className={'rounded-lg border border-border-primary bg-background-primary px-2 py-1'}>
        <TextareaAutosize
          autoFocus
          // The bordered shell around it is the field frame, as on desktop.
          variant={'ghost'}
          data-testid={'inline-comment-reply-input'}
          disabled={submitting}
          maxLength={2000}
          maxRows={3}
          minRows={1}
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
          className={'w-full bg-transparent py-1 text-sm'}
        />
      </div>
    </div>
  );
}

function CommentThread({
  comment,
  focusedCommentId,
  quote,
  reactionsByComment,
  replies,
}: {
  comment: InlineComment;
  focusedCommentId: string | null;
  quote?: string;
  reactionsByComment: ReadonlyMap<string, InlineCommentReaction[]>;
  replies: InlineComment[];
}) {
  const { t } = useTranslation();
  const { canComment } = useInlineCommentStatus();
  const { focusComment } = useInlineCommentActions();
  const focused = focusedCommentId === comment.commentId;
  const hasFocusedReply = replies.some((reply) => reply.commentId === focusedCommentId);
  const [replying, setReplying] = useState(false);
  const [repliesExpanded, setRepliesExpanded] = useState(hasFocusedReply);
  const previousReplyCount = useRef(replies.length);

  // Desktop expands the thread as soon as a reply lands or one of its replies
  // becomes the focus target, and collapses again once the last reply is gone.
  useEffect(() => {
    if (replies.length > previousReplyCount.current) setRepliesExpanded(true);
    else if (replies.length === 0) setRepliesExpanded(false);
    previousReplyCount.current = replies.length;
  }, [replies.length]);

  useEffect(() => {
    if (hasFocusedReply) setRepliesExpanded(true);
  }, [hasFocusedReply]);

  const canReply = canComment && !comment.isDeleted && !comment.isResolved;

  return (
    <article
      id={`inline-comment-${comment.commentId}`}
      data-testid={'inline-comment-thread'}
      data-focused={focused || hasFocusedReply}
      className={cn(
        'group/card cursor-pointer rounded-xl border transition-colors',
        focused || hasFocusedReply
          ? 'border-border-theme-thick bg-fill-list-active'
          : 'border-border-primary bg-background-primary hover:bg-fill-content-hover'
      )}
      onClick={() => focusComment(comment.commentId)}
    >
      <CommentEntry
        comment={comment}
        quote={quote}
        reactions={reactionsByComment.get(comment.commentId)}
        onReply={canReply ? () => setReplying(true) : undefined}
      />

      {replies.length > 0 && (
        <>
          <div className={'flex items-center gap-2 px-4 py-1'} onClick={(event) => event.stopPropagation()}>
            <span className={'h-px flex-1 bg-border-primary'} />
            <button
              data-testid={'inline-comment-replies-toggle'}
              className={
                'flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium text-text-secondary hover:bg-fill-content-hover'
              }
              onClick={() => setRepliesExpanded((value) => !value)}
            >
              {t(repliesExpanded ? 'inlineComment.hideReplies' : 'inlineComment.showReplies', {
                count: replies.length,
              })}
              {repliesExpanded ? <ChevronUpIcon className={'h-4 w-4'} /> : <ChevronDownIcon className={'h-4 w-4'} />}
            </button>
            <span className={'h-px flex-1 bg-border-primary'} />
          </div>

          {repliesExpanded &&
            replies.map((reply) => (
              <CommentEntry
                key={reply.commentId}
                comment={reply}
                isReply
                reactions={reactionsByComment.get(reply.commentId)}
                onReply={canReply ? () => setReplying(true) : undefined}
              />
            ))}
        </>
      )}

      {canReply && replying && (
        <div onClick={(event) => event.stopPropagation()}>
          <ReplyInput parentCommentId={comment.commentId} onClose={() => setReplying(false)} />
        </div>
      )}
    </article>
  );
}

const FILTERS: InlineCommentFilter[] = ['open', 'resolved', 'all'];

const EMPTY_STATE_KEY: Record<InlineCommentFilter, 'noComments' | 'noOpenComments' | 'noResolvedComments'> = {
  all: 'noComments',
  open: 'noOpenComments',
  resolved: 'noResolvedComments',
};

export function InlineCommentSidebar({ elevated = false, rightOffset = 0 }: { elevated?: boolean; rightOffset?: number }) {
  const { t } = useTranslation();
  const {
    active,
    anchors,
    comments,
    filter,
    focusedCommentId,
    isPanelOpen,
    loading,
    reactions,
    setFilter,
    setPanelOpen,
  } = useInlineCommentContext();
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // One pass over the reaction list instead of a filter per rendered entry.
  const reactionsByComment = useMemo(() => {
    const result = new Map<string, InlineCommentReaction[]>();

    for (const reaction of reactions) {
      const existing = result.get(reaction.commentId);

      if (existing) {
        existing.push(reaction);
      } else {
        result.set(reaction.commentId, [reaction]);
      }
    }

    return result;
  }, [reactions]);

  // Both lists sort by creation time. Parse each timestamp once up front rather
  // than the O(n log n) times a `Date.parse` comparator would.
  const createdAtMs = useMemo(() => {
    const result = new Map<string, number>();

    for (const comment of comments) {
      result.set(comment.commentId, Date.parse(comment.createdAt));
    }

    return result;
  }, [comments]);

  const repliesByParent = useMemo(() => {
    const result = new Map<string, InlineComment[]>();

    for (const comment of comments) {
      if (!comment.replyCommentId || comment.isDeleted) continue;

      const replies = result.get(comment.replyCommentId);

      if (replies) {
        replies.push(comment);
      } else {
        result.set(comment.replyCommentId, [comment]);
      }
    }

    for (const replies of result.values()) {
      replies.sort((left, right) => (createdAtMs.get(left.commentId) ?? 0) - (createdAtMs.get(right.commentId) ?? 0));
    }

    return result;
  }, [comments, createdAtMs]);

  const threads = useMemo(() => {
    const result: InlineComment[] = [];

    for (const comment of comments) {
      if (comment.replyCommentId || comment.isDeleted || !anchors.has(comment.commentId)) continue;
      if (filter !== 'all' && (filter === 'resolved' ? !comment.isResolved : comment.isResolved)) continue;

      result.push(comment);
    }

    return result.sort((left, right) => (createdAtMs.get(right.commentId) ?? 0) - (createdAtMs.get(left.commentId) ?? 0));
  }, [anchors, comments, createdAtMs, filter]);

  if (!active || !isPanelOpen) return null;

  return (
    <InlineCommentPortalContainerContext.Provider value={portalContainer}>
      <aside
        ref={setPortalContainer}
        aria-label={t('inlineComment.comments')}
        data-testid={'inline-comment-sidebar'}
        className={cn(
          'fixed bottom-0 top-0 flex flex-col border-l border-border-primary bg-background-primary shadow-lg',
          // Above the MUI page-modal dialog (z-index 1300) when commenting there.
          elevated ? 'z-[1350]' : 'z-[60]'
        )}
        style={{ right: rightOffset, width: INLINE_COMMENT_DRAWER_WIDTH }}
      >
        <div className={'flex h-9 shrink-0 items-center bg-surface-container-layer-01 px-4'}>
          <h2 className={'flex-1 truncate text-sm font-semibold text-text-primary'}>{t('inlineComment.comments')}</h2>
          <button
            aria-label={t('button.close')}
            data-testid={'inline-comment-sidebar-close'}
            className={'rounded p-1 text-icon-secondary hover:bg-fill-content-hover'}
            onClick={() => setPanelOpen(false)}
          >
            <CloseIcon className={'h-5 w-5'} />
          </button>
        </div>

        <div className={'flex shrink-0 gap-2 px-4 pb-2 pt-4'}>
          {FILTERS.map((item) => (
            <button
              key={item}
              data-testid={`inline-comment-filter-${item}`}
              className={cn(
                'rounded-md px-3 py-1 text-sm text-text-primary',
                filter === item ? 'bg-fill-info-light font-semibold' : 'hover:bg-fill-content-hover'
              )}
              onClick={() => setFilter(item)}
            >
              {t(`inlineComment.${item}`)}
            </button>
          ))}
        </div>

        <div className={'flex-1 overflow-y-auto px-4 py-2'} aria-live={'polite'}>
          {loading && threads.length === 0 ? (
            <div data-testid={'inline-comment-loading'} className={'py-10 text-center text-sm text-text-tertiary'}>
              {t('inlineComment.loading')}
            </div>
          ) : threads.length === 0 ? (
            <div
              data-testid={'inline-comment-empty'}
              className={'flex flex-col items-center py-16 text-center text-text-secondary'}
            >
              <EmptyCommentIcon className={'mb-4 h-12 w-12 text-icon-quaternary'} />
              <span className={'text-base font-medium'}>{t(`inlineComment.${EMPTY_STATE_KEY[filter]}`)}</span>
            </div>
          ) : (
            <div className={'flex flex-col gap-3'}>
              {threads.map((comment) => (
                <CommentThread
                  key={comment.commentId}
                  comment={comment}
                  focusedCommentId={focusedCommentId}
                  quote={anchors.get(comment.commentId)?.quotedText}
                  reactionsByComment={reactionsByComment}
                  replies={repliesByParent.get(comment.commentId) ?? EMPTY_REPLIES}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </InlineCommentPortalContainerContext.Provider>
  );
}
