import { IconButton, OutlinedInput, Tooltip } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as TipIcon } from '@/assets/icons/warning.svg';
import { NormalModal } from '@/components/_shared/modal';

function UpdateNamespace({
  namespace,
  open,
  onClose,
  onUpdateNamespace,
}: {
  namespace: string;
  open: boolean;
  onClose: () => void;
  onUpdateNamespace: (namespace: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState(namespace);
  const [loading, setLoading] = React.useState(false);

  const handleOk = async () => {
    setLoading(true);
    try {
      await onUpdateNamespace(value);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <NormalModal
      open={open}
      disableRestoreFocus={true}
      okText={t('button.save')}
      onClose={onClose}
      okLoading={loading}
      okButtonProps={{
        disabled: !value || value === namespace || loading,
      }}
      classes={{
        paper: 'max-w-[450px]',
      }}
      onOk={handleOk}
      title={
        <div className={'flex items-center justify-start gap-1'}>
          <div className={'text-left font-medium'}>{t('settings.sites.namespace.updateExistingNamespace')}</div>
          <Tooltip title={t('settings.sites.namespace.tooltip')}>
            <IconButton>
              <TipIcon className={'h-5 w-5 cursor-pointer text-text-tertiary'} />
            </IconButton>
          </Tooltip>
        </div>
      }
    >
      <div
        className={'mb-4 w-full overflow-hidden whitespace-pre-wrap break-words text-sm text-text-primary opacity-60'}
      >
        {t('settings.sites.namespace.description')}
      </div>
      <OutlinedInput
        value={value}
        fullWidth
        onChange={(e) => setValue(e.target.value)}
        size={'small'}
        autoFocus={true}
        inputProps={{
          className: 'px-2 py-1.5 text-sm',
        }}
      />
      <div className={'mt-2 text-sm text-text-primary opacity-80'}>
        {window.location.host}/{value}
      </div>
    </NormalModal>
  );
}

export default UpdateNamespace;
