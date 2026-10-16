import { useTranslation } from 'react-i18next';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { RowCreationSpinner, useRowCreationAction } from '@/components/database/hooks/useRowCreationAction';
import { cn } from '@/lib/utils';

export function FeedLoadingIndicator({ fillAvailable = false }: { fillAvailable?: boolean }) {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t('grid.row.loading', 'Loading rows')}
      className={cn('flex w-full justify-center pt-[30px]', fillAvailable && 'h-full items-center')}
      data-testid='feed-loading'
      role='status'
    >
      <span className='h-9 w-9 animate-spin rounded-full border-[3px] border-border-primary border-t-fill-theme-thick motion-reduce:animate-none' />
    </div>
  );
}

/** Desktop `LocaleKeys.feed_noItemsInFeed` centered in the page body. */
export function FeedEmptyState() {
  const { t } = useTranslation();

  return (
    <div
      className='flex h-full min-h-[120px] w-full items-center justify-center text-sm font-medium text-text-secondary'
      data-testid='feed-empty'
    >
      {t('feed.noItemsInFeed')}
    </div>
  );
}

/** Desktop `DatabaseLoadMoreButton` rendered after the visible cards. */
export function FeedLoadMore({ onLoadMore, remainingCount }: { onLoadMore: () => void; remainingCount: number }) {
  const { t } = useTranslation();

  return (
    <button
      className='mt-1.5 flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-sm font-medium text-text-tertiary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
      data-testid='feed-load-more'
      onClick={onLoadMore}
      type='button'
    >
      <PlusIcon aria-hidden='true' className='h-4 w-4 shrink-0' />
      {t('grid.row.loadMore')} ({remainingCount})
    </button>
  );
}

/** Desktop `_AddRowButton` (`feedAddRowButtonKey`): creates a row and opens its detail page. */
export function FeedNewRow() {
  const { t } = useTranslation();
  const createRow = useNewRowDispatch();
  const { pending: creating, run } = useRowCreationAction();

  return (
    <button
      aria-busy={creating}
      className={cn(
        'my-1.5 flex w-full items-center justify-center gap-1 rounded-lg border border-border-primary py-3 text-sm font-medium text-text-tertiary',
        'transition-colors hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick disabled:cursor-wait'
      )}
      data-testid='feed-new-row'
      disabled={creating}
      onClick={() => void run(() => createRow({ openAfterCreate: true, tailing: true }))}
      type='button'
    >
      {creating ? <RowCreationSpinner /> : <PlusIcon aria-hidden='true' className={'h-[18px] w-[18px]'} />}
      {t('grid.row.newRow')}
    </button>
  );
}
