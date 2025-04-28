import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import DeleteRowConfirm from '@/components/database/components/database-row/DeleteRowConfirm';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import React from 'react';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { useTranslation } from 'react-i18next';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';

function CardToolbar ({
  onEdit,
  visible,
  rowId,
}: {
  rowId: string;
  visible: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const onDuplicate = useDuplicateRowDispatch();
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
      onClick={e => {
        e.stopPropagation();
      }}
      className={'absolute bg-surface-primary border border-border-primary rounded-100 right-1 top-1.5 flex items-center shadow-toolbar'}
    >
      <Button
        variant={'ghost'}
        onClick={() => {
          onEdit();
        }}
        className={'w-6 h-6 p-0  text-icon-secondary rounded-none border-r border-border-primary'}
      >
        <EditIcon className={'w-4 h-4'} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={'ghost'}
            className={'w-6 p-0 text-icon-secondary  h-6 rounded-none'}
          >
            <MoreIcon className={'w-4 h-4'} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={e => {

            e.preventDefault();
          }}
          side={'right'}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                void onDuplicate(rowId);
              }}
            >
              <DuplicateIcon />
              {t('button.duplicate')}</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                setDeleteConfirm(true);
              }}
            >
              <DeleteIcon />
              {t('button.delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {deleteConfirm && <DeleteRowConfirm
        open={deleteConfirm}
        onClose={() => {
          setDeleteConfirm(false);
        }}
        rowId={rowId}
      />}

    </div>
  );
}

export default CardToolbar;