import { ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, parseSelectOptionTypeOptions, Row, useFieldSelector } from '@/application/database-yjs';
import { BOARD_COLUMN_BASE_COLORS } from '@/application/database-yjs/board-column-color';
import { useToggleHiddenGroupColumnDispatch, useUpdateSelectOption } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CalculateIcon } from '@/assets/icons/calculate.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import {
  ColumnCalculationMenu,
  type ColumnCalculationPane,
} from '@/components/database/components/board/column/ColumnCalculationMenu';
import ColumnDeleteConfirm from '@/components/database/components/board/column/ColumnDeleteConfirm';
import ColumnRename from '@/components/database/components/board/column/ColumnRename';
import { useBoardColumnDisplay } from '@/components/database/components/board/group/board-display-context';
import { SelectOptionColorMap } from '@/components/database/components/cell/cell.const';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type ColumnMenuPane = 'main' | ColumnCalculationPane;

/**
 * "Color columns" is on and the column is an option of a select grouping:
 * the ten base colours, which recolour that option (WP09 §1.5).
 */
function ColumnColorRow({ fieldId, optionId }: { fieldId: string; optionId: string }) {
  const { t } = useTranslation();
  const { field, clock } = useFieldSelector(fieldId);
  const updateOption = useUpdateSelectOption(fieldId);
  const option = useMemo(() => {
    void clock;
    return field ? parseSelectOptionTypeOptions(field)?.options.find((item) => item.id === optionId) : undefined;
  }, [clock, field, optionId]);

  if (!option) return null;

  return (
    <>
      <div className='-mx-2 my-1 h-px bg-border-primary' role='separator' />
      <div className='px-2 py-1 text-xs leading-4 text-text-tertiary'>{t('pageStyle.colors', 'Colors')}</div>
      <div className='flex flex-wrap gap-1 px-1.5 pb-1' data-testid='board-column-color-row' role='radiogroup'>
        {BOARD_COLUMN_BASE_COLORS.map((color) => (
          <button
            aria-checked={option.color === color}
            aria-label={color}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-100 border border-border-primary',
              option.color === color && 'ring-2 ring-border-theme-thick'
            )}
            data-testid={`board-column-color-${color}`}
            key={color}
            onClick={() => updateOption(option.id, { ...option, color })}
            role='radio'
            type='button'
          >
            <span className='h-3 w-3 rounded-[3px]' style={{ backgroundColor: `var(${SelectOptionColorMap[color]})` }} />
          </button>
        ))}
      </div>
    </>
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
}: {
  children: ReactNode;
  groupId: string;
  id: string;
  fieldId: string;
  renameEnabled: boolean;
  deleteEnabled: boolean;
  hideEnabled?: boolean;
  getCards: (id: string) => Row[];
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const toggleHidden = useToggleHiddenGroupColumnDispatch(groupId, fieldId);
  const { showColorColumns } = useBoardColumnDisplay();
  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const coloredOption =
    showColorColumns && id !== fieldId && (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect);

  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<ColumnMenuPane>('main');
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

    return content
      .join(', ')
      .toLowerCase()
      .replace(/(^\w{1})/g, (letter) => letter.toUpperCase());
  }, [renameEnabled, hideEnabled, deleteEnabled, t]);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Each opening starts on the column menu itself.
          if (!next) setPane('main');
        }}
        modal
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <PopoverTrigger asChild>{children}</PopoverTrigger>
            </div>
          </TooltipTrigger>
          <TooltipContent>{tooltipContent}</TooltipContent>
        </Tooltip>
        <PopoverContent align={'start'} className='w-[240px]' onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className='flex flex-col p-2' data-testid='board-column-menu'>
            {pane === 'main' ? (
              <>
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
                <div className='-mx-2 my-1 h-px bg-border-primary' role='separator' />
                <div
                  className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
                  data-testid='board-column-calculate'
                  onClick={() => setPane('calculate')}
                  role='menuitem'
                >
                  {/* The desktop glyph draws a fixed stroke; follow the text colour. */}
                  <CalculateIcon aria-hidden='true' className='h-5 w-5 [&_path]:stroke-current' />
                  <span className='flex-1'>{t('board.column.calculate')}</span>
                  <ChevronRightIcon aria-hidden='true' className='h-4 w-4 text-icon-secondary' />
                </div>
                {coloredOption ? <ColumnColorRow fieldId={fieldId} optionId={id} /> : null}
              </>
            ) : (
              <ColumnCalculationMenu
                onBack={() => setPane('main')}
                onDone={() => {
                  setOpen(false);
                  setPane('main');
                }}
                onPaneChange={setPane}
                pane={pane}
              />
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
