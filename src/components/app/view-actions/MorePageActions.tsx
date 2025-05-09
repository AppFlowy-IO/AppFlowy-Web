import { View, ViewIconType } from '@/application/types';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/open.svg';
import { notify } from '@/components/_shared/notify';
import { Origins } from '@/components/_shared/popover';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import MoreActionsContent from '@/components/app/header/MoreActionsContent';
import RenameModal from '@/components/app/view-actions/RenameModal';

import { Button, Divider } from '@mui/material';
import React, { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ChangeIconPopover = lazy(() => import('@/components/_shared/view-icon/ChangeIconPopover'));

const popoverProps: Origins = {
  transformOrigin: {
    vertical: 'top',
    horizontal: 'left',
  },
  anchorOrigin: {
    vertical: 'top',
    horizontal: 'right',
  },
};

function MorePageActions({ view, onClose }: {
  view: View;
  onClose?: () => void;
}) {
  const currentWorkspaceId = useCurrentWorkspaceId();

  const [iconPopoverAnchorEl, setIconPopoverAnchorEl] = useState<null | HTMLElement>(null);
  const openIconPopover = Boolean(iconPopoverAnchorEl);

  const [renameModalOpen, setRenameModalOpen] = useState(false);

  const {
    updatePage,
    uploadFile,
  } = useAppHandlers();
  const { t } = useTranslation();

  const viewId = view.view_id;

  const onUploadFile = useCallback(async(file: File) => {
    if(!uploadFile) return Promise.reject();
    return uploadFile(viewId, file);
  }, [uploadFile, viewId]);

  const handleChangeIcon = useCallback(async(icon: { ty: ViewIconType, value: string, color?: string }) => {
    try {
      await updatePage?.(view.view_id, {
        icon: icon.ty === ViewIconType.Icon ? {
          ty: ViewIconType.Icon,
          value: JSON.stringify({
            color: icon.color,
            groupName: icon.value.split('/')[0],
            iconName: icon.value.split('/')[1],
          }),
        } : icon,
        name: view.name,
        extra: view.extra || {},
      });
      setIconPopoverAnchorEl(null);
      onClose?.();
      // eslint-disable-next-line
    } catch(e: any) {
      notify.error(e);
    }
  }, [onClose, updatePage, view.extra, view.name, view.view_id]);

  const handleRemoveIcon = useCallback(() => {
    void handleChangeIcon({ ty: 0, value: '' });
  }, [handleChangeIcon]);

  const actions = useMemo(() => {
    return [{
      label: t('button.rename'),
      icon: <EditIcon />,
      onClick: () => {
        setRenameModalOpen(true);
        onClose?.();
      },
    }, {
      label: t('disclosureAction.changeIcon'),
      icon: <EmojiIcon />,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        setIconPopoverAnchorEl(e.currentTarget);
      },
    }];
  }, [onClose, t]);

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
      <MoreActionsContent
        itemClicked={onClose}
        viewId={view.view_id}
        movePopoverOrigins={popoverProps}
      />
      <Divider className={'w-full'} />
      <Button
        size={'small'}

        className={'px-3 py-1 justify-start'}
        color={'inherit'}
        onClick={() => {
          if(!currentWorkspaceId) return;
          onClose?.();
          window.open(`/app/${currentWorkspaceId}/${view.view_id}`, '_blank');

        }}
        startIcon={<OpenIcon />}
      >
        {t('disclosureAction.openNewTab')}
      </Button>
      <Suspense fallback={null}>
        <ChangeIconPopover
          iconEnabled
          defaultType={'emoji'}
          open={openIconPopover}
          anchorEl={iconPopoverAnchorEl}
          onClose={() => {
            onClose?.();
            setIconPopoverAnchorEl(null);
          }}
          onUploadFile={onUploadFile}
          uploadEnabled
          popoverProps={popoverProps}
          onSelectIcon={handleChangeIcon}
          removeIcon={handleRemoveIcon}
        />
      </Suspense>
      <RenameModal
        open={renameModalOpen}
        onClose={() => {
          onClose?.();
          setRenameModalOpen(false);
        }}
        viewId={view.view_id}
      />
    </div>
  );
}

export default MorePageActions;