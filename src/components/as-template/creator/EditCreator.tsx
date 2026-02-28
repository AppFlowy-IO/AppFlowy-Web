import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateCreator, TemplateCreatorFormValues } from '@/application/template.type';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import CreatorForm from '@/components/as-template/creator/CreatorForm';
import { TemplateService } from '@/application/services/domains';

function EditCreator ({
  creator,
  onUpdated,
  openModal,
  onClose,
}: {
  creator: TemplateCreator;
  onUpdated: () => void;
  openModal: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const submitRef = React.useRef<HTMLInputElement>(null);

  const onSubmit = useCallback(async (data: TemplateCreatorFormValues) => {
    try {
      await TemplateService.updateCreator(creator.id, data);
      onUpdated();
      onClose();
    } catch (error) {
      notify.error('Failed to update creator');
    }
  }, [onUpdated, onClose, creator.id]);

  return (
    <NormalModal
      onCancel={onClose}
      onOk={() => {
        submitRef.current?.click();
      }}
      onClick={e => e.stopPropagation()}
      title={<div className={'text-left'}>{t('template.editCreator')}</div>} open={openModal}
      onClose={onClose}
    >
      <div className={'overflow-hidden w-[500px]'}>
        <CreatorForm defaultValues={creator} ref={submitRef} onSubmit={onSubmit} />
      </div>
    </NormalModal>
  );
}

export default EditCreator;