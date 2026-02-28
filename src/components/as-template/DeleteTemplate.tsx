import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { TemplateService } from '@/application/services/domains';

function DeleteTemplate ({ onDeleted, id, onClose, open }: {
  id: string;
  onClose: () => void;
  open: boolean;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const onSubmit = useCallback(async () => {
    try {
      await TemplateService.remove(id);
      onClose();
      onDeleted?.();
      notify.success(t('template.deleteSuccess'));
    } catch (error) {
      notify.error('Failed to delete template');
    }
  }, [t, onClose, id, onDeleted]);

  return (
    <NormalModal
      onOk={onSubmit}
      danger
      okText={t('button.delete')}
      title={<div className={'text-left font-semibold'}>{t('template.deleteFromTemplate')}</div>}
      onCancel={onClose}
      open={open}
      onClose={onClose}
      onClick={(e) => e.stopPropagation()}
    >
      {t('template.deleteTemplateDescription')}
    </NormalModal>
  );
}

export default DeleteTemplate;