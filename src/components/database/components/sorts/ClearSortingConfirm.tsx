import { useTranslation } from 'react-i18next';

import { useClearSortingDispatch } from '@/application/database-yjs/dispatch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ClearSortingConfirm ({ open, onClose, onRemoved }: {
  open: boolean;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const clearSortingDispatch = useClearSortingDispatch();

  return (
    <Dialog
      open={open}
      onOpenChange={status => {
        if (!status) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('grid.sort.sortsActive', {
            intention: t('grid.row.reorderRowDescription'),
          })}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t('grid.sort.removeSorting')}
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
              clearSortingDispatch();
              onRemoved?.();
              onClose();
            }}
          >{t('button.remove')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ClearSortingConfirm;