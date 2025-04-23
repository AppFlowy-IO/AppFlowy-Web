import { ReactComponent as UpIcon } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/copy.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import DeleteRowConfirm from '@/components/database/components/database-row/DeleteRowConfirm';
import { useHoverControlsActions } from '@/components/database/components/grid/controls/HoverControls.hooks';
import { useHoverControlsContext } from '@/components/database/components/grid/controls/HoverControlsContext';
import { DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function RowMenu ({ rowId, onClose }: { rowId: string, onClose: () => void }) {
  const { t } = useTranslation();
  const {
    onAddRowBelow,
    onDuplicateRow,
    onAddRowAbove,
    addAboveLoading,
    addBelowLoading,
    duplicateLoading,
  } = useHoverControlsActions(rowId);

  const { showPreventDialog } = useHoverControlsContext();

  const [openDeleteConfirmed, setOpenDeleteConfirmed] = React.useState(false);

  const actions = useMemo(() => [{
    label: t('grid.row.insertRecordAbove'),
    icon: UpIcon,
    loading: addAboveLoading,
    onSelect: () => {
      showPreventDialog(() => {
        void onAddRowAbove();
      });
    },
  }, {
    label: t('grid.row.insertRecordBelow'),
    icon: PlusIcon,
    loading: addBelowLoading,
    onSelect: () => {
      showPreventDialog(() => {
        void onAddRowBelow();
      });
    },
  }, {
    label: t('grid.row.duplicate'),
    icon: DuplicateIcon,
    loading: duplicateLoading,
    onSelect: onDuplicateRow,
  }, {
    label: t('grid.row.delete'),
    icon: DeleteIcon,
    onSelect: () => {
      setOpenDeleteConfirmed(true);
      onClose();

    },
  }], [t, addAboveLoading, addBelowLoading, duplicateLoading, onDuplicateRow, showPreventDialog, onAddRowAbove, onAddRowBelow, onClose]);

  return (
    <>
      <DropdownMenuContent
        side={'right'}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <DropdownMenuGroup>
          {actions.map(item => (
            <DropdownMenuItem
              key={item.label}
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
      <DeleteRowConfirm
        open={openDeleteConfirmed}
        onClose={() => {
          setOpenDeleteConfirmed(false);
        }}
        rowId={rowId}
      />
    </>

  );
}

export default RowMenu;