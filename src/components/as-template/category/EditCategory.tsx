import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateCategory, TemplateCategoryFormValues } from '@/application/template.type';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import CategoryForm from '@/components/as-template/category/CategoryForm';
import { TemplateService } from '@/application/services/domains';
import { Log } from '@/utils/log';

function EditCategory({
  category,
  onUpdated,
  openModal,
  onClose,
}: {
  category: TemplateCategory;
  onUpdated: () => void;
  openModal: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const submitRef = React.useRef<HTMLInputElement>(null);
  const onSubmit = useCallback(
    async (data: TemplateCategoryFormValues) => {
      Log.debug('data', data);
      try {
        await TemplateService.updateCategory(category.id, data);
        onUpdated();
        onClose();
      } catch (error) {
        notify.error('Failed to update category');
      }
    },
    [onUpdated, onClose, category.id]
  );

  return (
    <NormalModal
      onClick={(e) => e.stopPropagation()}
      onOk={() => {
        submitRef.current?.click();
      }}
      title={<div className={'text-left'}>{t('template.editCategory')}</div>}
      onCancel={onClose}
      open={openModal}
      onClose={onClose}
    >
      <CategoryForm defaultValues={category} ref={submitRef} onSubmit={onSubmit} />
    </NormalModal>
  );
}

export default EditCategory;
