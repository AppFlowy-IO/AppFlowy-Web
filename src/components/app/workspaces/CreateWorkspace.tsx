import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { useAppHandlers } from '@/components/app/app.hooks';
import { useService } from '@/components/main/app.hooks';
import { Button, OutlinedInput } from '@mui/material';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';

function CreateWorkspace () {
  const { t } = useTranslation();
  const {
    onChangeWorkspace: handleSelectedWorkspace,
  } = useAppHandlers();
  const service = useService();
  const [loading, setLoading] = React.useState(false);
  const [name, setName] = React.useState('');
  const [open, setOpen] = React.useState(false);

  const handleCreate = useCallback(async () => {
    if (!service) return;

    setLoading(true);
    try {
      const workspaceId = await service.createWorkspace({
        workspace_name: name,
      });

      await handleSelectedWorkspace?.(workspaceId);
      setOpen(false);
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [handleSelectedWorkspace, name, service]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
    }
  }, [open]);

  return (
    <>
      <Button
        color={'inherit'}
        className={'w-full justify-start px-3 gap-0.5'}
        onClick={() => setOpen(true)}
        startIcon={
          <div className={'w-[33px] flex items-center justify-center h-[33px] rounded-[8px] border border-line-divider'}>
            <AddIcon className={'w-5 h-5'} />
          </div>
        }
      >
        {t('workspace.create')}
      </Button>
      <NormalModal
        title={t('workspace.create')}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        disableRestoreFocus={true}
        disableAutoFocus={false}
        okLoading={loading}
        onOk={handleCreate}
        okText={t('button.create')}
        PaperProps={{
          className: 'w-96 max-w-[70vw]',
        }}
        classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[10%] ' }}
      >
        <OutlinedInput
          autoFocus
          size={'small'}
          placeholder={'Enter workspace name'}
          value={name}
          inputRef={(input: HTMLInputElement) => {
            if (!input) return;
            if (!inputRef.current) {
              setTimeout(() => {
                input.setSelectionRange(0, input.value.length);
              }, 100);
              inputRef.current = input;
            }

          }}
          onChange={e => setName(e.target.value)}
          fullWidth
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleCreate();
            }
          }}
        />
      </NormalModal>
    </>
  );
}

export default CreateWorkspace;