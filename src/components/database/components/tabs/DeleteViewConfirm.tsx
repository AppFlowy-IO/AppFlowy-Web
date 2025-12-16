import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDeleteView } from '@/application/database-yjs/dispatch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DeleteViewConfirm ({ open, onClose, viewId, onDeleted }: {
  open: boolean;
  onClose: () => void;
  viewId: string;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const deleteView = useDeleteView();

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
          <DialogTitle>{t('button.delete')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t('grid.deleteView')}
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
            data-testid="database-view-delete-confirm"
            onClick={async () => {
              try {
                await deleteView(viewId);
                onDeleted?.();
                onClose();
                // eslint-disable-next-line
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >{t('button.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteViewConfirm;
