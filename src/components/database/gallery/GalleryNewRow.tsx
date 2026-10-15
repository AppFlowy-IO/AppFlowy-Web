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
      className='h-full p-2'
      data-testid='gallery-new-row-tile'
      style={{ minHeight: minimumHeight + GALLERY_TILE_PADDING * 2 }}
    >
      <button
        aria-busy={creating}
        aria-label={t('grid.row.newRow')}
        className={cn(
          'flex h-full w-full items-center justify-center rounded-[10px] border bg-white',
          'border-[rgba(31,35,41,0.14)] text-[rgba(23,23,23,0.4)]',
          'transition-[border-color,box-shadow] ease-out [transition-duration:120ms] motion-reduce:transition-none',
          'hover:border-[rgba(0,188,240,0.65)] hover:shadow-[0_6px_12px_rgba(31,35,41,0.10)]',
          'focus-visible:border-[rgba(0,188,240,0.65)] focus-visible:outline-none',
          'focus-visible:shadow-[0_6px_12px_rgba(31,35,41,0.10)]',
          'disabled:cursor-wait',
          '[[data-dark-mode=true]_&]:border-[#59647A] [[data-dark-mode=true]_&]:bg-[#1A202C]',
          '[[data-dark-mode=true]_&]:text-[rgba(255,255,255,0.4)]',
          '[[data-dark-mode=true]_&]:hover:border-[rgba(0,188,240,0.65)]',
          '[[data-dark-mode=true]_&]:hover:shadow-[0_6px_12px_rgba(0,0,0,0.22)]',
          '[[data-dark-mode=true]_&]:focus-visible:border-[rgba(0,188,240,0.65)]',
          '[[data-dark-mode=true]_&]:focus-visible:shadow-[0_6px_12px_rgba(0,0,0,0.22)]'
        )}
        data-testid='gallery-new-row'
        disabled={creating}
        onClick={() => void run(() => createRow({ openAfterCreate: true, tailing: true }))}
        style={{ minHeight: minimumHeight }}
        type='button'
      >
        {creating ? <RowCreationSpinner /> : <PlusIcon aria-hidden='true' className={'h-4 w-4'} />}
      </button>
    </div>
  );
}

export default GalleryNewRow;
