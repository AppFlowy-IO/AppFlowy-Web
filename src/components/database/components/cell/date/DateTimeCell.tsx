import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDateTimeCellString } from '@/application/database-yjs';
import { CellProps, DateTimeCell as DateTimeCellType } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as ReminderSvg } from '@/assets/icons/clock_alarm.svg';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import DateTimeCellPicker from '@/components/database/components/cell/date/DateTimeCellPicker';
import { useRowPeekNavigationGuard } from '@/components/database/row-peek/RowPeekNavigation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/utils/copy';

export function DateTimeCell({
  cell,
  rowId,
  fieldId,
  style,
  placeholder,
  editing,
  setEditing,
  readOnly,
  wrap,
  isHovering,
  onCellUpdated,
}: CellProps<DateTimeCellType>) {
  const { t } = useTranslation();
  const dateStr = useDateTimeCellString(cell, fieldId);
  const updateCell = useUpdateCellDispatch(rowId, fieldId);
  const pendingWrite = useRef<ReturnType<typeof updateCell>>();

  // The cell outlives its popup, so dismissing the picker must not discard the
  // barrier for an edit that is still being saved (or was refused).
  useRowPeekNavigationGuard(async () => {
    for (;;) {
      const pending = pendingWrite.current;

      if (!pending) return true;
      const status = await pending;

      if (pending === pendingWrite.current) return status === 'written' || status === 'noop';
    }
  });

  const saveCell = useCallback(
    (...args: Parameters<typeof updateCell>) => {
      const write = updateCell(...args);

      pendingWrite.current = write;
      return write;
    },
    [updateCell]
  );

  const hasReminder = !!cell?.reminderId;

  const handleOpenChange = useCallback(
    (status: boolean) => {
      setEditing?.(status);
    },
    [setEditing]
  );

  const handleCopy = () => {
    if (!dateStr) return;
    void copyTextToClipboard(dateStr);
    toast.success(t('grid.field.copiedDate'));
  };

  return (
    <div
      data-testid={`datetime-cell-${rowId}-${fieldId}`}
      style={style}
      className={cn(
        'flex gap-1',
        !cell?.data && 'text-text-tertiary',
        readOnly ? 'cursor-text' : 'cursor-pointer',
        wrap ? 'flex-wrap whitespace-pre-wrap break-words' : 'flex-nowrap'
      )}
    >
      {cell?.data ? dateStr : placeholder || null}
      {hasReminder && <ReminderSvg className={'h-5 w-5'} />}
      {editing ? (
        <DateTimeCellPicker
          onCellUpdated={onCellUpdated}
          cell={cell}
          fieldId={fieldId}
          rowId={rowId}
          open={editing}
          onOpenChange={handleOpenChange}
          updateCell={saveCell}
        />
      ) : null}
      {isHovering && dateStr && (
        <div className={'absolute right-1 top-1'}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopy();
                }}
                variant={'outline'}
                size={'icon'}
                className={'bg-surface-primary hover:bg-surface-primary-hover'}
              >
                <CopyIcon className={'h-5 w-5'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('settings.menu.clickToCopy')}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
