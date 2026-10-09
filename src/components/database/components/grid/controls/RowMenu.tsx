import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as UpIcon } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useHoverControlsActions } from '@/components/database/components/grid/controls/HoverControls.hooks';
import { useHoverControlsContext } from '@/components/database/components/grid/controls/HoverControlsContext';
import { DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

/**
 * The row's menu. Its row mounts it only while it is open, so a closed menu
 * costs nothing; the delete confirm it opens lives with the row's controls,
 * which outlive the menu (W8).
 */
function RowMenu({
  rowId,
  groupFieldId,
  groupId,
  onClose,
  onDelete,
}: {
  rowId: string;
  groupFieldId?: string;
  groupId?: string;
  onClose: () => void;
  /** Asks to delete the row: the row's controls show the confirm. */
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { onAddRowBelow, onDuplicateRow, onAddRowAbove, addAboveLoading, addBelowLoading, duplicateLoading } =
    useHoverControlsActions(rowId, groupFieldId, groupId);

  const { showPreventDialog } = useHoverControlsContext();

  const actions = useMemo(
    () => [
      {
        testId: 'row-menu-insert-above',
        label: t('grid.row.insertRecordAbove'),
        icon: UpIcon,
        loading: addAboveLoading,
        onSelect: () => {
          showPreventDialog(() => {
            void onAddRowAbove();
          });
        },
      },
      {
        testId: 'row-menu-insert-below',
        label: t('grid.row.insertRecordBelow'),
        icon: PlusIcon,
        loading: addBelowLoading,
        onSelect: () => {
          showPreventDialog(() => {
            void onAddRowBelow();
          });
        },
      },
      {
        testId: 'row-menu-duplicate',
        label: t('grid.row.duplicate'),
        icon: DuplicateIcon,
        loading: duplicateLoading,
        onSelect: onDuplicateRow,
      },
      {
        testId: 'row-menu-delete',
        label: t('grid.row.delete'),
        icon: DeleteIcon,
        onSelect: () => {
          onDelete();
          onClose();
        },
      },
    ],
    [
      t,
      addAboveLoading,
      addBelowLoading,
      duplicateLoading,
      onDuplicateRow,
      showPreventDialog,
      onAddRowAbove,
      onAddRowBelow,
      onClose,
      onDelete,
    ]
  );

  return (
    <DropdownMenuContent side={'right'} onCloseAutoFocus={(e) => e.preventDefault()}>
      <DropdownMenuGroup>
        {actions.map((item) => (
          <DropdownMenuItem
            key={item.label}
            data-testid={item.testId}
            onSelect={async (e) => {
              e.preventDefault();
              item.onSelect();
              onClose();
            }}
          >
            {item.loading ? <Progress variant={'primary'} /> : <item.icon />}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}

export default RowMenu;
