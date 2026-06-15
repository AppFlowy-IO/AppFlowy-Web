import React from 'react';
import { useTranslation } from 'react-i18next';

import { useWriterContext } from '@/components/chat/writer/context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription, DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';


export const ConfirmDiscard = React.forwardRef<HTMLDivElement, {
  open: boolean;
  onClose: () => void;
}>(({ open, onClose }, ref) => {
  const { t } = useTranslation();
  const { exit } = useWriterContext();

  return <Dialog
    open={open}
    onOpenChange={(open) => !open && onClose()}
  >
    <DialogContent
      ref={ref}
      onOpenAutoFocus={e => e.preventDefault()}
      onCloseAutoFocus={e => e.preventDefault()}
    >
      <DialogHeader className={'!text-left'}>
        <DialogTitle>{t('chat.writer.discard')}</DialogTitle>
        <DialogDescription>
          {t('chat.writer.confirm-discard')}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant={'outline'}
          onClick={onClose}
        >{t('chat.writer.button.cancel')}</Button>
        <Button
          onClick={() => {
            exit();
            onClose();
          }}
          variant={'destructive'}
          type="submit"
        >{t('chat.writer.button.discard')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
});