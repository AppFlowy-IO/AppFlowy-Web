import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { View } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useService } from '@/components/main/app.hooks';
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

function MoreSpaceActions({
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

  const handleManageClick = useCallback(() => {
    onClose();
    openManageSpaceModal(view.view_id);
  }, [onClose, openManageSpaceModal, view.view_id]);

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        data-testid={'space-action-manage'}
        onSelect={handleManageClick}
      >
        <SettingsIcon />
        {t('space.manage')}
      </DropdownMenuItem>
      <DropdownMenuItem
        data-testid={'space-action-duplicate'}
        onSelect={handleDuplicateClick}
        disabled={duplicateLoading}
      >
        {duplicateLoading ? <Progress variant={'primary'} /> : <DuplicateIcon />}
        {t('space.duplicate')}
      </DropdownMenuItem>
      <DropdownMenuSeparator className={'w-full'} />
      <DropdownMenuItem
        data-testid="create-new-space-button"
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
        data-testid={'space-action-delete'}
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