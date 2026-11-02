import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseViewLayout } from '@/application/database-yjs';
import { useTrashAwareDeleteRowsDispatch } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { ConfirmModal } from '@/components/_shared/modal/ConfirmModal';
import { Log } from '@/utils/log';

interface DeleteRowConfirmProps {
  open: boolean;
  onClose: () => void;
  rowIds: string[];
  onDeleted?: () => void;
}

/**
 * Mounted the first time it opens, then kept for the modal's exit transition:
 * a closed confirm renders nothing, so lists can keep one per row (W8).
 */
export function DeleteRowConfirm(props: DeleteRowConfirmProps) {
  const [opened, setOpened] = useState(props.open);

  if (props.open && !opened) setOpened(true);

  return opened ? <DeleteRowConfirmModal {...props} /> : null;
}

function DeleteRowConfirmModal({ open, onClose, rowIds, onDeleted }: DeleteRowConfirmProps) {
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
