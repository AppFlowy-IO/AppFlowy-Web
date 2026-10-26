import { useTranslation } from 'react-i18next';

import { GalleryCardSize } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { RowCreationSpinner, useRowCreationAction } from '@/components/database/hooks/useRowCreationAction';
import { useCreateListGroupRow } from '@/components/database/list/ListGroup';

import { GalleryNewPageTile } from './GalleryNewRow';

/** Figma group footer (node 7435:211106): one column wide, used when the group's last row is full. */
export function GalleryGroupFooter({ fieldId, groupId }: { fieldId?: string; groupId: string }) {
  const { t } = useTranslation();
  const createRow = useCreateListGroupRow(fieldId, groupId, true);
  const { pending, run } = useRowCreationAction();

  return (
    <button
      aria-busy={pending}
      className='flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-border-primary text-sm font-medium text-text-secondary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick disabled:cursor-wait'
      data-testid={`gallery-group-new-row-${groupId}`}
      disabled={pending}
      onClick={() => void run(createRow)}
      type='button'
    >
      {pending ? <RowCreationSpinner /> : <PlusIcon aria-hidden className='h-5 w-5 text-icon-tertiary' />}
      {t('gallery.newPage')}
    </button>
  );
}

/** Figma group grid (node 7435:211112): the "New page" tile fills a free slot in the group's last row. */
export function GalleryGroupNewPageTile({
  cardSize,
  fieldId,
  groupId,
}: {
  cardSize: GalleryCardSize;
  fieldId?: string;
  groupId: string;
}) {
  const createRow = useCreateListGroupRow(fieldId, groupId, true);

  return <GalleryNewPageTile cardSize={cardSize} onCreate={createRow} testId={`gallery-group-new-page-${groupId}`} />;
}
