import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NormalModal } from '@/components/_shared/modal';
import { HIDDEN_BUTTON_PROPS, MODAL_CLASSES, MODAL_PAPER_PROPS } from '@/components/app/workspaces/modal-props';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

export interface LogoutOptions {
  /** Also remove this account's copies of pages from the browser. */
  removeLocalData: boolean;
}

export function LogoutConfirm({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: LogoutOptions) => void;
}) {
  const { t } = useTranslation();
  const switchId = useId();
  const descriptionId = useId();
  // Copies are kept by default; removing them is an explicit choice for shared computers.
  const [removeLocalData, setRemoveLocalData] = useState(false);

  useEffect(() => {
    if (open) setRemoveLocalData(false);
  }, [open]);

  const handleLogout = () => {
    onConfirm({ removeLocalData });
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
      <div className='mt-4 flex items-start gap-3'>
        <Switch
          id={switchId}
          className='mt-0.5'
          checked={removeLocalData}
          onCheckedChange={setRemoveLocalData}
          aria-describedby={descriptionId}
          data-testid='logout-remove-local-data'
        />
        <div className='flex flex-col gap-1'>
          <label htmlFor={switchId} className='cursor-pointer text-sm text-text-primary'>
            {t('settings.menu.logoutRemoveLocalData')}
          </label>
          <p id={descriptionId} className='text-xs text-text-secondary'>
            {t('settings.menu.logoutRemoveLocalDataDescription')}
          </p>
        </div>
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
