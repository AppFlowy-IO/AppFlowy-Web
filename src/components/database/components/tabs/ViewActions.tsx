import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';

export function DatabaseViewActions({
  onOpenRenameModal,
  onOpenDeleteModal,
  view,
  deleteDisabled,
}: {
  deleteDisabled: boolean;
  view: View;
  onOpenRenameModal: (viewId: string) => void;
  onOpenDeleteModal: (viewId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        data-testid="database-view-action-rename"
        onSelect={() => {
          onOpenRenameModal(view.view_id);
        }}
      >
        <EditIcon />
        {t('button.rename')}
      </DropdownMenuItem>
      <DropdownMenuItem
        data-testid="database-view-action-delete"
        disabled={deleteDisabled}
        variant={'destructive'}
        onSelect={() => {
          onOpenDeleteModal(view.view_id);
        }}
      >
        <DeleteIcon />
        {t('button.delete')}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}
