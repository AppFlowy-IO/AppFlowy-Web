import { View } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';
import DeleteSpaceConfirm from '@/components/app/view-actions/DeleteSpaceConfirm';
import ManageSpace from '@/components/app/view-actions/ManageSpace';
import { useService } from '@/components/main/app.hooks';
import { Button, CircularProgress, Divider } from '@mui/material';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as DeleteIcon } from '@/assets/trash.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/duplicate.svg';
import { ReactComponent as SettingsIcon } from '@/assets/settings.svg';
import { ReactComponent as AddIcon } from '@/assets/plus.svg';

function MoreSpaceActions({
  view,
  onClose,
}: {
  view: View;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [deleteModalOpen, setDeleteModalOpen] = React.useState(false);
  const [manageModalOpen, setManageModalOpen] = React.useState(false);
  const [createSpaceModalOpen, setCreateSpaceModalOpen] = React.useState(false);
  const service = useService();
  const workspaceId = useCurrentWorkspaceId();
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const {
    refreshOutline,
  } = useAppHandlers();

  const handleDuplicateClick = useCallback(async() => {
    if(!workspaceId || !service) return;
    setDuplicateLoading(true);
    try {
      await service.duplicateAppPage(workspaceId, view.view_id);

      void refreshOutline?.();
      onClose();
      // eslint-disable-next-line
    } catch(e: any) {
      notify.error(e.message);
    } finally {
      setDuplicateLoading(false);
    }
  }, [onClose, refreshOutline, service, view.view_id, workspaceId]);

  const actions = useMemo(() => {
    return [{
      label: t('space.manage'),
      icon: <SettingsIcon />,
      onClick: () => {
        setManageModalOpen(true);
      },
    },
      {
        label: t('space.duplicate'),
        icon: duplicateLoading ? <CircularProgress size={14} /> : <DuplicateIcon />,
        disabled: duplicateLoading,
        onClick: () => {
          void handleDuplicateClick();
        },
      },
    ];
  }, [duplicateLoading, handleDuplicateClick, t]);

  return (
    <div className={'flex flex-col gap-2 w-full p-1.5 min-w-[230px]'}>
      {actions.map(action => (
        <Button
          key={action.label}
          size={'small'}
          onClick={action.onClick}
          className={`px-3 py-1 justify-start `}
          color={'inherit'}
          startIcon={action.icon}
        >
          {action.label}
        </Button>
      ))}
      <Divider className={'w-full'} />
      <Button
        size={'small'}
        className={'px-3 py-1 justify-start'}
        color={'inherit'}
        onClick={() => {
          setCreateSpaceModalOpen(true);
        }}
        startIcon={<AddIcon />}
      >
        {t('space.createNewSpace')}
      </Button>
      <Divider className={'w-full'} />
      <Button
        size={'small'}
        className={'px-3 py-1 hover:text-function-error justify-start'}
        color={'inherit'}
        onClick={() => {
          setDeleteModalOpen(true);
        }}
        startIcon={<DeleteIcon />}
      >
        {t('button.delete')}
      </Button>
      {manageModalOpen && <ManageSpace
        open={manageModalOpen}
        onClose={() => {
          setManageModalOpen(false);
          onClose();
        }}
        viewId={view.view_id}
      />}
      {createSpaceModalOpen && <CreateSpaceModal
        onCreated={onClose}
        open={createSpaceModalOpen}
        onClose={() => setCreateSpaceModalOpen(false)}
      />}
      {deleteModalOpen && <DeleteSpaceConfirm
        viewId={view.view_id}
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          onClose();
        }}
      />}

    </div>
  );
}

export default MoreSpaceActions;