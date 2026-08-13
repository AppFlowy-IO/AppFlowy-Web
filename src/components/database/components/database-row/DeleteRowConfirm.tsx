import { useTranslation } from 'react-i18next';

import { useDatabaseViewLayout } from '@/application/database-yjs';
import { useTrashAwareDeleteRowsDispatch } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { ConfirmModal } from '@/components/_shared/modal/ConfirmModal';
import { Log } from '@/utils/log';

export function DeleteRowConfirm({
  open,
  onClose,
  rowIds,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  rowIds: string[];
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const deleteRowsDispatch = useTrashAwareDeleteRowsDispatch();

  const layout = useDatabaseViewLayout();
  const handleDelete = () => {
    void deleteRowsDispatch(rowIds).catch((e) => {
      Log.error('[DeleteRowConfirm] delete rows failed', e);
    });
    onDeleted?.();
    onClose();
  };

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      title={t('grid.row.delete')}
      description={t(
        layout === DatabaseViewLayout.Calendar ? 'calendar.deleteEventPrompt' : 'grid.row.deleteRowPrompt',
        { count: rowIds.length }
      )}
      cancelText={t('button.cancel')}
      confirmText={t('button.delete')}
      onConfirm={handleDelete}
      confirmTestId='delete-row-confirm-button'
    />
  );
}

export default DeleteRowConfirm;
