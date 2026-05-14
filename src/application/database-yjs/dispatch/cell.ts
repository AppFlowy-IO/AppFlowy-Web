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

import { useDatabaseContext } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YDatabaseCell, YDatabaseCells, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { Log } from '@/utils/log';

const ROW_DATA_WAIT_MS = 3000;

type CellUpdateData = string | Y.Array<string>;

type DateCellOptions = {
  endTimestamp?: string;
  includeTime?: boolean;
  isRange?: boolean;
  reminderId?: string;
};

type WritableRowTarget = {
  row: YDatabaseRow;
  cells: YDatabaseCells;
};

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

function getWritableRowTarget(rowDoc: YDoc): WritableRowTarget | null {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const row = rowSharedRoot.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
  const cells = row?.get(YjsDatabaseKey.cells);

  if (!row || !cells) return null;

  return { row, cells };
}

function waitForWritableRowTarget(rowDoc: YDoc): Promise<WritableRowTarget | null> {
  const target = getWritableRowTarget(rowDoc);

  if (target) return Promise.resolve(target);

  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;

  return new Promise((resolve) => {
    let rowUnobserve: (() => void) | null = null;
    let settled = false;

    const finish = (target: WritableRowTarget | null) => {
      if (settled) return;
      settled = true;
      rowSharedRoot.unobserve(onRootChange);
      rowUnobserve?.();
      clearTimeout(timeoutId);
      resolve(target);
    };

    const attachRowObserver = () => {
      rowUnobserve?.();
      rowUnobserve = null;

      const row = rowSharedRoot.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

      if (!row) return;

      const onRowChange = () => {
        const nextTarget = getWritableRowTarget(rowDoc);

        if (nextTarget) finish(nextTarget);
      };

      row.observe(onRowChange);
      rowUnobserve = () => {
        row.unobserve(onRowChange);
      };
    };

    const checkReady = () => {
      const nextTarget = getWritableRowTarget(rowDoc);

      if (nextTarget) {
        finish(nextTarget);
        return;
      }

      attachRowObserver();
    };

    const onRootChange = () => {
      checkReady();
    };

    const timeoutId = setTimeout(() => {
      finish(null);
    }, ROW_DATA_WAIT_MS);

    rowSharedRoot.observe(onRootChange);
    checkReady();
  });
}

function writeCellToRow({
  rowDoc,
  row,
  cells,
  fieldId,
  fieldType,
  data,
  dateOpts,
}: {
  rowDoc: YDoc;
  row: YDatabaseRow;
  cells: YDatabaseCells;
  fieldId: string;
  fieldType: number;
  data: CellUpdateData;
  dateOpts?: DateCellOptions;
}) {
  const cell = cells.get(fieldId);

  rowDoc.transact(() => {
    if (!cell) {
      const newCell = new Y.Map() as YDatabaseCell;

      newCell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
      newCell.set(YjsDatabaseKey.field_type, fieldType);
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

      cell.set(YjsDatabaseKey.field_type, fieldType);
      cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    }

    row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
  });
}

export function useUpdateCellDispatch(rowId: string, fieldId: string) {
  const { rowMap, ensureRow } = useDatabaseContext();
  const { field } = useFieldSelector(fieldId);

  return useCallback(
    (
      data: CellUpdateData,
      dateOpts?: DateCellOptions
    ) => {
      void (async () => {
        if (!field) {
          Log.warn('[useUpdateCellDispatch] Field not found', { rowId, fieldId });
          return;
        }

        let rowDoc = rowMap?.[rowId];
        let target = rowDoc ? getWritableRowTarget(rowDoc) : null;

        if (!target && ensureRow) {
          rowDoc = (await ensureRow(rowId)) ?? rowDoc;
          target = rowDoc ? await waitForWritableRowTarget(rowDoc) : null;
        }

        if (!rowDoc || !target) {
          Log.warn('[useUpdateCellDispatch] Row doc not ready for cell update', { rowId, fieldId });
          return;
        }

        writeCellToRow({
          rowDoc,
          row: target.row,
          cells: target.cells,
          fieldId,
          fieldType: Number(field.get(YjsDatabaseKey.type)),
          data,
          dateOpts,
        });
      })().catch((error: unknown) => {
        Log.error('[useUpdateCellDispatch] failed to update cell', { rowId, fieldId, error });
      });
    },
    [ensureRow, field, fieldId, rowMap, rowId]
  );
}

export function useUpdateStartEndTimeCell() {
  const { rowMap, ensureRow } = useDatabaseContext();

  return useCallback(
    async (rowId: string, fieldId: string, startTimestamp: string, endTimestamp?: string, isAllDay?: boolean) => {
      let rowDoc = rowMap?.[rowId];
      let target = rowDoc ? getWritableRowTarget(rowDoc) : null;

      if (!target && ensureRow) {
        rowDoc = (await ensureRow(rowId)) ?? rowDoc;
        target = rowDoc ? await waitForWritableRowTarget(rowDoc) : null;
      }

      if (!rowDoc || !target) {
        const error = new Error('Row doc not ready for cell update');

        Log.warn('[useUpdateStartEndTimeCell] Row doc not ready for cell update', { rowId, fieldId });
        throw error;
      }

      const writableTarget = target;

      rowDoc.transact(() => {
        let cell = writableTarget.cells.get(fieldId);

        if (!cell) {
          cell = new Y.Map() as YDatabaseCell;
          cell.set(YjsDatabaseKey.field_type, FieldType.DateTime);

          cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
          writableTarget.cells.set(fieldId, cell);
        }

        cell.set(YjsDatabaseKey.data, startTimestamp);
        cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

        updateDateCell(cell, {
          data: startTimestamp,
          endTimestamp,
          isRange: !!endTimestamp,
          includeTime: !isAllDay,
        });
        writableTarget.row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
      });
    },
    [ensureRow, rowMap]
  );
}
