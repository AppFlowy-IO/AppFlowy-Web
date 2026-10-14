import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { AccessService } from '@/application/services/domains';
import { AccessLevel, Role, View, ViewIconType, ViewLayout } from '@/application/types';
import { getViewUrl, isDatabaseContainer, isSpaceView } from '@/application/view-utils';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as LogoutIcon } from '@/assets/icons/logout.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/open.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { notify } from '@/components/_shared/notify';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppOperations, useAppViewId, useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import ViewItem from '@/components/app/outline/ViewItem';
import { RemoveAccessConfirmDialog } from '@/components/app/share/RemoveAccessConfirmDialog';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import ViewActionsPopover from '@/components/app/view-actions/ViewActionsPopover';
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
  onImportClick,
}: {
  view: View;
  width: number;
  expandIds: string[];
  toggleExpand: (id: string, isExpand: boolean) => void;
  navigateToView: (viewId: string) => void;
  onDataRefresh?: () => void;
  onImportClick?: (view: View) => void;
}) {
  const renderExtra = useCallback(
    ({ hovered, view: rowView }: { hovered: boolean; view: View }) => (
      <SharedViewActions
        key={rowView.view_id}
        view={rowView}
        visible={hovered}
        onDataRefresh={onDataRefresh}
        onImportClick={onImportClick}
        onExpand={() => toggleExpand(rowView.view_id, true)}
      />
    ),
    [onDataRefresh, onImportClick, toggleExpand]
  );

  return (
    <ViewItem
      renderExtra={renderExtra}
      view={view}
      width={width}
      expandIds={expandIds}
      toggleExpand={toggleExpand}
      onClickView={navigateToView}
    />
  );
}

// ViewItem reuses renderExtra for descendants. Each row owns its action target
// and menu state so creating a grandchild never targets the top shared page.
function SharedViewActions({
  view,
  visible,
  onDataRefresh,
  onImportClick,
  onExpand,
}: {
  view: View;
  visible: boolean;
  onDataRefresh?: () => void;
  onImportClick?: (view: View) => void;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const viewId = useAppViewId();
  const navigate = useNavigate();

  const currentUser = useCurrentUser();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const { updatePage, uploadFile } = useAppOperations();
  const { openRenameModal } = useAppOverlayContext();
  const role = useUserWorkspaceInfo()?.selectedWorkspace.role;
  const canCreateChildren =
    (role === Role.Member || role === Role.Owner) &&
    view.layout === ViewLayout.Document &&
    !isSpaceView(view) &&
    !isDatabaseContainer(view);
  // Resolve only the hovered/open row, never every shared page on sidebar load.
  const { canCreateViewActions, hasLoadedViewActionPermissions, isLoadingViewActionPermissions } =
    useViewActionPermissions(view, canCreateChildren && (visible || addOpen));
  const showAdd =
    canCreateChildren && hasLoadedViewActionPermissions && !isLoadingViewActionPermissions && canCreateViewActions;

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
              const url = getViewUrl(view, currentWorkspaceId);

              if (!url) return;
              window.open(url, '_blank');
            }}
          >
            <OpenIcon />
            {t('disclosureAction.openNewTab')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    );
  }, [view, canEdit, handleChangeIcon, handleRemoveIcon, onUploadFile, handleRename, currentWorkspaceId, t]);

  return (
    <>
      {(visible || popoverOpen || addOpen) && (
        <div className='mr-2 flex items-center' onClick={(event) => event.stopPropagation()}>
          <DropdownMenu open={popoverOpen} onOpenChange={setPopoverOpen}>
            <Tooltip disableHoverableContent delayDuration={500}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-testid='shared-page-more-actions'
                    aria-label={t('menuAppHeader.moreButtonToolTip')}
                    variant='ghost'
                    size='icon-sm'
                  >
                    <MoreIcon />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('menuAppHeader.moreButtonToolTip')}</TooltipContent>
            </Tooltip>
            {renderDropdownMenu()}
          </DropdownMenu>
          {showAdd && (
            <ViewActionsPopover
              view={view}
              popoverType={{ category: 'page', type: 'add' }}
              open={addOpen}
              onOpenChange={(open) => {
                setAddOpen(open);
                if (open) onExpand();
              }}
              onImportClick={onImportClick}
            >
              <Button
                data-testid='inline-add-page'
                aria-label={t('menuAppHeader.addPageTooltip')}
                title={t('menuAppHeader.addPageTooltip')}
                variant='ghost'
                size='icon-sm'
              >
                <PlusIcon />
              </Button>
            </ViewActionsPopover>
          )}
        </div>
      )}
      <RemoveAccessConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        onConfirm={handleRemoveAccess}
        loading={isRemoving}
      />
    </>
  );
}
