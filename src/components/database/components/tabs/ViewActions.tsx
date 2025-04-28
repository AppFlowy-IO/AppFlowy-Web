import { useDatabaseContext } from '@/application/database-yjs';
import { View, ViewIconType } from '@/application/types';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export function DatabaseViewActions ({
  onOpenRenameModal,
  onOpenDeleteModal,
  onClose,
  view,
  deleteDisabled,
  onUpdatedIcon,
}: {
  onUpdatedIcon?: () => void;
  deleteDisabled: boolean;
  view: View,
  onClose: () => void,
  onOpenRenameModal: (viewId: string) => void;
  onOpenDeleteModal: (viewId: string) => void;
}) {
  const {
    updatePage,
  } = useDatabaseContext();
  const { t } = useTranslation();
  const handleChangeIcon = useCallback(async (icon: { ty: ViewIconType, value: string, color?: string }) => {
    try {
      await updatePage?.(view.view_id, {
        name: view.name,
        extra: view.extra || {},
        icon: icon.ty === ViewIconType.Icon ? {
          ty: ViewIconType.Icon,
          value: JSON.stringify({
            color: icon.color,
            groupName: icon.value.split('/')[0],
            iconName: icon.value.split('/')[1],
          }),
        } : icon,
      });
      onClose();
      onUpdatedIcon?.();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [onUpdatedIcon, onClose, updatePage, view]);

  const handleRemoveIcon = useCallback(() => {
    void handleChangeIcon({ ty: 0, value: '' });
  }, [handleChangeIcon]);

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        onSelect={() => {
          onOpenRenameModal(view.view_id);
        }}
      >
        <EditIcon />{t('button.rename')}
      </DropdownMenuItem>
      <CustomIconPopover
        modal
        onSelectIcon={handleChangeIcon}
        removeIcon={handleRemoveIcon}
        defaultActiveTab={'icon'}
        tabs={['icon']}
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
      <DropdownMenuItem
        disabled={deleteDisabled}
        onSelect={() => {
          onOpenDeleteModal(view.view_id);
        }}
      >
        <DeleteIcon />{t('button.delete')}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}