import { lazy, memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRowReactions, useToggleRowReactionDispatch } from '@/application/database-yjs';
import { ReactComponent as AddEmojiIcon } from '@/assets/icons/add_emoji.svg';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useFeedMembers } from './FeedMembersContext';

const EmojiPicker = lazy(() =>
  import('@/components/_shared/emoji-picker').then((module) => ({ default: module.EmojiPicker }))
);

/** Desktop `FeedRowReactions`: reaction chips plus an add-reaction chip when commenting is allowed. */
export const FeedRowReactions = memo(function FeedRowReactions({ rowId }: { rowId: string }) {
  const { t } = useTranslation();
  const reactions = useRowReactions(rowId);
  const toggleReaction = useToggleRowReactionDispatch(rowId);
  const { canComment, currentUid } = useFeedMembers();
  const [pickerOpen, setPickerOpen] = useState(false);
  const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);
  const canReact = canComment && currentUid !== null;

  if (entries.length === 0 && !canReact) return null;

  return (
    <div
      className='mt-1.5 flex flex-wrap items-center gap-1'
      data-feed-interactive='true'
      data-testid={`feed-row-reactions-${rowId}`}
    >
      {entries.map(([emoji, users]) => {
        const hasReacted = currentUid !== null && users.includes(currentUid);

        return (
          <button
            aria-label={t('feed.toggleReaction', { emoji })}
            aria-pressed={hasReacted}
            className={cn(
              'flex h-7 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
              hasReacted
                ? 'border-border-theme-thick bg-fill-theme-light text-text-theme'
                : 'border-border-primary bg-transparent text-text-secondary',
              canReact ? 'hover:bg-fill-content-hover' : 'cursor-default'
            )}
            data-reacted={hasReacted}
            data-testid={`feed-row-reaction-${rowId}-${emoji}`}
            disabled={!canReact}
            key={emoji}
            onClick={(event) => {
              event.stopPropagation();
              if (canReact) toggleReaction(emoji, currentUid);
            }}
            type='button'
          >
            <span>{emoji}</span>
            <span data-testid={`feed-row-reaction-count-${rowId}-${emoji}`}>{users.length}</span>
          </button>
        );
      })}

      {canReact ? (
        <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  aria-label={t('feed.addReaction')}
                  className='flex h-7 items-center rounded-full border border-dashed border-border-primary px-2 text-icon-secondary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
                  data-testid={`feed-row-add-reaction-${rowId}`}
                  onClick={(event) => event.stopPropagation()}
                  type='button'
                >
                  <AddEmojiIcon aria-hidden='true' className='h-4 w-4' />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('feed.addReaction')}</TooltipContent>
          </Tooltip>
          <PopoverContent align='start' className='w-auto min-w-0 p-0' onClick={(event) => event.stopPropagation()}>
            <Suspense fallback={null}>
              <EmojiPicker
                onEmojiSelect={(emoji) => {
                  toggleReaction(emoji, currentUid);
                  setPickerOpen(false);
                }}
              />
            </Suspense>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
});

export default FeedRowReactions;
