import Dialog from '@mui/material/Dialog';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as RestoreIcon } from '@/assets/icons/restore.svg';
import { Button } from '@/components/ui/button';

interface RevertedDialogProps {
  open: boolean;
  onDismiss: () => void;
  kind?: 'document' | 'database';
}

export function RevertedDialog({ open, onDismiss, kind = 'document' }: RevertedDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();

  return (
    // Row editors, history and page modals share MUI's focus manager. Joining
    // that stack lets the notice take focus without per-editor exceptions.
    <Dialog
      open={open}
      onClose={onDismiss}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      maxWidth={false}
      PaperProps={{
        'data-testid': 'reverted-dialog',
        className: 'w-[400px] rounded-500 border border-border-primary bg-surface-primary px-5 py-4 shadow-dialog',
      }}
    >
      <div className='mb-3 flex items-center gap-2'>
        <RestoreIcon className='h-5 w-5 shrink-0 text-text-tertiary' />
        <h2 id={titleId} className='text-base font-bold'>
          {t(kind === 'database' ? 'versionHistory.databaseRestoredTitle' : 'versionHistory.revertedDialogTitle')}
        </h2>
      </div>
      <p id={descriptionId} className='text-sm font-normal text-text-primary'>
        {t(
          kind === 'database' ? 'versionHistory.databaseRestoredDescription' : 'versionHistory.revertedDialogDescription'
        )}
      </p>
      <div className='mt-5 flex justify-end'>
        <Button autoFocus data-testid='reverted-dialog-confirm' onClick={onDismiss}>
          {t('versionHistory.revertedDismiss')}
        </Button>
      </div>
    </Dialog>
  );
}
