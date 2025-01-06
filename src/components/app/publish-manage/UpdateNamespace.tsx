import { NormalModal } from '@/components/_shared/modal';
import { IconButton, OutlinedInput, Tooltip } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as TipIcon } from '@/assets/warning.svg';

function UpdateNamespace ({
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
      title={<div className={'flex gap-1 items-center justify-start'}>
        <div className={'font-medium text-left'}>{t('settings.sites.namespace.updateExistingNamespace')}</div>
        <Tooltip
          title={t('settings.sites.namespace.tooltip')}
        >
          <IconButton>
            <TipIcon className={'w-4 cursor-pointer h-4 text-text-placeholder'} />
          </IconButton>
        </Tooltip>
      </div>}
    >
      <div className={'text-sm overflow-hidden whitespace-pre-wrap break-words w-full mb-4 text-text-title opacity-60'}>{t('settings.sites.namespace.description')}</div>
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
      <div className={'text-sm mt-2 text-text-title opacity-80'}>{window.location.host}/{value}</div>
    </NormalModal>
  );
}

export default UpdateNamespace;