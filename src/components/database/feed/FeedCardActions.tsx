import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseContext, useToggleRowReactionDispatch } from '@/application/database-yjs';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import { UIVariant } from '@/application/types';
import { ReactComponent as AddReactionIcon } from '@/assets/icons/add_comment_reaction.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { notify } from '@/components/_shared/notify';
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
import { copyTextToClipboard } from '@/utils/copy';

import { buildFeedRowUrl } from './feed.utils';
import { useFeedMembers } from './FeedMembersContext';

// The picker (categories, virtualized grid, skin tones) is only needed once a
// popover opens, so keep it out of the feed chunk until then.
const EmojiPicker = lazy(() =>
  import('@/components/_shared/emoji-picker').then((module) => ({ default: module.EmojiPicker }))
);

const ACTION_BUTTON_CLASS_NAME = 'h-7 w-7 rounded-200 p-1 text-icon-secondary [&_svg]:h-5 [&_svg]:w-5';

/**
 * The Figma feed card's `Action Button`: an add-reaction button when
 * commenting is allowed and a more menu (copy link / duplicate / delete) when
 * the database is editable. Both stay visible while their popovers are open.
 */
interface FeedCardActionsProps {
  editable: boolean;
  /** A cover sits under the bar, so it needs its own surface to stay legible. */
  hasCover?: boolean;
  onOpenChange?: (open: boolean) => void;
  rowId: string;
}

export function FeedCardActions(props: FeedCardActionsProps) {
  const { canComment, currentUid } = useFeedMembers();
  const canReact = canComment && currentUid !== null;

  if (!canReact && !props.editable) return null;

  // Permission changes remove controls without Radix emitting onOpenChange.
  // Reset their local state and release the card's click guard on unmount.
  return (
    <FeedCardActionControls
      key={`${props.editable}:${canReact}`}
      {...props}
      canReact={canReact}
      currentUid={currentUid}
    />
  );
}

/** Copies the row link; null where a row has no shareable address (published pages). */
function useCopyFeedRowLink(rowId: string): (() => void) | null {
  const { t } = useTranslation();
  const { activeViewId, databasePageId, variant, workspaceId } = useDatabaseContext();

  if (!workspaceId || !databasePageId || variant === UIVariant.Publish) return null;

  return () => {
    const url = buildFeedRowUrl({
      databasePageId,
      origin: window.location.origin,
      rowId,
      viewId: activeViewId,
      workspaceId,
    });

    void copyTextToClipboard(url);
    notify.success(t('shareAction.copyLinkSuccess'));
  };
}

function FeedCardActionControls({
  editable,
  hasCover = false,
  onOpenChange,
  rowId,
  canReact,
  currentUid,
}: FeedCardActionsProps & { canReact: boolean; currentUid: string | null }) {
  const { t } = useTranslation();
  const duplicateRow = useDuplicateRowDispatch();
  const toggleReaction = useToggleRowReactionDispatch(rowId);
  const copyLink = useCopyFeedRowLink(rowId);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const forceVisible = emojiOpen || menuOpen;

  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

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
          'absolute right-4 top-4 z-20 flex items-center gap-1 rounded-300 p-1 transition-opacity motion-reduce:transition-none',
          hasCover && 'border border-border-primary bg-surface-layer-04 shadow-menu',
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
                    className={ACTION_BUTTON_CLASS_NAME}
                    data-testid={`feed-card-reaction-button-${rowId}`}
                    onClick={(event) => event.stopPropagation()}
                    size='icon'
                    type='button'
                    variant='ghost'
                  >
                    <AddReactionIcon aria-hidden='true' />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('feed.addReaction')}</TooltipContent>
            </Tooltip>
            <PopoverContent align='end' className='w-auto min-w-0 p-0' onClick={(event) => event.stopPropagation()}>
              <Suspense fallback={null}>
                <EmojiPicker
                  onEmojiSelect={(emoji) => {
                    if (canReact && currentUid !== null) toggleReaction(emoji, currentUid);
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
                    aria-label={t('button.more')}
                    className={ACTION_BUTTON_CLASS_NAME}
                    data-testid={`feed-card-more-${rowId}`}
                    onClick={(event) => event.stopPropagation()}
                    size='icon'
                    type='button'
                    variant='ghost'
                  >
                    <MoreIcon aria-hidden='true' />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('button.more')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align='end'
              data-testid='feed-row-action-menu'
              onClick={(event) => event.stopPropagation()}
              side='bottom'
              sideOffset={8}
            >
              <DropdownMenuGroup>
                {copyLink ? (
                  <DropdownMenuItem data-testid='feed-row-copy-link' onSelect={copyLink}>
                    <LinkIcon aria-hidden='true' />
                    {t('shareAction.copyLink')}
                  </DropdownMenuItem>
                ) : null}
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

        {/* Dialog portals bubble through React ancestors, so keep confirmation clicks inside this boundary. */}
        {deleteOpen ? <DeleteRowConfirm onClose={() => setDeleteOpen(false)} open rowIds={[rowId]} /> : null}
      </div>
    </>
  );
}

export default FeedCardActions;
