/**
 * Cell dispatch hooks
 *
 * Handles cell value mutations:
 * - useUpdateCellDispatch: Update a cell's value
 * - useUpdateStartEndTimeCell: Update date/time cell with start/end times
 */

import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo } from 'react';
import * as Y from 'yjs';

import { AttributionUid, resolveUserAttributionUid, touchRowAttribution } from '@/application/database-yjs/attribution';
import { setCellStoredType } from '@/application/database-yjs/cell.field-type';
import { useDatabase, useDatabaseContext } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  CellWriteIntent,
  CellWriteStatus,
  checkExistingCellWrite,
  writeStatusFor,
} from '@/application/database-yjs/fields/text/rich-text-guard';
import { notifyRichTextNewer } from '@/application/database-yjs/fields/text/rich-text-notice';
import {
  getOrCreateDatabaseHistoryManager,
  runDatabaseHistoryGroup,
  runDatabaseRowAction,
} from '@/application/database-yjs/history';
import type { DatabaseHistoryPolicy } from '@/application/database-yjs/history';
import { useFieldSelector } from '@/application/database-yjs/selector';
import {
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

const ROW_DATA_WAIT_MS = 3000;

type CellUpdateData = string | Y.Array<string>;

type DateCellOptions = {
  endTimestamp?: string;
  includeTime?: boolean;
  isRange?: boolean;
  reminderId?: string;
};

type CellHistoryOptions = {
  historyGroup?: object;
  policy?: DatabaseHistoryPolicy;
  /**
   * Serialized Text-cell formatting (see fields/text/rich-text.ts), written in
   * the same transaction as `data`. A write without it drops any formatting
   * the cell had, since that formatting described the replaced text.
   */
  richText?: string;
  /** Recheck a deferred editor save against the current cell inside its write transaction. */
  shouldWrite?: (cell: YDatabaseCell | undefined) => boolean;
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

/**
 * The keys a cell write would set and delete, for the rich text guard. It
 * mirrors the branches below.
 */
function cellWriteIntent(
  cell: YDatabaseCell,
  data: CellUpdateData,
  richText: string | undefined,
  dateOpts: DateCellOptions | undefined
): CellWriteIntent {
  const set: Record<string, unknown> = { [YjsDatabaseKey.data]: data };
  const deleted: string[] = [YjsDatabaseKey.source_field_type];

  if (richText) {
    set[YjsDatabaseKey.rich_text] = richText;
  } else if (richText === '' || cell.get(YjsDatabaseKey.data) !== data) {
    deleted.push(YjsDatabaseKey.rich_text);
  }

  if (dateOpts && typeof data === 'string') {
    if (dateOpts.endTimestamp !== undefined) set[YjsDatabaseKey.end_timestamp] = dateOpts.endTimestamp;
    if (dateOpts.includeTime !== undefined) set[YjsDatabaseKey.include_time] = dateOpts.includeTime;
    if (dateOpts.isRange !== undefined) set[YjsDatabaseKey.is_range] = dateOpts.isRange;
    if (dateOpts.reminderId !== undefined) set[YjsDatabaseKey.reminder_id] = dateOpts.reminderId;
  }

  return { set, delete: deleted };
}

/**
 * Writes one cell. A cell whose formatting needs a newer client is never
 * changed: a write that would change nothing a reader shows writes nothing
 * (`noop`), any other write is refused (rich text spec R49).
 */
export function writeCellToRow({
  rowDoc,
  row,
  cells,
  fieldId,
  fieldType,
  rowId,
  data,
  dateOpts,
  historyOptions,
  actorUid,
}: {
  rowDoc: YDoc;
  row: YDatabaseRow;
  cells: YDatabaseCells;
  fieldId: string;
  fieldType: FieldType;
  rowId: string;
  data: CellUpdateData;
  dateOpts?: DateCellOptions;
  historyOptions?: CellHistoryOptions;
  actorUid?: AttributionUid;
}): CellWriteStatus {
  const { richText: requestedRichText, shouldWrite, ...historyDescriptor } = historyOptions ?? {};
  // Formatting belongs to Text cells only (URL cells share the text editor).
  const richText = fieldType === FieldType.RichText ? requestedRichText : undefined;
  let status: CellWriteStatus = 'written';

  runDatabaseRowAction(rowDoc, { type: 'cell.update', rowId, fieldId, fieldType, ...historyDescriptor }, () => {
    // Read in the transaction that writes, so nothing comes in between (R50).
    const cell = cells.get(fieldId);

    if (shouldWrite && !shouldWrite(cell)) {
      status = 'cancelled';
      return;
    }

    if (!cell) {
      const newCell = new Y.Map() as YDatabaseCell;

      newCell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
      setCellStoredType(newCell, fieldType);
      newCell.set(YjsDatabaseKey.data, data);
      if (richText) newCell.set(YjsDatabaseKey.rich_text, richText);
      newCell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

      if (dateOpts && (typeof data === 'string' || typeof data === 'number')) {
        updateDateCell(newCell, {
          data,
          ...dateOpts,
        });
      }

      cells.set(fieldId, newCell);
    } else {
      const check = checkExistingCellWrite(cell, cellWriteIntent(cell, data, richText, dateOpts));

      if (check !== 'proceed') {
        status = writeStatusFor(check);
        return;
      }

      const previousData = cell.get(YjsDatabaseKey.data);

      cell.set(YjsDatabaseKey.data, data);

      if (richText) {
        cell.set(YjsDatabaseKey.rich_text, richText);
      } else if (richText === '') {
        // The editor saved this text without formatting.
        if (cell.has(YjsDatabaseKey.rich_text)) cell.delete(YjsDatabaseKey.rich_text);
      } else if (cell.has(YjsDatabaseKey.rich_text) && previousData !== data) {
        // New plain text: the formatting described the text it replaces. A
        // plain write of the same text (e.g. pressing Enter in an unchanged
        // calendar title) keeps it.
        cell.delete(YjsDatabaseKey.rich_text);
      }

      if (dateOpts && (typeof data === 'string' || typeof data === 'number')) {
        updateDateCell(cell, {
          data,
          ...dateOpts,
        });
      }

      setCellStoredType(cell, fieldType);
      cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    }

    touchRowAttribution(row, actorUid);
  });

  return status;
}

/** Marks a written cell, and tells the user about a refused write (R54). */
function reportCellWrite(status: CellWriteStatus, onWritten: () => void) {
  if (status === 'written') onWritten();
  if (status === 'refused-rich-text-newer') notifyRichTextNewer();
}

export function useUpdateCellDispatch(rowId: string, fieldId: string) {
  const { databaseDoc, rowMap, ensureRow, markCellLocalMutation } = useDatabaseContext();
  const { field } = useFieldSelector(fieldId);
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

  return useCallback(
    (data: CellUpdateData, dateOpts?: DateCellOptions, historyOptions?: CellHistoryOptions) => {
      // Callers that do not need the outcome ignore it; a refusal has already
      // been reported to the user.
      return (async (): Promise<CellWriteStatus | undefined> => {
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

        // A lazily loaded row can be edited before the rowMap registration
        // effect runs. Attach it synchronously so its first edit reaches the
        // database-wide history stack.
        getOrCreateDatabaseHistoryManager(databaseDoc).registerRowDoc(rowId, rowDoc);

        const status = writeCellToRow({
          rowDoc,
          row: target.row,
          cells: target.cells,
          fieldId,
          fieldType: Number(field.get(YjsDatabaseKey.type)) as FieldType,
          rowId,
          data,
          dateOpts,
          historyOptions,
          actorUid,
        });

        reportCellWrite(status, () => markCellLocalMutation?.(rowId, fieldId));
        return status;
      })().catch((error: unknown) => {
        Log.error('[useUpdateCellDispatch] failed to update cell', { rowId, fieldId, error });
        return undefined;
      });
    },
    [actorUid, databaseDoc, ensureRow, field, fieldId, markCellLocalMutation, rowMap, rowId]
  );
}

/**
 * Like `useUpdateCellDispatch`, but the row and field are chosen per call so one
 * hook instance can write several rows (e.g. shifting dependent timeline bars).
 */
export function useUpdateAnyCellDispatch() {
  const { databaseDoc, rowMap, ensureRow, markCellLocalMutation } = useDatabaseContext();
  const database = useDatabase();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

  return useCallback(
    (rowId: string, fieldId: string, data: CellUpdateData, historyOptions?: CellHistoryOptions) => {
      return (async (): Promise<CellWriteStatus | undefined> => {
        const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);

        if (!field) {
          Log.warn('[useUpdateAnyCellDispatch] Field not found', { rowId, fieldId });
          return;
        }

        let rowDoc = rowMap?.[rowId];
        let target = rowDoc ? getWritableRowTarget(rowDoc) : null;

        if (!target && ensureRow) {
          rowDoc = (await ensureRow(rowId)) ?? rowDoc;
          target = rowDoc ? await waitForWritableRowTarget(rowDoc) : null;
        }

        if (!rowDoc || !target) {
          Log.warn('[useUpdateAnyCellDispatch] Row doc not ready for cell update', { rowId, fieldId });
          return;
        }

        getOrCreateDatabaseHistoryManager(databaseDoc).registerRowDoc(rowId, rowDoc);

        const status = writeCellToRow({
          rowDoc,
          row: target.row,
          cells: target.cells,
          fieldId,
          fieldType: Number(field.get(YjsDatabaseKey.type)) as FieldType,
          rowId,
          data,
          historyOptions,
          actorUid,
        });

        reportCellWrite(status, () => markCellLocalMutation?.(rowId, fieldId));
        return status;
      })().catch((error: unknown) => {
        Log.error('[useUpdateAnyCellDispatch] failed to update cell', { rowId, fieldId, error });
        return undefined;
      });
    },
    [actorUid, database, databaseDoc, ensureRow, markCellLocalMutation, rowMap]
  );
}

export function useUpdateStartEndTimeCell() {
  const updateCells = useUpdateStartEndTimeCells();

  return useCallback(
    (
      rowId: string,
      fieldId: string,
      startTimestamp: string,
      endTimestamp?: string,
      isAllDay?: boolean,
      historyOptions?: CellHistoryOptions
    ) => {
      void updateCells([{ rowId, fieldId, startTimestamp, endTimestamp, isAllDay }], historyOptions);
    },
    [updateCells]
  );
}

export type DateCellUpdate = {
  rowId: string;
  fieldId: string;
  startTimestamp: string;
  endTimestamp?: string;
  isAllDay?: boolean;
};

function dateRangeWriteIntent({ startTimestamp, endTimestamp, isAllDay }: DateCellUpdate): CellWriteIntent {
  const set: Record<string, unknown> = {
    [YjsDatabaseKey.data]: startTimestamp,
    [YjsDatabaseKey.is_range]: !!endTimestamp,
    [YjsDatabaseKey.include_time]: !isAllDay,
  };

  if (endTimestamp !== undefined) set[YjsDatabaseKey.end_timestamp] = endTimestamp;
  return { set, delete: [YjsDatabaseKey.source_field_type] };
}

/** Resolve every writable row before committing a date edit as one undo group. */
export function useUpdateStartEndTimeCells() {
  const { databaseDoc, activeViewId, rowMap, ensureRow, markCellLocalMutation } = useDatabaseContext();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);
  const { actions: pendingActions } = useMemo(
    () => ({ databaseDoc, activeViewId, actions: new Set<() => void>() }),
    [databaseDoc, activeViewId]
  );

  useEffect(
    () => () => {
      pendingActions.forEach((cancel) => cancel());
      pendingActions.clear();
    },
    [pendingActions]
  );

  return useCallback(
    async (updates: readonly DateCellUpdate[], historyOptions?: CellHistoryOptions) => {
      if (updates.length === 0) return;
      const history = getOrCreateDatabaseHistoryManager(databaseDoc);
      const docs = new Map<string, YDoc>();
      const rowIds = [...new Set(updates.map(({ rowId }) => rowId))];
      const missingRowIds = rowIds.filter((rowId) => {
        const doc = rowMap?.[rowId];

        if (!doc || !getWritableRowTarget(doc)) return true;
        docs.set(rowId, doc);
        return false;
      });

      try {
        if (missingRowIds.length > 0) {
          let cancelled = false;
          const finish = history.registerPendingAction(() => {
            cancelled = true;
          });
          const cancel = () => {
            cancelled = true;
            finish();
          };

          pendingActions.add(cancel);
          try {
            await Promise.all(
              missingRowIds.map(async (rowId) => {
                const doc = (await ensureRow?.(rowId)) ?? rowMap?.[rowId];

                if (!doc || cancelled) return;
                if (await waitForWritableRowTarget(doc)) docs.set(rowId, doc);
              })
            );
            if (cancelled) return;
          } finally {
            pendingActions.delete(cancel);
            finish();
          }
        }

        const targets = new Map<string, WritableRowTarget>();

        // Recheck even rows that were ready initially: their roots may have
        // changed during hydration. A missing target aborts the whole edit.
        for (const rowId of rowIds) {
          const doc = docs.get(rowId);
          const target = doc ? getWritableRowTarget(doc) : null;

          if (!target) {
            Log.warn('[useUpdateStartEndTimeCells] Row doc not ready for date edit', { rowId });
            return;
          }

          targets.set(rowId, target);
        }

        // A drag that would change a cell needing a newer client is refused
        // as a whole, before any row is written (rich text spec R49).
        const checks = updates.map((update) =>
          checkExistingCellWrite(targets.get(update.rowId)?.cells.get(update.fieldId), dateRangeWriteIntent(update))
        );

        if (checks.includes('refuse')) {
          notifyRichTextNewer();
          return;
        }

        runDatabaseHistoryGroup(() => {
          updates.forEach((update) => {
            const { rowId, fieldId, startTimestamp, endTimestamp, isAllDay } = update;
            const rowDoc = docs.get(rowId)!;
            const target = targets.get(rowId)!;
            let written = true;

            history.registerRowDoc(rowId, rowDoc);
            runDatabaseRowAction(
              rowDoc,
              { type: 'cell.update-date-range', rowId, fieldId, fieldType: FieldType.DateTime, ...historyOptions },
              () => {
                let cell = target.cells.get(fieldId);

                // Re-checked in the transaction that writes (R50).
                if (checkExistingCellWrite(cell, dateRangeWriteIntent(update)) !== 'proceed') {
                  written = false;
                  return;
                }

                if (!cell) {
                  cell = new Y.Map() as YDatabaseCell;
                  setCellStoredType(cell, FieldType.DateTime);
                  cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
                  target.cells.set(fieldId, cell);
                }

                setCellStoredType(cell, FieldType.DateTime);
                cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
                updateDateCell(cell, {
                  data: startTimestamp,
                  endTimestamp,
                  isRange: !!endTimestamp,
                  includeTime: !isAllDay,
                });
                touchRowAttribution(target.row, actorUid);
              }
            );
            if (written) markCellLocalMutation?.(rowId, fieldId);
          });
        }, historyOptions?.historyGroup);
      } catch (error) {
        Log.error('[useUpdateStartEndTimeCells] failed to update date cells', { error });
      }
    },
    [actorUid, databaseDoc, ensureRow, markCellLocalMutation, pendingActions, rowMap]
  );
}
