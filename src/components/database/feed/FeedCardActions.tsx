import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToggleRowReactionDispatch } from '@/application/database-yjs';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { DeleteRowConfirm } from '@/components/database/components/database-row/DeleteRowConfirm';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useFeedMembers } from './FeedMembersContext';

// The picker (categories, virtualized grid, skin tones) is only needed once a
// popover opens, so keep it out of the feed chunk until then.
const EmojiPicker = lazy(() =>
  import('@/components/_shared/emoji-picker').then((module) => ({ default: module.EmojiPicker }))
);

/**
 * Desktop `FeedCard` hover actions: an emoji reaction button when commenting
 * is allowed and a more menu (duplicate / delete) when the database is
 * editable. Both stay visible while their popovers are open.
 */
export function FeedCardActions({
  editable,
  onOpenChange,
  rowId,
}: {
  editable: boolean;
  onOpenChange?: (open: boolean) => void;
  rowId: string;
}) {
  const { t } = useTranslation();
  const { canComment, currentUid } = useFeedMembers();
  const duplicateRow = useDuplicateRowDispatch();
  const toggleReaction = useToggleRowReactionDispatch(rowId);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canReact = canComment && currentUid !== null;
  const forceVisible = emojiOpen || menuOpen;

  if (!canReact && !editable) return null;

  const setEmoji = (open: boolean) => {
    setEmojiOpen(open);
    onOpenChange?.(open || menuOpen);
  };

  const setMenu = (open: boolean) => {
    setMenuOpen(open);
    onOpenChange?.(open || emojiOpen);
  };

  return (
    <>
      <div
        className={cn(
          'absolute right-2 top-2 z-20 flex items-center gap-1 rounded-[6px] border border-border-primary bg-background-primary p-0.5 shadow-sm transition-opacity motion-reduce:transition-none',
          forceVisible
            ? 'opacity-100'
            : 'opacity-0 group-focus-within/feed-card:opacity-100 group-hover/feed-card:opacity-100'
        )}
        data-feed-interactive='true'
        data-testid={`feed-card-actions-${rowId}`}
        onClick={(event) => event.stopPropagation()}
      >
        {canReact ? (
          <Popover onOpenChange={setEmoji} open={emojiOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    aria-label={t('feed.addReaction')}
                    className='h-7 w-7 rounded-[4px] p-1 text-icon-secondary'
                    data-testid={`feed-card-reaction-button-${rowId}`}
                    onClick={(event) => event.stopPropagation()}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <EmojiIcon aria-hidden='true' className='h-4 w-4' />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('feed.addReaction')}</TooltipContent>
            </Tooltip>
            <PopoverContent align='end' className='w-auto min-w-0 p-0' onClick={(event) => event.stopPropagation()}>
              <Suspense fallback={null}>
                <EmojiPicker
                  onEmojiSelect={(emoji) => {
                    if (canReact) toggleReaction(emoji, currentUid);
                    setEmoji(false);
                  }}
                />
              </Suspense>
            </PopoverContent>
          </Popover>
        ) : null}

        {editable ? (
          <DropdownMenu onOpenChange={setMenu} open={menuOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={t('tooltip.openMenu')}
                    className='h-7 w-7 rounded-[4px] p-1 text-icon-secondary'
                    data-testid={`feed-card-more-${rowId}`}
                    onClick={(event) => event.stopPropagation()}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <MoreIcon aria-hidden='true' className='h-4 w-4' />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('tooltip.openMenu')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align='end'
              className='w-[180px] !min-w-[180px]'
              data-testid='feed-row-action-menu'
              onClick={(event) => event.stopPropagation()}
              side='bottom'
              sideOffset={8}
            >
              <DropdownMenuGroup>
                <DropdownMenuItem data-testid='feed-row-duplicate' onSelect={() => void duplicateRow(rowId)}>
                  <DuplicateIcon aria-hidden='true' />
                  {t('grid.row.duplicate')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid='feed-row-delete'
                  onSelect={() => setDeleteOpen(true)}
                  variant='destructive'
                >
                  <DeleteIcon aria-hidden='true' />
                  {t('grid.row.delete')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {deleteOpen ? <DeleteRowConfirm onClose={() => setDeleteOpen(false)} open rowIds={[rowId]} /> : null}
    </>
  );
}

export default FeedCardActions;
