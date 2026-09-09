import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseContext, useDatabaseFields, useDatabaseView } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { getGroupRowCellsData } from '@/application/database-yjs/group-row';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useGridContext } from '@/components/database/grid/useGridContext';

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

  return (
    <div
      data-testid='grid-new-row'
      onClick={() => {
        void createRow();
      }}
      className={
        'flex h-[36px] flex-1 cursor-pointer items-center gap-1.5 border-b border-t border-border-primary bg-fill-content px-3 py-2 text-sm font-medium text-text-secondary hover:bg-fill-content-hover'
      }
      data-group-id={groupId}
    >
      <PlusIcon className={'h-5 w-5'} />
      {t('grid.row.newRow')}
    </div>
  );
}

export default GridNewRow;
