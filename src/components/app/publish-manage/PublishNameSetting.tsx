import { Button, CircularProgress, InputBase } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { openUrl } from '@/utils/url';

export function PublishNameSetting({
  defaultName,
  onClose,
  open,
  onUnPublish,
  updatePublishName,
  url,
}: {
  onClose: () => void;
  open: boolean;
  defaultName: string;
  onUnPublish: () => Promise<void>;
  updatePublishName: (newPublishName: string) => Promise<void>;
  url: string;
}) {
  const [value, setValue] = React.useState(defaultName);
  const { t } = useTranslation();
  const [publishLoading, setPublishLoading] = React.useState<boolean>(false);
  const [unPublishLoading, setUnPublishLoading] = React.useState<boolean>(false);

  const handlePublish = async () => {
    if (!value) {
      notify.error(t('settings.sites.error.publishNameCannotBeEmpty'));
      return;
    }

    if (value.length > 100) {
      notify.error(t('settings.sites.error.publishNameTooLong'));
      return;
    }

    if (value.includes(' ') || value.includes('/')) {
      notify.error(t('settings.sites.error.publishNameContainsInvalidCharacters'));
      return;
    }

    if (value === defaultName) {
      notify.error(t('settings.sites.error.publishNameAlreadyInUse'));
      return;
    }

    setPublishLoading(true);

    try {
      await updatePublishName(value);
    } finally {
      setPublishLoading(false);
    }
  };

  const handleUnPublish = async () => {
    setUnPublishLoading(true);
    try {
      await onUnPublish();
    } finally {
      setUnPublishLoading(false);
    }
  };

  return (
    <NormalModal
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose?.();
        }

        if (e.key === 'Enter') {
          void handlePublish();
        }
      }}
      cancelText={unPublishLoading ? <CircularProgress size={14} /> : t('shareAction.unPublish')}
      okText={t('shareAction.visitSite')}
      cancelButtonProps={{
        disabled: unPublishLoading,
      }}
      onCancel={handleUnPublish}
      onOk={() => {
        void openUrl(url, '_blank');
      }}
      title={<div className={'flex items-center justify-start'}>{t('settings.sites.publishedPage.settings')}</div>}
      open={open}
      onClose={onClose}
    >
      <div className={'flex flex-col gap-1'}>
        <div className={'text-sm text-text-secondary'}>{t('settings.sites.publishedPage.pathName')}</div>
        <div className={'flex items-center gap-2'}>
          <div className={'flex min-w-[300px] items-center rounded-[8px] border border-border-primary px-2 py-1'}>
            <InputBase
              size={'small'}
              fullWidth
              value={value}
              inputProps={{
                className: 'pb-0',
              }}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>

          <Button
            onClick={handlePublish}
            variant={'outlined'}
            disabled={!value || publishLoading}
            color={'inherit'}
            className={'h-[33px]'}
          >
            {publishLoading ? <CircularProgress size={14} /> : t('button.save')}
          </Button>
        </div>
      </div>
    </NormalModal>
  );
}
