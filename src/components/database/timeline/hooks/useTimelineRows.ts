import { useMemo } from 'react';

import { CalendarEvent, Row, useRowOrdersSelector, useTimelineEventsSelector } from '@/application/database-yjs';

const EMPTY_ROW_ORDERS: Row[] = [];

export interface TimelineRowModel {
  rowId: string;
  title: string;
  /** Present when the row has a date on the timeline field. */
  start?: Date;
  end?: Date;
  allDay: boolean;
  isRange: boolean;
}

/**
 * Rows in view order (filters and sorts applied). Undated rows only occupy a
 * row when the table is docked, matching Notion; they always stay available
 * through the No-date list.
 */
export function useTimelineRows(includeUndated: boolean) {
  const rowOrders = useRowOrdersSelector();
  const { events, emptyEvents } = useTimelineEventsSelector();

  const rows = useMemo<TimelineRowModel[]>(() => {
    const byRowId = new Map<string, CalendarEvent>();

    events.forEach((event) => byRowId.set(event.rowId, event));
    const undated = new Map<string, CalendarEvent>();

    emptyEvents.forEach((event) => undated.set(event.rowId, event));

    const result: TimelineRowModel[] = [];

    (rowOrders ?? []).forEach((row) => {
      const event = byRowId.get(row.id);

      if (event?.start) {
        result.push({
          rowId: row.id,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          isRange: Boolean(event.isRange),
        });
        return;
      }

      if (!includeUndated) return;
      const empty = undated.get(row.id);

      result.push({ rowId: row.id, title: empty?.title ?? '', allDay: true, isRange: false });
    });

    return result;
  }, [events, emptyEvents, includeUndated, rowOrders]);

  return { rows, emptyEvents, rowOrders: rowOrders ?? EMPTY_ROW_ORDERS };
}
