import { useTranslation } from 'react-i18next';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { GalleryCardSize } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { RowCreationSpinner, useRowCreationAction } from '@/components/database/hooks/useRowCreationAction';
import { cn } from '@/lib/utils';

import { GALLERY_TILE_PADDING, getGalleryMinimumCardHeight } from './gallery.constants';

export function GalleryNewRow({ cardSize }: { cardSize: GalleryCardSize }) {
  const { t } = useTranslation();
  const createRow = useNewRowDispatch();
  const { pending: creating, run } = useRowCreationAction();
  const minimumHeight = getGalleryMinimumCardHeight(cardSize);

  return (
    <div
      className='h-full'
      data-testid='gallery-new-row-tile'
      style={{ minHeight: minimumHeight + GALLERY_TILE_PADDING * 2 }}
    >
      <button
        aria-busy={creating}
        aria-label={t('grid.row.newRow')}
        className={cn(
          'flex h-full w-full items-center justify-center gap-1.5 rounded-[10px] border border-border-primary bg-surface-primary text-sm font-medium text-text-secondary',
          'transition-[border-color,box-shadow] ease-out [transition-duration:120ms] motion-reduce:transition-none',
          'hover:border-border-primary-hover hover:shadow-dialog focus-visible:border-border-theme-thick focus-visible:shadow-dialog focus-visible:outline-none disabled:cursor-wait'
        )}
        data-testid='gallery-new-row'
        disabled={creating}
        onClick={() => void run(() => createRow({ openAfterCreate: false, tailing: true }))}
        style={{ minHeight: minimumHeight }}
        type='button'
      >
        {creating ? <RowCreationSpinner /> : <PlusIcon aria-hidden='true' className='h-5 w-5 text-icon-tertiary' />}
        {t('grid.row.newRow')}
      </button>
    </div>
  );
}

export default GalleryNewRow;
