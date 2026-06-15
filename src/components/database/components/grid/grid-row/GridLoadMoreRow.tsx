import { useTranslation } from 'react-i18next';

import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useGridContext } from '@/components/database/grid/useGridContext';

function GridLoadMoreRow({ remainingCount }: { remainingCount: number }) {
  const { t } = useTranslation();
  const { loadMoreRows } = useGridContext();

  return (
    <button
      type='button'
      data-testid='grid-load-more-row'
      onClick={loadMoreRows}
      className={
        'flex h-[36px] w-full flex-1 cursor-pointer items-center gap-1.5 border-t border-border-primary bg-fill-content px-3 py-2 text-left text-sm font-medium text-text-secondary hover:bg-fill-content-hover'
      }
    >
      <PlusIcon className={'h-5 w-5'} />
      {t('grid.row.loadMore')} ({remainingCount})
    </button>
  );
}

export default GridLoadMoreRow;
