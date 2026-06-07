import { ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupColorOption, Row } from '@/application/database-yjs';
import {
  useToggleHiddenGroupColumnDispatch,
  useUpdateGroupColumnColorDispatch,
} from '@/application/database-yjs/dispatch';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import {
  BOARD_COLUMN_COLOR_OPTIONS,
  getBoardColumnColorLabelKey,
  getBoardColumnColorStyle,
} from '@/components/database/components/board/column/boardColumnColor';
import ColumnDeleteConfirm from '@/components/database/components/board/column/ColumnDeleteConfirm';
import ColumnRename from '@/components/database/components/board/column/ColumnRename';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function ColorSwatch({ color }: { color?: string }) {
  if (!color || color === 'transparent') {
    return <span className='h-5 w-5 rounded-[4px] border border-border-primary' />;
  }

  return (
    <span className='flex h-5 w-5 items-center justify-center rounded-[4px] border border-border-primary'>
      <span
        className='h-3 w-3 rounded-[2px] border border-border-primary'
        style={{
          backgroundColor: color,
        }}
      />
    </span>
  );
}

export function ColumnMenu({
  children,
  renameEnabled,
  deleteEnabled,
  hideEnabled = true,
  id,
  fieldId,
  groupId,
  getCards,
  showColorColumns,
  currentColorOption,
}: {
  children: ReactNode;
  groupId: string;
  id: string;
  fieldId: string;
  renameEnabled: boolean;
  deleteEnabled: boolean;
  hideEnabled?: boolean;
  getCards: (id: string) => Row[];
  showColorColumns?: boolean;
  currentColorOption?: GroupColorOption;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const toggleHidden = useToggleHiddenGroupColumnDispatch(groupId, fieldId);
  const updateColor = useUpdateGroupColumnColorDispatch(groupId);

  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const canUpdateColor = showColorColumns && id !== fieldId;
  const selectColor = (option: GroupColorOption) => {
    updateColor(id, option);
    setOpen(false);
  };

  const colorOptions = useMemo(() => {
    return BOARD_COLUMN_COLOR_OPTIONS.map((option) => ({
      option,
      label: t(getBoardColumnColorLabelKey(option)),
      swatchColor: getBoardColumnColorStyle(option)?.paletteColor || 'transparent',
    }));
  }, [t]);

  const options = useMemo(() => {
    return [
      renameEnabled && {
        key: 'rename',
        label: t('board.column.renameColumn'),
        Icon: EditIcon,
        onClick: () => {
          setOpen(false);
          setRenameOpen(true);
        },
      },
      hideEnabled && {
        key: 'hide',
        label: t('board.column.hideColumn'),
        Icon: HideIcon,
        onClick: () => {
          toggleHidden(id, true);
        },
      },
      deleteEnabled && {
        key: 'delete',
        label: t('board.column.deleteColumn'),
        Icon: DeleteIcon,
        variant: 'destructive',
        onClick: () => {
          setOpen(false);
          setDeleteOpen(true);
        },
      },
    ].filter(Boolean) as {
      key: string;
      label: string;
      Icon: React.ComponentType<{ className?: string }>;
      variant?: 'destructive';
      onClick: () => void;
    }[];
  }, [deleteEnabled, hideEnabled, id, renameEnabled, t, toggleHidden]);

  const tooltipContent = useMemo(() => {
    const content = [];

    if (renameEnabled) {
      content.push(t('board.column.renameColumn'));
    }

    if (hideEnabled) {
      content.push(t('board.column.hideColumn'));
    }

    if (deleteEnabled) {
      content.push(t('board.column.deleteColumn'));
    }

    if (canUpdateColor) {
      content.push(t('board.column.color'));
    }

    return content
      .join(', ')
      .toLowerCase()
      .replace(/(^\w{1})/g, (letter) => letter.toUpperCase());
  }, [renameEnabled, hideEnabled, deleteEnabled, canUpdateColor, t]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen} modal>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <PopoverTrigger asChild>{children}</PopoverTrigger>
            </div>
          </TooltipTrigger>
          <TooltipContent>{tooltipContent}</TooltipContent>
        </Tooltip>
        <PopoverContent align={'start'} className='w-[240px]' onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className='flex flex-col p-2'>
            {options.map((option) => (
              <div
                key={option.key}
                onClick={option.onClick}
                className={cn(
                  dropdownMenuItemVariants({
                    variant: option.variant === 'destructive' ? 'destructive' : 'default',
                  })
                )}
              >
                <option.Icon className='h-5 w-5' />
                {option.label}
              </div>
            ))}
            {canUpdateColor && (
              <>
                {options.length > 0 && <div className='-mx-2 my-2 border-t border-border-primary' />}
                <div className='flex min-h-8 items-center px-2 py-1 text-xs font-medium text-text-tertiary'>
                  {t('pageStyle.colors')}
                </div>
                {colorOptions.map((color) => (
                  <button
                    key={color.option}
                    type='button'
                    className={cn(dropdownMenuItemVariants(), 'w-full text-left')}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      event.stopPropagation();
                      selectColor(color.option);
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      selectColor(color.option);
                    }}
                  >
                    <ColorSwatch color={color.swatchColor} />
                    <span className='truncate'>{color.label}</span>
                    {currentColorOption === color.option && <DropdownMenuItemTick />}
                  </button>
                ))}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {renameEnabled && <ColumnRename id={id} fieldId={fieldId} open={renameOpen} onOpenChange={setRenameOpen} />}
      {deleteEnabled && (
        <ColumnDeleteConfirm
          groupId={groupId}
          id={id}
          fieldId={fieldId}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          getCards={getCards}
        />
      )}
    </>
  );
}

export default ColumnMenu;
