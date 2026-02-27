import { useTranslation } from 'react-i18next';

import { ReactComponent as RestoreIcon } from '@/assets/icons/restore.svg';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface RevertedDialogProps {
  open: boolean;
  onDismiss: () => void;
}

export function RevertedDialog({ open, onDismiss }: RevertedDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onDismiss(); }}>
      <DialogContent
        data-testid='reverted-dialog'
        size='sm'
        showCloseButton={false}
      >
        <DialogHeader>
          <div className='flex items-center gap-2'>
            <RestoreIcon className='h-5 w-5 shrink-0 text-text-tertiary' />
            <DialogTitle>{t('versionHistory.revertedDialogTitle')}</DialogTitle>
          </div>
        </DialogHeader>
        <DialogDescription>
          {t('versionHistory.revertedDialogDescription')}
        </DialogDescription>
        <DialogFooter>
          <Button data-testid='reverted-dialog-confirm' onClick={onDismiss}>
            {t('versionHistory.revertedDismiss')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
