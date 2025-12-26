import MenuItem from '@mui/material/MenuItem';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateCreatorFormValues } from '@/application/template.type';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import CreatorForm from '@/components/as-template/creator/CreatorForm';
import { useService } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

function AddCreator({ searchText, onCreated }: { searchText: string; onCreated: () => void }) {
  const { t } = useTranslation();
  const submitRef = React.useRef<HTMLInputElement>(null);
  const service = useService();

  const defaultValues = useMemo(
    () => ({
      name: searchText,
      avatar_url: '',
      account_links: [],
    }),
    [searchText]
  );

  const [openModal, setOpenModal] = useState(false);
  const handleClose = useCallback(() => {
    setOpenModal(false);
  }, []);

  const onSubmit = useCallback(
    async (data: TemplateCreatorFormValues) => {
      Log.debug('data', data);
      try {
        await service?.createTemplateCreator(data);
        onCreated();
        handleClose();
      } catch (error) {
        notify.error('Failed to create creator');
      }
    },
    [onCreated, service, handleClose]
  );

  return (
    <>
      <MenuItem key={'add'} className={'flex items-center gap-2'} onClick={() => setOpenModal(true)}>
        <AddIcon className={'h-5 w-5'} />
        {searchText ? searchText : <span className={'text-text-secondary'}>{t('template.addNewCreator')}</span>}
      </MenuItem>
      {openModal && (
        <NormalModal
          onClick={(e) => e.stopPropagation()}
          onCancel={handleClose}
          onOk={() => {
            submitRef.current?.click();
          }}
          title={<div className={'text-left'}>{t('template.addNewCreator')}</div>}
          open={openModal}
          onClose={handleClose}
        >
          <div className={'w-[500px] overflow-hidden'}>
            <CreatorForm ref={submitRef} onSubmit={onSubmit} defaultValues={defaultValues} />
          </div>
        </NormalModal>
      )}
    </>
  );
}

export default AddCreator;
