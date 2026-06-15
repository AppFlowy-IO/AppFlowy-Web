import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { View, ViewIconType } from '@/application/types';
import { getViewUrl } from '@/application/view-utils';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/open.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppOperations, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import MoreActionsContent from '@/components/app/header/MoreActionsContent';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';



function MorePageActions({ view, onClose }: {
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
  } = useAppOperations();
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
          data-testid={'more-page-rename'}
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
            data-testid={'more-page-change-icon'}
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
          data-testid={'more-page-open-new-tab'}
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

    </>
  );
}

export default MorePageActions;