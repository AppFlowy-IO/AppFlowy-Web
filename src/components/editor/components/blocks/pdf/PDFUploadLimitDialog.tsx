import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import closeIcon from '@/assets/icons/pdf/figma/dialog/20d5f63a58fd9a3f8102d12677cda96c546ba06a.svg';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export function PDFUploadLimitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [, setSearch] = useSearchParams();

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size='sm'
        showCloseButton={false}
        className='gap-0 rounded-2xl border-0 bg-surface-layer-03 px-5 py-4 shadow-[0_4px_32px_#0000001f]'
      >
        <div className='flex h-7 items-center gap-1.5'>
          <DialogTitle className='flex-1 text-base font-bold leading-[22px]'>
            {t('document.plugins.pdf.upgradeTitle')}
          </DialogTitle>
          <DialogClose asChild>
            <Button variant='ghost' size='icon' aria-label={t('button.close')}>
              <img src={closeIcon} alt='' />
            </Button>
          </DialogClose>
        </div>
        <DialogDescription className='pb-5 pt-3 text-sm leading-5 text-text-primary'>
          {t('document.plugins.pdf.upgradeDescription')}
        </DialogDescription>
        <div className='flex justify-end gap-3'>
          <Button variant='outline' className='h-8 min-w-[70px] rounded-lg font-medium' onClick={onClose}>
            {t('button.cancel')}
          </Button>
          <Button
            className='h-8 min-w-[70px] rounded-lg font-medium'
            onClick={() => {
              onClose();
              setSearch((previous) => {
                const next = new URLSearchParams(previous);

                next.set('action', 'change_plan');
                return next;
              });
            }}
          >
            {t('document.plugins.pdf.upgrade')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
