import { EventApi, EventContentArg } from '@fullcalendar/core';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DatabaseContext, useNavigateToRow } from '@/application/database-yjs/context';
import DeleteRowConfirm from '@/components/database/components/database-row/DeleteRowConfirm';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useEventContext } from '../CalendarContent';

import { useCalendarDraftContext } from './CalendarDraftContext';
import { EventDisplay } from './EventDisplay';
import EventPopoverContent from './EventPopoverContent';

interface EventWithPopoverProps {
  event: EventApi;
  eventInfo: EventContentArg;
  isWeekView?: boolean;
}

const PersistedEventWithPopover = memo(({ event, eventInfo, isWeekView = false }: EventWithPopoverProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [deleteConfirmationPending, setDeleteConfirmationPending] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { clearNewEvent, setOpenEventRowId, clearUpdateEvent } = useEventContext();
  const rowId = event.id;

  // Check if this is a newly created event and should auto-open
  // For newly created events, only open the start segment (isStart=true)
  const isNewEvent = event.extendedProps?.isNew;
  const isUpdateEvent = event.extendedProps?.isUpdate;
  const isStart = eventInfo.isStart;

  useEffect(() => {
    // Auto-open newly created events at their start segment
    if ((isNewEvent || isUpdateEvent) && isStart) {
      setIsOpen(true);
    }
  }, [isNewEvent, isUpdateEvent, isStart, eventInfo]);

  useEffect(() => {
    if (isOpen || !deleteConfirmationPending) return;

    // Radix removes its document-level focus listeners in a passive effect.
    // Mount MUI's dialog in a subsequent render so those listeners are gone
    // before the dialog moves focus into its own trap.
    setDeleteConfirmationPending(false);
    setShowDeleteConfirm(true);
  }, [deleteConfirmationPending, isOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);

      // When closing the popover for a new event, clear its new status
      if (!open && isNewEvent) {
        clearNewEvent(rowId);
      }

      if (!open && isUpdateEvent) {
        clearUpdateEvent(rowId);
      }

      if (open) {
        setOpenEventRowId(rowId);
      } else {
        setOpenEventRowId(null);
      }
    },
    [isNewEvent, isUpdateEvent, rowId, clearNewEvent, clearUpdateEvent, setOpenEventRowId]
  );

  const handleCloseEvent = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const handleDeleteRequest = useCallback(() => {
    // A modal Radix popover and a MUI dialog cannot own focus at the same time.
    // Close the popover first; the effect above opens the dialog only after the
    // popover's focus-trap cleanup has run.
    setDeleteConfirmationPending(true);
    handleOpenChange(false);
  }, [handleOpenChange]);

  const handleCloseDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  const handleGotoDate = useCallback(
    (date: Date) => {
      const calendar = eventInfo.view.calendar;

      return calendar.gotoDate(date);
    },
    [eventInfo]
  );

  return (
    <>
      <div className='relative h-full w-full'>
        <EventDisplay
          onClick={() => {
            handleOpenChange(true);
          }}
          event={event}
          eventInfo={eventInfo}
          isWeekView={isWeekView}
        />
        {isOpen && (
          <Popover open={isOpen} modal onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
              <div
                style={{
                  zIndex: isOpen ? 1 : -1,
                  pointerEvents: isOpen ? 'auto' : 'none',
                }}
                className='absolute left-0 top-0 h-full w-full'
              ></div>
            </PopoverTrigger>
            <PopoverContent collisionPadding={20} side='left' align='center' sideOffset={8}>
              <EventPopoverContent
                onGotoDate={handleGotoDate}
                rowId={rowId}
                onCloseEvent={handleCloseEvent}
                onRequestDelete={handleDeleteRequest}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
      {showDeleteConfirm ? <DeleteRowConfirm open onClose={handleCloseDeleteConfirm} rowIds={[rowId]} /> : null}
    </>
  );
});

export const EventWithPopover = memo((props: EventWithPopoverProps) => {
  const draftContext = useCalendarDraftContext();
  const navigateToRow = useNavigateToRow();
  const draft = draftContext?.draft;

  if (draftContext && props.event.extendedProps.isDraft && draft?.id === props.event.id) {
    return (
      <DatabaseContext.Provider value={draft.context}>
        <DraftEventWithPopover
          {...props}
          saving={draft.saving}
          finish={draftContext.finishDraft}
          discard={draftContext.discardDraft}
          navigateToRow={navigateToRow}
        />
      </DatabaseContext.Provider>
    );
  }

  return <PersistedEventWithPopover {...props} />;
});

function DraftEventWithPopover({
  event,
  eventInfo,
  isWeekView,
  saving,
  finish,
  discard,
  navigateToRow,
}: EventWithPopoverProps & {
  saving: boolean;
  finish: (force?: boolean) => Promise<string | null>;
  discard: () => void;
  navigateToRow?: (id: string) => void;
}) {
  const [open, setOpen] = useState(eventInfo.isStart);
  const complete = useCallback(
    async (force = false, expand = false) => {
      if (saving) return;
      try {
        const id = await finish(force);

        setOpen(false);
        if (expand && id) navigateToRow?.(id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [finish, navigateToRow, saving]
  );

  return (
    <div className='relative h-full w-full' data-testid='calendar-draft-event' data-event-id={event.id}>
      <EventDisplay event={event} eventInfo={eventInfo} isWeekView={isWeekView} onClick={() => setOpen(true)} />
      {open && (
        <Popover
          open
          modal
          onOpenChange={(next) => {
            if (!next) void complete();
          }}
        >
          <PopoverTrigger asChild>
            <div className='absolute left-0 top-0 h-full w-full' />
          </PopoverTrigger>
          <PopoverContent
            collisionPadding={20}
            side='left'
            align='center'
            sideOffset={8}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <EventPopoverContent
              rowId={event.id}
              isDraft
              onCloseEvent={() => void complete()}
              onSubmit={() => void complete(true)}
              onExpand={() => void complete(true, true)}
              onRequestDelete={() => {
                discard();
                setOpen(false);
              }}
              onGotoDate={() => undefined}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export default EventWithPopover;
