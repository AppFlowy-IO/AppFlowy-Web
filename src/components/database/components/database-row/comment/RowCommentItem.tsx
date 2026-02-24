import dayjs from 'dayjs';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RowComment } from '@/application/row-comment.type';
import { ReactComponent as AddEmojiIcon } from '@/assets/icons/add_emoji.svg';
import { ReactComponent as CheckCircleIcon } from '@/assets/icons/check_circle.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { EmojiPicker } from '@/components/_shared/emoji-picker';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import AddCommentInput from './AddCommentInput';
import DeleteCommentConfirm from './DeleteCommentConfirm';
import MemberAvatar, { getMemberDisplayName } from './MemberAvatar';
import { useRowCommentDispatch, useRowCommentState } from './RowCommentContext';
import RowCommentReactions from './RowCommentReactions';

function RowCommentItem({ comment, isFirst = false, isLast = false }: { comment: RowComment; isFirst?: boolean; isLast?: boolean }) {
  const { t } = useTranslation();
  const { editingCommentId, replyingCommentId, currentUserId, currentUserUid, members } = useRowCommentState();
  const {
    setEditingCommentId,
    updateComment,
    deleteComment,
    resolveComment,
    toggleReaction,
  } = useRowCommentDispatch();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [tick, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const actionsForceVisible = menuOpen || emojiOpen;

  const isEditing = editingCommentId === comment.id;

  // Sync editContent when the underlying comment changes (e.g., external collaborative edit)
  useEffect(() => {
    if (!isEditing) {
      setEditContent(comment.content);
    }
  }, [comment.content, isEditing]);

  // Refresh relative time every 60 seconds
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);

    return () => clearInterval(id);
  }, []);
  const isOwner = comment.authorId === currentUserId || comment.authorId === currentUserUid;
  const isParent = !comment.parentCommentId;
  const isReplying = replyingCommentId === comment.id;
  const wasEdited = comment.updatedAt > comment.createdAt;

  const relativeTime = useMemo(() => {
    const now = dayjs();
    const created = dayjs.unix(comment.createdAt);
    const diffSec = now.diff(created, 'second');
    const diffMin = now.diff(created, 'minute');
    const diffHour = now.diff(created, 'hour');
    const diffDay = now.diff(created, 'day');

    if (diffSec < 60) {
      return t('globalComment.showSeconds', { count: Math.max(0, diffSec) });
    } else if (diffMin < 60) {
      return t('globalComment.showMinutes', { count: diffMin });
    } else if (diffHour < 24) {
      return t('globalComment.showHours', { count: diffHour });
    } else {
      return t('globalComment.showDays', { count: diffDay });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comment.createdAt, tick, t]);

  const fullTime = useMemo(
    () => dayjs.unix(comment.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    [comment.createdAt]
  );

  const handleStartEdit = useCallback(() => {
    setEditContent(comment.content);
    setEditingCommentId(comment.id);
  }, [comment.content, comment.id, setEditingCommentId]);

  const handleSaveEdit = useCallback(() => {
    if (!editContent.trim()) return;
    updateComment(comment.id, editContent);
  }, [editContent, comment.id, updateComment]);

  const handleCancelEdit = useCallback(() => {
    setEditingCommentId(null);
    setEditContent(comment.content);
  }, [comment.content, setEditingCommentId]);

  const handleDelete = useCallback(() => {
    deleteComment(comment.id);
  }, [comment.id, deleteComment]);

  return (
    <>
      <div
        data-testid={'row-comment-item'}
        className={cn(
          'group relative flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-fill-content-hover',
          !isParent && 'ml-10'
        )}
      >
        {/* Avatar with connecting lines — negative margin extends lines through parent padding */}
        <div className={'-my-2 flex w-8 flex-shrink-0 flex-col items-center'}>
          <div className={cn('w-px flex-1', isFirst || !isParent ? 'bg-transparent' : 'bg-border-primary')} />
          <div className={'flex-shrink-0 py-1'}>
            <MemberAvatar uid={comment.authorId} size={'md'} />
          </div>
          <div className={cn('w-px flex-1', isLast || !isParent ? 'bg-transparent' : 'bg-border-primary')} />
        </div>

        {/* Content */}
        <div className={'flex min-w-0 flex-1 flex-col gap-1'}>
          {/* Header: author + time */}
          <div className={'flex items-center gap-2'}>
            <span className={'text-sm font-semibold text-text-primary'}>{getMemberDisplayName(members, comment.authorId)}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={'text-xs text-text-tertiary'}>{relativeTime}</span>
              </TooltipTrigger>
              <TooltipContent>{fullTime}</TooltipContent>
            </Tooltip>
            {wasEdited && (
              <span className={'text-xs text-text-tertiary'}>{t('rowComment.edited')}</span>
            )}
          </div>

          {/* Comment body or edit mode */}
          {isEditing ? (
            <EditCommentForm
              content={editContent}
              setContent={setEditContent}
              onSave={handleSaveEdit}
              onCancel={handleCancelEdit}
            />
          ) : (
            <p data-testid={'row-comment-content'} className={'whitespace-pre-wrap break-words text-sm text-text-primary'}>{comment.content}</p>
          )}

          {/* Reactions */}
          <RowCommentReactions commentId={comment.id} reactions={comment.reactions} />

          {/* Reply input */}
          {isReplying && (
            <div className={'mt-2'}>
              <AddCommentInput parentCommentId={comment.id} />
            </div>
          )}
        </div>

        {/* Hover actions — CSS-driven visibility, matching Flutter desktop */}
        {!isEditing && (
          <div data-testid={'row-comment-actions'} className={cn('absolute -top-3 right-2 items-center gap-0.5 rounded-lg border border-border-primary bg-background-primary p-0.5 shadow-sm', actionsForceVisible ? 'flex' : 'hidden group-hover:flex')}>
            {/* Emoji reaction picker */}
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      data-testid={'row-comment-emoji-button'}
                      aria-label={t('rowComment.addEmoji')}
                      className={'rounded p-1 text-text-secondary hover:bg-fill-content-hover'}
                    >
                      <AddEmojiIcon className={'h-4 w-4'} />
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('rowComment.addEmoji')}</TooltipContent>
              </Tooltip>
              <PopoverContent align={'end'} className={'w-auto min-w-0 p-0'}>
                <EmojiPicker
                  onEmojiSelect={(emoji) => {
                    toggleReaction(comment.id, emoji);
                    setEmojiOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>

            {/* Resolve (first comment only — matches Flutter desktop) */}
            {isFirst && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    data-testid={'row-comment-resolve-button'}
                    aria-label={comment.isResolved ? t('rowComment.reopen') : t('rowComment.resolve')}
                    onClick={() => resolveComment(comment.id, !comment.isResolved)}
                    className={cn(
                      'rounded p-1 hover:bg-fill-content-hover',
                      comment.isResolved ? 'text-function-success' : 'text-text-secondary'
                    )}
                  >
                    <CheckCircleIcon className={'h-4 w-4'} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {comment.isResolved ? t('rowComment.reopen') : t('rowComment.resolve')}
                </TooltipContent>
              </Tooltip>
            )}

            {/* More actions (Edit / Delete) — owner only */}
            {isOwner && (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        data-testid={'row-comment-more-button'}
                        aria-label={t('rowComment.moreActions')}
                        className={'rounded p-1 text-text-secondary hover:bg-fill-content-hover'}
                      >
                        <MoreIcon className={'h-4 w-4'} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t('rowComment.moreActions')}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align={'end'} className={'min-w-[160px]'}>
                  <DropdownMenuItem data-testid={'row-comment-edit-action'} onClick={handleStartEdit}>
                    <EditIcon className={'h-4 w-4'} />
                    {t('rowComment.editComment')}
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid={'row-comment-delete-action'} variant={'destructive'} onClick={() => setDeleteOpen(true)}>
                    <DeleteIcon className={'h-4 w-4'} />
                    {t('rowComment.deleteComment')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {deleteOpen && (
        <DeleteCommentConfirm
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}

const EditCommentForm = memo(function EditCommentForm({
  content,
  setContent,
  onSave,
  onCancel,
}: {
  content: string;
  setContent: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={'flex flex-col gap-2'}>
      <div className={'rounded-lg border border-border-theme-thick px-3 py-1.5'}>
        <TextareaAutosize
          variant={'ghost'}
          autoFocus
          minRows={1}
          maxRows={8}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSave();
            }

            if (e.key === 'Escape') {
              e.stopPropagation();
              e.preventDefault();
              e.nativeEvent.stopImmediatePropagation();
              onCancel();
            }
          }}
          className={'w-full bg-transparent'}
        />
      </div>
      <div className={'flex justify-end gap-2'}>
        <Button data-testid={'row-comment-edit-cancel'} variant={'outline'} size={'sm'} onClick={onCancel}>
          {t('button.cancel')}
        </Button>
        <Button data-testid={'row-comment-edit-save'} size={'sm'} disabled={!content.trim()} onClick={onSave}>
          {t('button.save')}
        </Button>
      </div>
    </div>
  );
});

export default memo(RowCommentItem, (prev, next) =>
  prev.comment.id === next.comment.id &&
  prev.comment.updatedAt === next.comment.updatedAt &&
  prev.comment.isResolved === next.comment.isResolved &&
  prev.comment.content === next.comment.content &&
  prev.isFirst === next.isFirst &&
  prev.isLast === next.isLast
);
