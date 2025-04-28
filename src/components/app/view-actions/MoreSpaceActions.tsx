import { View } from '@/application/types';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useService } from '@/components/main/app.hooks';
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';

function MoreSpaceActions ({
  view,
  onClose,
}: {
  view: View;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const {
    openCreateSpaceModal,
    openDeleteSpaceModal,
    openManageSpaceModal,
  } = useAppOverlayContext();
  const service = useService();
  const workspaceId = useCurrentWorkspaceId();
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const {
    refreshOutline,
  } = useAppHandlers();

  const handleDuplicateClick = useCallback(async () => {
    if (!workspaceId || !service) return;
    setDuplicateLoading(true);
    try {
      await service.duplicateAppPage(workspaceId, view.view_id);

      void refreshOutline?.();
      onClose();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDuplicateLoading(false);
    }
  }, [onClose, refreshOutline, service, view.view_id, workspaceId]);

  const actions = useMemo(() => {
    return [{
      label: t('space.manage'),
      icon: <SettingsIcon />,
      onClick: () => {
        onClose();
        openManageSpaceModal(view.view_id);
      },
    },
      {
        label: t('space.duplicate'),
        icon: duplicateLoading ? <Progress variant={'primary'} /> : <DuplicateIcon />,
        disabled: duplicateLoading,
        onClick: () => {
          void handleDuplicateClick();
        },
      },
    ];
  }, [duplicateLoading, handleDuplicateClick, onClose, openManageSpaceModal, t, view.view_id]);

  return (
    <DropdownMenuGroup>
      {actions.map(action => (
        <DropdownMenuItem
          key={action.label}
          onSelect={action.onClick}
        >
          {action.icon}
          {action.label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator className={'w-full'} />
      <DropdownMenuItem
        onSelect={() => {
          onClose();
          openCreateSpaceModal();
        }}
      >
        <AddIcon />
        {t('space.createNewSpace')}
      </DropdownMenuItem>
      <DropdownMenuSeparator className={'w-full'} />
      <DropdownMenuItem
        onSelect={() => {
          onClose();
          openDeleteSpaceModal(view.view_id);
        }}
      >
        <DeleteIcon />
        {t('button.delete')}
      </DropdownMenuItem>

    </DropdownMenuGroup>
  );
}

export default MoreSpaceActions;