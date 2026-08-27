import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';

export function DatabaseViewActions({
  onOpenRenameModal,
  onOpenDeleteModal,
  onDuplicate,
  view,
  deleteDisabled,
  duplicateDisabled,
}: {
  deleteDisabled: boolean;
  duplicateDisabled?: boolean;
  view: View;
  onDuplicate?: (viewId: string) => void;
  onOpenRenameModal: (view: View) => void;
  onOpenDeleteModal: (viewId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        data-testid='database-view-action-rename'
        onSelect={() => {
          onOpenRenameModal(view);
        }}
      >
        <EditIcon />
        {t('button.rename')}
      </DropdownMenuItem>
      {onDuplicate ? (
        <DropdownMenuItem
          data-testid='database-view-action-duplicate'
          disabled={duplicateDisabled}
          onSelect={() => {
            onDuplicate(view.view_id);
          }}
        >
          <DuplicateIcon />
          {t('button.duplicate')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        data-testid='database-view-action-delete'
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
