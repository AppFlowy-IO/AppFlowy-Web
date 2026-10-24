import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { GalleryCardSize } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { RowCreationSpinner, useRowCreationAction } from '@/components/database/hooks/useRowCreationAction';
import { cn } from '@/lib/utils';

import { GALLERY_TILE_PADDING, getGalleryMinimumCardHeight } from './gallery.constants';

/**
 * Figma "New page" tile (node 7422:204489): an outlined, transparent slot that
 * takes the next card position and stretches to the height of its row.
 */
export function GalleryNewPageTile({
  cardSize,
  onCreate,
  testId = 'gallery-new-row',
}: {
  cardSize: GalleryCardSize;
  onCreate: () => Promise<unknown>;
  testId?: string;
}) {
  const { t } = useTranslation();
  const { pending: creating, run } = useRowCreationAction();
  const minimumHeight = getGalleryMinimumCardHeight(cardSize);

  return (
    <div className='h-full' data-testid={`${testId}-tile`} style={{ minHeight: minimumHeight + GALLERY_TILE_PADDING * 2 }}>
      <button
        aria-busy={creating}
        aria-label={t('gallery.newPage')}
        className={cn(
          'flex h-full w-full items-center justify-center gap-1.5 rounded-400 border border-border-primary bg-transparent text-sm font-medium text-text-secondary',
          'transition-[border-color,background-color] ease-out [transition-duration:120ms] motion-reduce:transition-none',
          'hover:border-border-primary-hover hover:bg-fill-content-hover focus-visible:border-border-theme-thick focus-visible:outline-none disabled:cursor-wait'
        )}
        data-testid={testId}
        disabled={creating}
        onClick={() => void run(onCreate)}
        style={{ minHeight: minimumHeight }}
        type='button'
      >
        {creating ? <RowCreationSpinner /> : <PlusIcon aria-hidden='true' className='h-5 w-5 text-icon-tertiary' />}
        {t('gallery.newPage')}
      </button>
    </div>
  );
}

export function GalleryNewRow({ cardSize }: { cardSize: GalleryCardSize }) {
  const createRow = useNewRowDispatch();
  const create = useCallback(() => createRow({ openAfterCreate: false, tailing: true }), [createRow]);

  return <GalleryNewPageTile cardSize={cardSize} onCreate={create} />;
}

export default GalleryNewRow;
