import React from 'react';
import { useTranslation } from 'react-i18next';

import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { useAppOperations, useAppView } from '@/components/app/app.hooks';

function DeleteSpaceConfirm({ open, onClose, viewId }: { open: boolean; onClose: () => void; viewId: string }) {
  const view = useAppView(viewId);

  const [loading, setLoading] = React.useState(false);
  const { deletePage } = useAppOperations();
  const { t } = useTranslation();

  const handleOk = async () => {
    if (!view) return;
    setLoading(true);
    try {
      await deletePage?.(viewId);
      onClose();
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <NormalModal
      keepMounted={false}
      okText={t('button.delete')}
      cancelText={t('button.cancel')}
      open={open}
      danger={true}
      onClose={onClose}
      okLoading={loading}
      title={
        <div className={'flex w-full items-center text-left font-semibold'}>{`${t('button.delete')}: ${
          view?.name
        }`}</div>
      }
      onOk={handleOk}
      PaperProps={{
        className: 'w-[420px] max-w-[70vw]',
      }}
    >
      <div className={'font-normal text-text-secondary'}>{t('space.deleteConfirmationDescription')}</div>
    </NormalModal>
  );
}

export default DeleteSpaceConfirm;
