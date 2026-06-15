import { useTranslation } from 'react-i18next';

import { useClearCellsWithFieldDispatch } from '@/application/database-yjs/dispatch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ClearCellsConfirm ({ open, onClose, fieldId }: {
  open: boolean;
  onClose: () => void;
  fieldId: string;
}) {
  const { t } = useTranslation();
  const onClear = useClearCellsWithFieldDispatch();

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
          <DialogTitle>{t('grid.field.clear')}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t('grid.field.clearFieldPromptMessage')}
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
              onClear(fieldId);
              onClose();
            }}
          >{t('button.clear')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ClearCellsConfirm;
