import { useTranslation } from 'react-i18next';

import { useDeletePropertyDispatch } from '@/application/database-yjs/dispatch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DeletePropertyConfirm ({ open, onClose, fieldId }: {
  open: boolean;
  onClose: () => void;
  fieldId: string;
}) {
  const { t } = useTranslation();
  const deleteDispatch = useDeletePropertyDispatch();

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
          <DialogTitle>{t('grid.field.delete')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t('grid.field.deleteFieldPromptMessage')}
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
              deleteDispatch(fieldId);
              onClose();
            }}
          >{t('button.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeletePropertyConfirm;
