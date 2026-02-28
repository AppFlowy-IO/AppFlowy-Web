import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { AccessLevel, View, ViewIconType } from '@/application/types';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as LogoutIcon } from '@/assets/icons/logout.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/open.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { notify } from '@/components/_shared/notify';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppHandlers, useAppViewId, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import ViewItem from '@/components/app/outline/ViewItem';
import { RemoveAccessConfirmDialog } from '@/components/app/share/RemoveAccessConfirmDialog';
import { AccessService } from '@/application/services/domains';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ShareViewItem({
  view,
  width,
  expandIds,
  toggleExpand,
  navigateToView,
  onDataRefresh,
}: {
  view: View;
  width: number;
  expandIds: string[];
  toggleExpand: (id: string, isExpand: boolean) => void;
  navigateToView: (viewId: string) => void;
  onDataRefresh?: () => void;
}) {
  const { t } = useTranslation();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const viewId = useAppViewId();
  const navigate = useNavigate();

  const currentUser = useCurrentUser();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const { updatePage, uploadFile } = useAppHandlers();
  const { openRenameModal } = useAppOverlayContext();

  const canEdit = view.access_level && view.access_level > AccessLevel.ReadAndComment;

  const onUploadFile = useCallback(
    async (file: File, viewId: string) => {
      if (!uploadFile) return Promise.reject();
      return uploadFile(viewId, file);
    },
    [uploadFile]
  );

  const handleChangeIcon = useCallback(
    async (icon: { ty: ViewIconType; value: string; color?: string }) => {
      try {
        await updatePage?.(view.view_id, {
          icon:
            icon.ty === ViewIconType.Icon
              ? {
                  ty: ViewIconType.Icon,
                  value: JSON.stringify({
                    color: icon.color,
                    groupName: icon.value.split('/')[0],
                    iconName: icon.value.split('/')[1],
                  }),
                }
              : icon,
          name: view.name,
          extra: view.extra || {},
        });
        setPopoverOpen(false);
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [updatePage, view]
  );

  const handleRemoveIcon = useCallback(() => {
    void handleChangeIcon({ ty: 0, value: '' });
  }, [handleChangeIcon]);

  const handleRemoveAccess = useCallback(async () => {
    setIsRemoving(true);
    try {
      if (!currentWorkspaceId || !currentUser?.email) return;

      await AccessService.revokeAccess(currentWorkspaceId, view.view_id, [currentUser.email]);
      notify.success(t('shareAction.removeAccessSuccess', { email: currentUser.email }));
      setPopoverOpen(false);
      setShowRemoveDialog(false);
      onDataRefresh?.();
      if (viewId === view.view_id) {
        navigate('/app');
      }
      // eslint-disable-next-line
    } catch (error: any) {
      notify.error(error.message || t('shareAction.removeAccessError'));
    } finally {
      setIsRemoving(false);
    }
  }, [currentWorkspaceId, currentUser, view, onDataRefresh, t, viewId, navigate]);

  const handleRename = useCallback(() => {
    setPopoverOpen(false);
    openRenameModal(view.view_id);
  }, [openRenameModal, view.view_id]);

  const renderDropdownMenu = useCallback(() => {
    return (
      <DropdownMenuContent align='start' side='right'>
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant='destructive'
            onSelect={(e) => {
              e.preventDefault();
              setShowRemoveDialog(true);
            }}
          >
            <LogoutIcon />
            {t('shareAction.removeYourAccess')}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => handleRename()}>
                <EditIcon />
                {t('button.rename')}
              </DropdownMenuItem>
              <CustomIconPopover
                modal
                onSelectIcon={handleChangeIcon}
                removeIcon={handleRemoveIcon}
                onUploadFile={(file) => onUploadFile(file, view.view_id)}
                popoverContentProps={{
                  side: 'right',
                  align: 'start',
                }}
              >
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                  }}
                >
                  <EmojiIcon />
                  {t('disclosureAction.changeIcon')}
                </DropdownMenuItem>
              </CustomIconPopover>
            </DropdownMenuGroup>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => {
              if (!currentWorkspaceId) return;
              window.open(`/app/${currentWorkspaceId}/${view.view_id}`, '_blank');
            }}
          >
            <OpenIcon />
            {t('disclosureAction.openNewTab')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    );
  }, [view, canEdit, handleChangeIcon, handleRemoveIcon, onUploadFile, handleRename, currentWorkspaceId, t]);

  const renderExtra = useCallback(
    ({ hovered }: { hovered: boolean; view: View }) => {
      return (
        <div className='mr-2'>
          {/* Button - only visible on hover */}
          {hovered && (
            <Tooltip disableHoverableContent delayDuration={500}>
              <TooltipTrigger asChild>
                <Button
                  variant={'ghost'}
                  size={'icon-sm'}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    setPopoverOpen(true);
                  }}
                >
                  <MoreIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('menuAppHeader.moreButtonToolTip')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      );
    },
    [t]
  );

  return (
    <div className='relative'>
      <ViewItem
        renderExtra={renderExtra}
        view={view}
        width={width}
        expandIds={expandIds}
        toggleExpand={toggleExpand}
        onClickView={navigateToView}
      />

      <RemoveAccessConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        onConfirm={handleRemoveAccess}
        loading={isRemoving}
      />

      {/* Dropdown Menu - always present with absolute positioned trigger */}
      <DropdownMenu open={popoverOpen} onOpenChange={setPopoverOpen}>
        <DropdownMenuTrigger asChild>
          <div
            className='pointer-events-none absolute right-0 top-0 z-[-1] h-full w-full'
            style={{
              zIndex: popoverOpen ? 1 : -1,
              pointerEvents: popoverOpen ? 'auto' : 'none',
            }}
          />
        </DropdownMenuTrigger>
        {renderDropdownMenu()}
      </DropdownMenu>
    </div>
  );
}
