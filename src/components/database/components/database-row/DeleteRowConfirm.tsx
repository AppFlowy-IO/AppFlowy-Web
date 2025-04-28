import { useDeleteRowDispatch } from '@/application/database-yjs/dispatch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';

export function DeleteRowConfirm ({ open, onClose, rowId }: {
  open: boolean;
  onClose: () => void;
  rowId: string;
}) {
  const { t } = useTranslation();
  const deleteRowDispatch = useDeleteRowDispatch();

  return (
    <Dialog
      open={open}
      onOpenChange={status => {
        if (!status) {
          onClose();
        }
      }}
    >
      <DialogContent
        onCloseAutoFocus={e => {
          e.preventDefault();
        }}
        onOpenAutoFocus={e => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('grid.row.delete')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t('grid.row.deleteRowPrompt')}
        </DialogDescription>
        <DialogFooter>
          <Button
            variant={'outline'}
            onClick={onClose}
          >
            {t('button.cancel')}
          </Button>
          <Button
            variant={'destructive'}
            onClick={() => {
              deleteRowDispatch(rowId);
              onClose();
            }}
          >{t('button.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteRowConfirm;