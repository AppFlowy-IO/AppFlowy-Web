import { Avatar, Button, OutlinedInput, Tooltip } from '@mui/material';
import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloudUploadIcon } from '@/assets/icons/cloud_add.svg';
import { NormalModal } from '@/components/_shared/modal';
import { TabPanel, ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import UploadAvatar from '@/components/as-template/creator/UploadAvatar';
import { stringAvatar } from '@/utils/color';



function CreatorAvatar({
  src,
  name,
  enableUpload,
  onChange,
  size,
}: {
  src: string;
  name: string;
  enableUpload?: boolean;
  onChange?: (url: string) => void;
  size?: number;
}) {
  const { t } = useTranslation();
  const [showUpload, setShowUpload] = React.useState(false);

  const [tab, setTab] = React.useState(0);
  const avatarProps = useMemo(() => {
    return stringAvatar(name || '');
  }, [name]);
  const [openModal, setOpenModal] = React.useState(false);

  const [imageUrl, setImageUrl] = React.useState(src);

  useEffect(() => {
    setImageUrl(src);
  }, [openModal, src]);

  return (
    <>
      <div
        style={{
          width: size || undefined,
          height: size || undefined,
        }}
        className={'relative h-full w-full cursor-pointer'}
        onMouseLeave={() => setShowUpload(false)}
        onMouseEnter={() => {
          setShowUpload(true);
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <Avatar
          src={src}
          className={'h-full w-full object-cover p-2'}
          {...avatarProps}
          sx={{
            ...avatarProps?.sx,
            bgcolor: imageUrl ? 'var(--bg-body)' : avatarProps?.sx.bgcolor,
            width: size || undefined,
            height: size || undefined,
          }}
        />
        {enableUpload && showUpload && (
          <Tooltip title={t('template.creator.uploadAvatar')} arrow>
            <Button
              component='label'
              role={undefined}
              variant='contained'
              className={
                'absolute left-0 top-0 flex h-full w-full min-w-full items-center justify-center rounded-full bg-black bg-opacity-50 p-0'
              }
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setOpenModal(true);
              }}
            >
              <CloudUploadIcon className={'h-[60%] w-[60%]'} />
            </Button>
          </Tooltip>
        )}
      </div>
      {openModal && (
        <NormalModal
          onClick={(e) => e.stopPropagation()}
          okButtonProps={{
            disabled: !imageUrl,
          }}
          onOk={() => {
            if (!imageUrl) return;
            onChange?.(imageUrl);
            setOpenModal(false);
          }}
          title={t('template.uploadAvatar')}
          onCancel={() => setOpenModal(false)}
          onClose={() => setOpenModal(false)}
          open={openModal}
        >
          <div className={'flex min-w-[400px] flex-col gap-4'}>
            <ViewTabs
              value={tab}
              onChange={(_, newValue) => {
                setTab(newValue);
                setImageUrl(src);
              }}
            >
              <ViewTab value={0} label={t('document.imageBlock.embedLink.label')} />
              <ViewTab value={1} label={t('button.upload')} />
            </ViewTabs>
            <TabPanel className={'w-full'} value={tab} index={0}>
              <OutlinedInput
                size={'small'}
                value={imageUrl}
                fullWidth
                onChange={(e) => {
                  setImageUrl(e.target.value);
                }}
                placeholder={t('document.imageBlock.embedLink.placeholder')}
              />
            </TabPanel>
            <TabPanel className={'flex w-full flex-col gap-2'} value={tab} index={1}>
              <UploadAvatar onChange={setImageUrl} />
            </TabPanel>
          </div>
        </NormalModal>
      )}
    </>
  );
}

export default CreatorAvatar;
