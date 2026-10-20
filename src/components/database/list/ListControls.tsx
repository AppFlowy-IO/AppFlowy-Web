import { useTranslation } from 'react-i18next';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { cn } from '@/lib/utils';

export function ListLoadingIndicator({ fillAvailable = false }: { fillAvailable?: boolean }) {
  return (
    <div
      aria-label='Loading rows'
      className={cn('flex w-full justify-center pt-[30px]', fillAvailable && 'h-full items-center')}
      role='status'
    >
      <span className='h-9 w-9 animate-spin rounded-full border-[3px] border-border-primary border-t-fill-theme-thick motion-reduce:animate-none' />
    </div>
  );
}

export function ListLoadMore({
  groupId,
  onLoadMore,
  remainingCount,
}: {
  groupId?: string;
  onLoadMore: () => void;
  remainingCount: number;
}) {
  const { t } = useTranslation();

  return (
    <button
      className='ml-10 flex h-8 w-[calc(100%_-_2.5rem)] items-center gap-2 rounded-[4px] text-left text-sm font-medium text-text-tertiary hover:bg-fill-content-hover focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
      data-group-id={groupId}
      data-testid='list-load-more'
      onClick={onLoadMore}
      type='button'
    >
      <PlusIcon aria-hidden='true' className='h-4 w-4' />
      {t('grid.row.loadMore')} ({remainingCount})
    </button>
  );
}

export function ListLoadMoreIndicator() {
  return (
    <div aria-label='Loading more rows' className='flex h-14 items-center justify-center' role='status'>
      <span className='h-6 w-6 animate-spin rounded-full border-2 border-border-primary border-t-fill-theme-thick motion-reduce:animate-none' />
    </div>
  );
}

export function ListNewRow() {
  const { t } = useTranslation();
  const createRow = useNewRowDispatch();

  return (
    <button
      className='ml-10 flex h-10 w-[calc(100%_-_2.5rem)] items-center gap-1.5 rounded-[4px] px-2 text-left text-sm text-text-tertiary hover:bg-fill-content-hover'
      data-testid='list-new-row'
      onClick={() => void createRow({ openAfterCreate: true, tailing: true })}
      type='button'
    >
      <PlusIcon aria-hidden='true' className='h-4 w-4' />
      {t('grid.row.newRow')}
    </button>
  );
}
