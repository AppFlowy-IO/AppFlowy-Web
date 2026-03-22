import { useTranslation } from 'react-i18next';

import { NormalModal } from '@/components/_shared/modal';
import { HIDDEN_BUTTON_PROPS, MODAL_CLASSES, MODAL_PAPER_PROPS } from '@/components/app/workspaces/modal-props';
import { Button } from '@/components/ui/button';

export function LogoutConfirm({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  const handleLogout = () => {
    onConfirm();
    onClose();
  };

  return (
    <NormalModal
      open={open}
      onClose={onClose}
      title={<div style={{ textAlign: 'left' }}>{t('button.logout')}</div>}
      classes={MODAL_CLASSES}
      PaperProps={MODAL_PAPER_PROPS}
      okButtonProps={HIDDEN_BUTTON_PROPS}
      cancelButtonProps={HIDDEN_BUTTON_PROPS}
    >
      <div className='text-text-secondary'>
        {t('settings.menu.logoutPrompt')}
      </div>
      <div className='flex w-full justify-end gap-3 mt-4'>
        <Button variant='outline' onClick={onClose}>
          {t('button.cancel')}
        </Button>
        <Button variant='destructive' onClick={handleLogout} data-testid='logout-confirm-button'>
          {t('button.logout')}
        </Button>
      </div>
    </NormalModal>
  );
}

export default LogoutConfirm;
