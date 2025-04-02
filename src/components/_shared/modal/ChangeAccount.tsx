import NormalModal from '@/components/_shared/modal/NormalModal';
import { AFConfigContext, useCurrentUser } from '@/components/main/app.hooks';
import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';

function ChangeAccount({
  setModalOpened,
  modalOpened,
  redirectTo,
}: {
  setModalOpened: (opened: boolean) => void;
  modalOpened: boolean;
  redirectTo: string;
}) {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const openLoginModal = useContext(AFConfigContext)?.openLoginModal;
  const { t } = useTranslation();

  return (
    <NormalModal
      onCancel={() => {
        setModalOpened(false);
        navigate('/');
      }}
      closable={false}
      cancelText={t('invitation.errorModal.close')}
      onOk={() => {
        openLoginModal?.(redirectTo);
      }}
      okText={t('invitation.errorModal.changeAccount')}
      title={
        <div className={'flex items-center gap-2 text-left font-bold'}>
          <ErrorIcon className={'h-5 w-5 text-function-error'} />
          {t('invitation.errorModal.title')}
        </div>
      }
      open={modalOpened}
    >
      <div className={'flex flex-col gap-1 whitespace-pre-wrap break-words text-sm text-text-title'}>
        {t('invitation.errorModal.description', {
          email: currentUser?.email,
        })}
      </div>
    </NormalModal>
  );
}

export default ChangeAccount;
