import MenuItem from '@mui/material/MenuItem';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateCategoryFormValues, TemplateCategoryType, TemplateIcon } from '@/application/template.type';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import CategoryForm from '@/components/as-template/category/CategoryForm';
import { TemplateService } from '@/application/services/domains';

function AddCategory({ searchText, onCreated }: { searchText: string; onCreated: () => void }) {
  const { t } = useTranslation();
  const submitRef = React.useRef<HTMLInputElement>(null);
  const defaultValues = useMemo(
    () => ({
      name: searchText,
      description: '',
      icon: TemplateIcon.project,
      bg_color: '#FFF5F5',
      category_type: TemplateCategoryType.ByUseCase,
      priority: 1,
    }),
    [searchText]
  );
  const [openModal, setOpenModal] = useState(false);
  const onSubmit = useCallback(
    async (data: TemplateCategoryFormValues) => {
      try {
        await TemplateService.addCategory(data);
        onCreated();
        setOpenModal(false);
      } catch (error) {
        notify.error('Failed to add category');
      }
    },
    [onCreated]
  );

  return (
    <>
      <MenuItem
        onClick={() => {
          setOpenModal(true);
        }}
        key={'add'}
        className={'flex items-center gap-2'}
      >
        <AddIcon className={'h-5 w-5'} />
        {searchText ? searchText : <span className={'text-text-secondary'}>{t('template.addNewCategory')}</span>}
      </MenuItem>
      {openModal && (
        <NormalModal
          onOk={() => {
            submitRef.current?.click();
          }}
          title={<div className={'text-left'}>{t('template.addNewCategory')}</div>}
          open={openModal}
          onClose={() => setOpenModal(false)}
          onClick={(e) => e.stopPropagation()}
          onCancel={() => setOpenModal(false)}
        >
          <CategoryForm defaultValues={defaultValues} ref={submitRef} onSubmit={onSubmit} />
        </NormalModal>
      )}
    </>
  );
}

export default AddCategory;
