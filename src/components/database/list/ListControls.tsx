import { useTranslation } from 'react-i18next';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';

const LIST_LOADING_DOT_COLORS = ['#00b5ff', '#e3006d', '#f7931e'] as const;

export function ListLoadingIndicator() {
  return (
    <div aria-label='Loading rows' className='flex h-9 w-full items-center justify-center gap-1.5' role='status'>
      {LIST_LOADING_DOT_COLORS.map((color, index) => (
        <span
          className='h-1.5 w-1.5 animate-bounce rounded-full'
          key={color}
          style={{
            animationDelay: `${index * 120}ms`,
            animationDuration: '900ms',
            backgroundColor: color,
          }}
        />
      ))}
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
      className='ml-10 flex h-9 w-[calc(100%_-_2.5rem)] items-center gap-1.5 rounded-[4px] px-2 text-left text-sm font-medium text-text-tertiary hover:bg-fill-content-hover'
      data-group-id={groupId}
      data-testid='list-load-more'
      onClick={onLoadMore}
      type='button'
    >
      <PlusIcon className='h-4 w-4' />
      {t('grid.row.loadMore')} ({remainingCount})
    </button>
  );
}

export function ListLoadMoreIndicator() {
  return (
    <div aria-label='Loading more rows' className='flex h-10 items-center justify-center' role='status'>
      <span className='h-5 w-5 animate-spin rounded-full border-2 border-border-primary border-t-fill-theme-thick' />
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
      <PlusIcon className='h-4 w-4' />
      {t('grid.row.newRow')}
    </button>
  );
}
