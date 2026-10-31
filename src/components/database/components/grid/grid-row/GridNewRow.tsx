import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseContext, useDatabaseFields, useDatabaseView } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { getGroupRowCellsData } from '@/application/database-yjs/group-row';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { RowCreationSpinner, useRowCreationAction } from '@/components/database/hooks/useRowCreationAction';

export const getGridGroupCellsData = getGroupRowCellsData;

export function useCreateGridGroupRow(groupFieldId?: string, groupId?: string) {
  const onNewRow = useNewRowDispatch();
  const { isDocumentBlock } = useDatabaseContext();
  const { lastVisibleRowId, revealCreatedRow } = useGridContext();
  const fields = useDatabaseFields();
  const view = useDatabaseView();

  return useCallback(async () => {
    const cellsData = getGridGroupCellsData(fields, groupFieldId, groupId, view);

    await onNewRow(
      isDocumentBlock
        ? {
            beforeRowId: lastVisibleRowId,
            cellsData,
            tailing: !lastVisibleRowId,
          }
        : { cellsData, tailing: true }
    );
    revealCreatedRow();
  }, [fields, groupFieldId, groupId, isDocumentBlock, lastVisibleRowId, onNewRow, revealCreatedRow, view]);
}

function GridNewRow({ groupFieldId, groupId }: { groupFieldId?: string; groupId?: string }) {
  const { t } = useTranslation();
  const createRow = useCreateGridGroupRow(groupFieldId, groupId);
  const { pending, run } = useRowCreationAction();

  return (
    <button
      type='button'
      disabled={pending}
      aria-busy={pending}
      data-parity-id='dash-widget-grid-new-row'
      data-testid='grid-new-row'
      onClick={() => {
        void run(createRow);
      }}
      className={
        'flex h-[36px] w-full cursor-pointer items-center gap-1.5 border-b border-t border-border-primary bg-fill-content px-3 py-2 text-sm font-medium text-text-secondary hover:bg-fill-content-hover'
      }
      data-group-id={groupId}
    >
      {/* "+ New page" (addendum A6): the 16px add glyph and the shared grid.row.newRow label. */}
      {pending ? <RowCreationSpinner className='h-4 w-4' /> : <PlusIcon aria-hidden='true' className={'h-4 w-4'} data-parity-id='dash-widget-grid-new-row__icon' />}
      <span className='leading-5' data-parity-id='dash-widget-grid-new-row__label'>
        {t('grid.row.newRow')}
      </span>
    </button>
  );
}

export default GridNewRow;
