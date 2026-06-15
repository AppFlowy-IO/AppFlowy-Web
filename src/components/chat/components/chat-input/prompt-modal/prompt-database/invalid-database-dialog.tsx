import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function InvalidDatabaseDialog({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className={'!text-left'}>
          <DialogTitle>{t('chat.customPrompt.invalidDatabase')}</DialogTitle>
          <DialogDescription className={'whitespace-pre-line'}>
            {t('chat.customPrompt.invalidDatabaseHelp')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={() => {
              setIsOpen(false);
            }}
            type='submit'
          >
            {t('chat.customPrompt.button.ok')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
