import dayjs from 'dayjs';
import { uniqBy } from 'lodash-es';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Log } from '@/utils/log';
import { FieldType, useFieldsSelector, useNavigateToRow, usePrimaryFieldId } from '@/application/database-yjs';
import { Cell } from '@/application/database-yjs/cell.type';
import { useReadOnly } from '@/application/database-yjs/context';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as ExpandMoreIcon } from '@/assets/icons/full_screen.svg';
import DeleteRowConfirm from '@/components/database/components/database-row/DeleteRowConfirm';
import RowPropertyPrimitive from '@/components/database/components/database-row/RowPropertyPrimitive';
import { EventTitle } from '@/components/database/fullcalendar/event/EventTitle';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useEventContext } from '../CalendarContent';

function EventPopoverContent({
  rowId,
  onCloseEvent,
  onGotoDate,
}: {
  rowId: string;
  onCloseEvent: () => void;
  onGotoDate: (date: Date) => void;
}) {
  const readOnly = useReadOnly();
  const primaryFieldId = usePrimaryFieldId();
  const { setOpenEventRowId, markEventAsNew, markEventAsUpdate } = useEventContext();
  const duplicateRowDispatch = useDuplicateRowDispatch();
  const navigateToRow = useNavigateToRow();
  const { t } = useTranslation();
  const [activePropertyId, setActivePropertyId] = useState<string | null>(null);

  // State for delete confirmation dialog
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const fields = useFieldsSelector();
  const filteredFields = useMemo(() => {
    return uniqBy(
      fields.filter((column) => column.fieldId !== primaryFieldId),
      'fieldId'
    );
  }, [fields, primaryFieldId]);

  // Handle delete action
  const handleDelete = useCallback(() => {
    Log.debug('[EventPopoverContent] Delete button clicked for row:', rowId);
    setShowDeleteConfirm(true);
  }, [rowId]);

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(() => {
    Log.debug('[EventPopoverContent] Delete confirmed for row:', rowId);
    // Close the current popover after deletion
    onCloseEvent();
  }, [onCloseEvent, rowId]);

  // Handle duplicate action
  const handleDuplicate = useCallback(async () => {
    Log.debug('[EventPopoverContent] Duplicate button clicked for row:', rowId);
    try {
      const newRowId = await duplicateRowDispatch(rowId);

      Log.debug('[EventPopoverContent] Row duplicated successfully. New row ID:', newRowId);

      // Mark the new event as new to trigger auto-open popover
      markEventAsNew(newRowId);

      // Close current popover
      setOpenEventRowId(null);

      Log.debug('[EventPopoverContent] New row marked as new and will auto-open popover');
    } catch (error) {
      console.error('[EventPopoverContent] Failed to duplicate row:', error);
    }
  }, [rowId, duplicateRowDispatch, setOpenEventRowId, markEventAsNew]);

  const handleCellUpdated = useCallback(
    (cell: Cell) => {
      if (cell.fieldType === FieldType.DateTime) {
        markEventAsUpdate(rowId);
        if (cell.data) {
          onGotoDate(dayjs.unix(Number(cell.data)).toDate());
        }
      }
    },
    [markEventAsUpdate, onGotoDate, rowId]
  );

  return (
    <div className={'appflowy-scroller max-h-[560px] w-[360px] overflow-y-auto px-3 py-2'}>
      <div className={'sticky top-0 flex w-full items-center justify-end gap-1'}>
        {/* Duplicate button */}
        {!readOnly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon' onClick={handleDuplicate}>
                <DuplicateIcon className='h-5 w-5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='top'>{t('calendar.duplicateEvent')}</TooltipContent>
          </Tooltip>
        )}
        {/* Delete button */}
        {!readOnly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon' className='hover:text-text-error' onClick={handleDelete}>
                <DeleteIcon className='h-5 w-5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='top'>{t('calendar.deleteEvent')}</TooltipContent>
          </Tooltip>
        )}

        {/* Open page button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size={'icon'}
              variant={'ghost'}
              onClick={(e) => {
                e.stopPropagation();
                onCloseEvent();
                navigateToRow?.(rowId);
              }}
            >
              <ExpandMoreIcon className={'h-5 w-5'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='top'>{t('tooltip.openEvent')}</TooltipContent>
        </Tooltip>

        {/* Close button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='icon' onClick={onCloseEvent}>
              <CloseIcon className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='top'>{t('button.close')}</TooltipContent>
        </Tooltip>
      </div>
      <div className={'event-properties flex w-full flex-1 flex-col overflow-y-auto px-0.5'}>
        {primaryFieldId && <EventTitle onCloseEvent={onCloseEvent} rowId={rowId} fieldId={primaryFieldId} />}
        {filteredFields.map((field) => {
          return (
            <RowPropertyPrimitive
              isActive={activePropertyId === field.fieldId}
              setActivePropertyId={setActivePropertyId}
              fieldId={field.fieldId}
              rowId={rowId}
              key={field.fieldId}
              onCellUpdated={handleCellUpdated}
              showPropertyName={false}
            />
          );
        })}
      </div>
      {/* Delete confirmation dialog */}
      <DeleteRowConfirm
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        rowIds={[rowId]}
        onDeleted={handleDeleteConfirm}
      />
    </div>
  );
}

export default EventPopoverContent;
