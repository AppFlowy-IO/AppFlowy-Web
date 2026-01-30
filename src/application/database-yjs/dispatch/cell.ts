/**
 * Cell dispatch hooks
 *
 * Handles cell value mutations:
 * - useUpdateCellDispatch: Update a cell's value
 * - useUpdateStartEndTimeCell: Update date/time cell with start/end times
 */

import dayjs from 'dayjs';
import { useCallback } from 'react';
import * as Y from 'yjs';

import { useRowMap } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YDatabaseCell, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { Log } from '@/utils/log';

/**
 * Helper: Update date cell with optional end timestamp, range, etc.
 */
function updateDateCell(
  cell: YDatabaseCell,
  payload: {
    data: string;
    endTimestamp?: string;
    includeTime?: boolean;
    isRange?: boolean;
    reminderId?: string;
  }
) {
  cell.set(YjsDatabaseKey.data, payload.data);

  if (payload.endTimestamp !== undefined) {
    cell.set(YjsDatabaseKey.end_timestamp, payload.endTimestamp);
  }

  if (payload.includeTime !== undefined) {
    Log.debug('includeTime', payload.includeTime);
    cell.set(YjsDatabaseKey.include_time, payload.includeTime);
  }

  if (payload.isRange !== undefined) {
    cell.set(YjsDatabaseKey.is_range, payload.isRange);
  }

  if (payload.reminderId !== undefined) {
    cell.set(YjsDatabaseKey.reminder_id, payload.reminderId);
  }
}

export function useUpdateCellDispatch(rowId: string, fieldId: string) {
  const rowMap = useRowMap();
  const { field } = useFieldSelector(fieldId);

  return useCallback(
    (
      data: string | Y.Array<string>,
      dateOpts?: {
        endTimestamp?: string;
        includeTime?: boolean;
        isRange?: boolean;
        reminderId?: string;
      }
    ) => {
      const rowDoc = rowMap?.[rowId];

      if (!rowDoc) {
        Log.warn('[useUpdateCellDispatch] Row doc not found', { rowId, fieldId });
        return;
      }

      const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const row = rowSharedRoot.get(YjsEditorKey.database_row);

      if (!row) {
        Log.warn('[useUpdateCellDispatch] Row data not found', { rowId, fieldId });
        return;
      }

      const cells = row.get(YjsDatabaseKey.cells);

      if (!cells) {
        Log.warn('[useUpdateCellDispatch] Row cells not found', { rowId, fieldId });
        return;
      }

      const cell = cells.get(fieldId);

      const type = Number(field.get(YjsDatabaseKey.type));

      rowDoc.transact(() => {
        if (!cell) {
          const newCell = new Y.Map() as YDatabaseCell;

          newCell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
          newCell.set(YjsDatabaseKey.field_type, type);
          newCell.set(YjsDatabaseKey.data, data);
          newCell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

          if (dateOpts && (typeof data === 'string' || typeof data === 'number')) {
            updateDateCell(newCell, {
              data,
              ...dateOpts,
            });
          }

          cells.set(fieldId, newCell);
        } else {
          cell.set(YjsDatabaseKey.data, data);

          if (dateOpts && (typeof data === 'string' || typeof data === 'number')) {
            updateDateCell(cell, {
              data,
              ...dateOpts,
            });
          }

          cell.set(YjsDatabaseKey.field_type, type);
          cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
        }

        row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
      });
    },
    [field, fieldId, rowMap, rowId]
  );
}

export function useUpdateStartEndTimeCell() {
  const rowMap = useRowMap();

  return useCallback(
    (rowId: string, fieldId: string, startTimestamp: string, endTimestamp?: string, isAllDay?: boolean) => {
      const rowDoc = rowMap?.[rowId];

      if (!rowDoc) {
        throw new Error(`Row not found`);
      }

      const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const row = rowSharedRoot.get(YjsEditorKey.database_row);

      const cells = row.get(YjsDatabaseKey.cells);

      rowDoc.transact(() => {
        let cell = cells.get(fieldId);

        if (!cell) {
          cell = new Y.Map() as YDatabaseCell;
          cell.set(YjsDatabaseKey.field_type, FieldType.DateTime);

          cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
          cells.set(fieldId, cell);
        }

        cell.set(YjsDatabaseKey.data, startTimestamp);
        cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

        updateDateCell(cell, {
          data: startTimestamp,
          endTimestamp,
          isRange: !!endTimestamp,
          includeTime: !isAllDay,
        });
        row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
      });
    },
    [rowMap]
  );
}
