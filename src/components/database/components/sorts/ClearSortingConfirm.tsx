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

interface ClearSortingConfirmProps {
  open: boolean;
  onClose: () => void;
  onRemoved?: () => void;
}

/**
 * Rendered only while open (the dialog has no exit animation): a closed
 * confirm renders nothing, so lists can keep one per row (W8).
 */
export function ClearSortingConfirm (props: ClearSortingConfirmProps) {
  return props.open ? <ClearSortingConfirmDialog {...props} /> : null;
}

function ClearSortingConfirmDialog ({ open, onClose, onRemoved }: ClearSortingConfirmProps) {
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