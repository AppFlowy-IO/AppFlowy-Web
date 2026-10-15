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
import { useSpaceCreationCapability } from '@/components/app/hooks/useSpaceCreationCapability';
import {
  assertGenericDeepDuplicateIsSafe,
  FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE,
  isUnsafeFormDeepDuplicate,
} from '@/components/app/view-actions/formDuplicateSafety';
import {
  canStartSpaceCreation,
  refreshSpaceCreationAdmission,
  spaceCreationUnavailableKey,
  spaceCreationUnavailableReason,
} from '@/components/app/view-actions/SpaceCreationNotice';
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
  const creationPermission = useSpaceCreationCapability(workspaceId);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const refreshOutline = useRefreshOutline();
  const formDuplicateUnavailable = isUnsafeFormDeepDuplicate(view);
  // Duplicating a space creates a new space (B). A server without the capability route decides.
  const canDuplicateSpace = canStartSpaceCreation(creationPermission);
  const duplicateUnavailableReason = spaceCreationUnavailableReason(creationPermission);

  const handleDuplicateClick = useCallback(async () => {
    if (!workspaceId || !canOpenManageActions || duplicateLoading || !canDuplicateSpace) return;
    setDuplicateLoading(true);
    try {
      const admission = await refreshSpaceCreationAdmission(creationPermission, workspaceId);

      if (admission === 'denied' || admission === 'unavailable') {
        toast.error(t(admission === 'denied' ? 'workspacePermissions.denied' : 'workspacePermissions.loadError'));
        return;
      }

      await assertGenericDeepDuplicateIsSafe({
        workspaceId,
        viewId: view.view_id,
        knownView: view,
      });
      await PageService.duplicate(workspaceId, view.view_id);

      void refreshOutline?.();
      onClose();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDuplicateLoading(false);
    }
  }, [
    canDuplicateSpace,
    canOpenManageActions,
    creationPermission,
    duplicateLoading,
    onClose,
    refreshOutline,
    t,
    view,
    workspaceId,
  ]);

  const handleManageClick = useCallback(() => {
    onClose();
    openManageSpaceModal(view.view_id);
  }, [onClose, openManageSpaceModal, view.view_id]);

  return (
    <DropdownMenuGroup>
      {canOpenManageActions && (
        <DropdownMenuItem data-testid={'space-action-manage'} onSelect={handleManageClick}>
          <SettingsIcon />
          {t('space.manageSpace')}
        </DropdownMenuItem>
      )}
      {canOpenManageActions && (
        <DropdownMenuItem
          data-testid={'space-action-duplicate'}
          onSelect={formDuplicateUnavailable ? undefined : handleDuplicateClick}
          disabled={duplicateLoading || formDuplicateUnavailable || !canDuplicateSpace}
          title={formDuplicateUnavailable ? FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE : undefined}
          aria-label={formDuplicateUnavailable ? FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE : undefined}
        >
          {duplicateLoading ? <Progress variant={'primary'} /> : <DuplicateIcon />}
          {formDuplicateUnavailable ? (
            t('form.duplicateUnavailable', 'Duplicate unavailable for Forms')
          ) : (
            <span className={'flex min-w-0 flex-col'}>
              <span>{t('space.duplicate')}</span>
              {/* Disabled menu items receive no hover, so the reason is shown, not a tooltip. */}
              {duplicateUnavailableReason && (
                <span className={'text-xs text-text-tertiary'} data-testid={'space-action-duplicate-reason'}>
                  {t(spaceCreationUnavailableKey(duplicateUnavailableReason))}
                </span>
              )}
            </span>
          )}
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
