import { View, ViewIconType } from '@/application/types';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/open.svg';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import MoreActionsContent from '@/components/app/header/MoreActionsContent';

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';

function MorePageActions ({ view, onClose }: {
  view: View;
  onClose?: () => void;
}) {
  const currentWorkspaceId = useCurrentWorkspaceId();

  const {
    openRenameModal,
  } = useAppOverlayContext();

  const {
    updatePage,
    uploadFile,
  } = useAppHandlers();
  const { t } = useTranslation();

  const viewId = view.view_id;

  const onUploadFile = useCallback(async (file: File) => {
    if (!uploadFile) return Promise.reject();
    return uploadFile(viewId, file);
  }, [uploadFile, viewId]);

  const handleChangeIcon = useCallback(async (icon: { ty: ViewIconType, value: string, color?: string }) => {
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
      onClose?.();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [onClose, updatePage, view.extra, view.name, view.view_id]);

  const handleRemoveIcon = useCallback(() => {
    void handleChangeIcon({ ty: 0, value: '' });
  }, [handleChangeIcon]);

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem
          onSelect={() => {
            onClose?.();
            openRenameModal(viewId);
          }}
        >
          <EditIcon />{t('button.rename')}
        </DropdownMenuItem>
        <CustomIconPopover
          modal
          onSelectIcon={handleChangeIcon}
          removeIcon={handleRemoveIcon}
          onUploadFile={onUploadFile}
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
            <EmojiIcon />{t('disclosureAction.changeIcon')}
          </DropdownMenuItem>
        </CustomIconPopover>
      </DropdownMenuGroup>

      <MoreActionsContent
        itemClicked={onClose}
        viewId={view.view_id}
      />
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

    </>
  );
}

export default MorePageActions;