import { useTranslation } from 'react-i18next';

import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { RowCreationSpinner, useRowCreationAction } from '@/components/database/hooks/useRowCreationAction';
import { useCreateListGroupRow } from '@/components/database/list/ListGroup';

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
      {pending ? <RowCreationSpinner /> : <PlusIcon aria-hidden className='h-5 w-5' />}
      {t('grid.row.newRow')}
    </button>
  );
}
