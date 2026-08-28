import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PageService } from '@/application/services/domains';
import { View } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useCurrentWorkspaceId, useRefreshOutline } from '@/components/app/app.hooks';
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

function MoreSpaceActions({
  view,
  onClose,
  canManageActions,
  canOpenManageActions,
  isLoadingActions,
}: {
  view: View;
  onClose: () => void;
  canManageActions: boolean;
  canOpenManageActions: boolean;
  isLoadingActions: boolean;
}) {
  const { t } = useTranslation();
  const { openDeleteSpaceModal, openManageSpaceModal } = useAppOverlayContext();
  const workspaceId = useCurrentWorkspaceId();
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const refreshOutline = useRefreshOutline();

  const handleDuplicateClick = useCallback(async () => {
    if (!workspaceId) return;
    setDuplicateLoading(true);
    try {
      await PageService.duplicate(workspaceId, view.view_id);

      void refreshOutline?.();
      onClose();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDuplicateLoading(false);
    }
  }, [onClose, refreshOutline, view.view_id, workspaceId]);

  const handleManageClick = useCallback(() => {
    onClose();
    openManageSpaceModal(view.view_id);
  }, [onClose, openManageSpaceModal, view.view_id]);

  return (
    <DropdownMenuGroup>
      {canOpenManageActions && (
        <DropdownMenuItem data-testid={'space-action-manage'} onSelect={handleManageClick}>
          <SettingsIcon />
          {t('space.manage')}
        </DropdownMenuItem>
      )}
      {canOpenManageActions && (
        <DropdownMenuItem
          data-testid={'space-action-duplicate'}
          onSelect={handleDuplicateClick}
          disabled={duplicateLoading}
        >
          {duplicateLoading ? <Progress variant={'primary'} /> : <DuplicateIcon />}
          {t('space.duplicate')}
        </DropdownMenuItem>
      )}
      {isLoadingActions && (
        <DropdownMenuItem data-testid='space-action-permission-loading' disabled>
          <Progress variant='primary' />
          {t('loading')}
        </DropdownMenuItem>
      )}
      {(canManageActions || canOpenManageActions) && (
        <>
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
        </>
      )}
    </DropdownMenuGroup>
  );
}

export default MoreSpaceActions;
