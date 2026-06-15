import { useTranslation } from 'react-i18next';

import { useDatabaseViewLayout } from '@/application/database-yjs';
import { useBulkDeleteRowDispatch } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
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
  const deleteRowsDispatch = useBulkDeleteRowDispatch();

  const layout = useDatabaseViewLayout();
  const handleDelete = () => {
    deleteRowsDispatch(rowIds);
    onDeleted?.();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(status) => {
        if (!status) {
          onClose();
        }
      }}
    >
      <DialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          Log.debug(e.key);
          if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
            handleDelete();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('grid.row.delete')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t(layout === DatabaseViewLayout.Calendar ? 'calendar.deleteEventPrompt' : 'grid.row.deleteRowPrompt', {
            count: rowIds?.length || 0,
          })}
        </DialogDescription>
        <DialogFooter>
          <Button variant={'outline'} onClick={onClose}>
            {t('button.cancel')}
          </Button>
          <Button variant={'destructive'} onClick={handleDelete} data-testid="delete-row-confirm-button">
            {t('button.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteRowConfirm;
