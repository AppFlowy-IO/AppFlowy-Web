import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { TemplateService } from '@/application/services/domains';

function DeleteCreator ({ id, onClose, onDeleted, open }: {
  id: string;
  onClose: () => void;
  onDeleted: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const onSubmit = useCallback(async () => {
    try {
      await TemplateService.deleteCreator(id);
      onDeleted();
      onClose();
    } catch (error) {
      notify.error('Failed to delete creator');
    }
  }, [onDeleted, onClose, id]);

  return (
    <NormalModal
      onOk={onSubmit}
      danger
      okText={t('button.delete')}
      title={<div className={'text-left'}>{t('template.creator.deleteCreator')}</div>}
      onCancel={onClose}
      open={open}
      onClose={onClose}
      onClick={(e) => e.stopPropagation()}
    >
      {t('template.creator.deleteCreatorDescription')}
    </NormalModal>
  );
}

export default DeleteCreator;