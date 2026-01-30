/**
 * Row dispatch hooks
 *
 * Handles all row-related mutations:
 * - useReorderRowDispatch: Reorder rows within a view
 * - useMoveCardDispatch: Move card between board columns
 * - useDeleteRowDispatch: Delete a single row
 * - useBulkDeleteRowDispatch: Delete multiple rows
 * - useNewRowDispatch: Create a new row
 * - useDuplicateRowDispatch: Duplicate an existing row
 * - useUpdateRowMetaDispatch: Update row metadata (icon, cover, etc.)
 */

import dayjs from 'dayjs';
import { useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import {
  useCreateRow,
  useDatabase,
  useDatabaseContext,
  useDatabaseView,
  useDatabaseViewId,
  useDocGuid,
  useRowMap,
  useSharedRoot,
} from '@/application/database-yjs/context';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import { createSelectOptionCell } from '@/application/database-yjs/fields/select-option/utils';
import { dateFilterFillData, filterFillData } from '@/application/database-yjs/filter';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaIdMap, getMetaJSON, getRowKey } from '@/application/database-yjs/row_meta';
import { useDatabaseViewLayout, useCalendarLayoutSetting } from '@/application/database-yjs/selector';
import { executeOperationWithAllViews } from './utils';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import {
  DatabaseViewLayout,
  FieldId,
  RowId,
  YDatabaseCell,
  YDatabaseRow,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';

/**
 * Helper: Reorder a row within a view's row_orders
 */
function reorderRow(rowId: string, beforeRowId: string | undefined, view: YDatabaseView) {
  const rows = view.get(YjsDatabaseKey.row_orders);

  if (!rows) {
    throw new Error('Row orders not found');
  }

  const rowArray = rows.toJSON() as {
    id: string;
  }[];

  const sourceIndex = rowArray.findIndex((row) => row.id === rowId);
  const targetIndex = beforeRowId !== undefined ? rowArray.findIndex((row) => row.id === beforeRowId) + 1 : 0;

  const row = rows.get(sourceIndex);

  rows.delete(sourceIndex);

  let adjustedTargetIndex = targetIndex;

  if (targetIndex > sourceIndex) {
    adjustedTargetIndex -= 1;
  }

  rows.insert(adjustedTargetIndex, [row]);
}

/**
 * Helper: Clone a cell for row duplication
 */
function cloneCell(fieldType: FieldType, referenceCell?: YDatabaseCell) {
  const cell = new Y.Map() as YDatabaseCell;

  referenceCell?.forEach((value, key) => {
    let newValue = value;

    if (typeof value === 'bigint') {
      newValue = value.toString();
    } else if (value && value instanceof Y.Array) {
      return;
    }

    cell.set(key, newValue);
  });

  let data = referenceCell?.get(YjsDatabaseKey.data);

  if (fieldType === FieldType.Relation && data) {
    const newData = new Y.Array<RowId>();
    const referenceData = data as Y.Array<RowId>;

    referenceData.toArray().forEach((rowId) => {
      newData.push([rowId]);
    });
    data = newData;
  }

  if (fieldType === FieldType.FileMedia) {
    const newData = new Y.Array<string>();
    const referenceData = data as Y.Array<string>;

    referenceData.toArray().forEach((file) => {
      newData.push([file]);
    });
    data = newData;
  }

  if (referenceCell) {
    cell.set(YjsDatabaseKey.data, data);
  }

  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
  cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
  cell.set(YjsDatabaseKey.field_type, fieldType);

  return cell;
}

export function useReorderRowDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rowId: string, beforeRowId?: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error(`Unable to reorder card`);
            }

            reorderRow(rowId, beforeRowId, view);
          },
        ],
        'reorderRow'
      );
    },
    [view, sharedRoot]
  );
}

export function useMoveCardDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowMap();
  const database = useDatabase();

  return useCallback(
    ({
      rowId,
      beforeRowId,
      fieldId,
      startColumnId,
      finishColumnId,
    }: {
      rowId: string;
      beforeRowId?: string;
      fieldId: string;
      startColumnId: string;
      finishColumnId: string;
    }) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error(`Unable to reorder card`);
            }

            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            const fieldType = Number(field.get(YjsDatabaseKey.type));

            const rowDoc = rowMap?.[rowId];

            if (!rowDoc) {
              throw new Error(`Unable to reorder card`);
            }

            const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

            const cells = row.get(YjsDatabaseKey.cells);
            const isSelectOptionField = [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);

            let cell = cells.get(fieldId);

            if (!cell) {
              // if the cell is empty, create a new cell and set data to finishColumnId
              if (isSelectOptionField) {
                cell = createSelectOptionCell(fieldId, fieldType, finishColumnId);
              } else if (fieldType === FieldType.Checkbox) {
                cell = createCheckboxCell(fieldId, finishColumnId);
              }

              cells.set(fieldId, cell);
            } else {
              const cellData = cell.get(YjsDatabaseKey.data);
              let newCellData = cellData;

              if (isSelectOptionField) {
                const selectedIds = (cellData as string)?.split(',') ?? [];
                const index = selectedIds.findIndex((id) => id === startColumnId);

                if (selectedIds.includes(finishColumnId)) {
                  // if the finishColumnId is already in the selectedIds
                  selectedIds.splice(index, 1); // remove the startColumnId from the selectedIds
                } else {
                  selectedIds.splice(index, 1, finishColumnId); // replace the startColumnId with finishColumnId
                }

                newCellData = selectedIds.join(',');
              } else if (fieldType === FieldType.Checkbox) {
                newCellData = finishColumnId;
              }

              cell.set(YjsDatabaseKey.data, newCellData);
            }

            reorderRow(rowId, beforeRowId, view);
          },
        ],
        'reorderCard'
      );
    },
    [database, rowMap, sharedRoot, view]
  );
}

export function useDeleteRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rowId: string) => {
      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          if (!view) {
            throw new Error(`Unable to delete row`);
          }

          const rows = view.get(YjsDatabaseKey.row_orders);

          const rowArray = rows.toJSON() as {
            id: string;
          }[];

          const sourceIndex = rowArray.findIndex((row) => row.id === rowId);

          rows.delete(sourceIndex);
        },
        'deleteRowDispatch'
      );
    },
    [sharedRoot, database]
  );
}

export function useBulkDeleteRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rowIds: string[]) => {
      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          if (!view) {
            throw new Error(`Unable to bulk delete rows`);
          }

          const rows = view.get(YjsDatabaseKey.row_orders);

          rowIds.forEach((rowId) => {
            const rowArray = rows.toJSON() as {
              id: string;
            }[];

            const sourceIndex = rowArray.findIndex((row) => row.id === rowId);

            // If the row is not found, skip it
            if (sourceIndex !== -1) {
              rows.delete(sourceIndex);
            }
          });
        },
        'bulkDeleteRowDispatch'
      );
    },
    [sharedRoot, database]
  );
}

export function useNewRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const createRow = useCreateRow();
  const guid = useDocGuid();
  const viewId = useDatabaseViewId();
  const currentView = useDatabaseView();
  const layout = useDatabaseViewLayout();
  const isCalendar = layout === DatabaseViewLayout.Calendar;
  const calendarSetting = useCalendarLayoutSetting();
  const filters = currentView?.get(YjsDatabaseKey.filters);
  const { navigateToRow } = useDatabaseContext();

  return useCallback(
    async ({
      beforeRowId,
      cellsData,
      tailing = false,
    }: {
      beforeRowId?: string;
      cellsData?: Record<
        FieldId,
        | string
        | {
            data: string;
            endTimestamp?: string;
            isRange?: boolean;
            includeTime?: boolean;
            reminderId?: string;
          }
      >;
      tailing?: boolean;
    }) => {
      if (!currentView) {
        throw new Error('Current view not found');
      }

      if (!createRow) {
        throw new Error('No createRow function');
      }

      const rowId = uuidv4();
      const rowKey = getRowKey(guid, rowId);
      const rowDoc = await createRow(rowKey);
      let shouldOpenRowModal = false;

      rowDoc.transact(() => {
        initialDatabaseRow(rowId, database.get(YjsDatabaseKey.id), rowDoc);
        const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
        const row = rowSharedRoot.get(YjsEditorKey.database_row);

        const cells = row.get(YjsDatabaseKey.cells);

        if (filters) {
          filters.toArray().forEach((filter) => {
            const cell = new Y.Map() as YDatabaseCell;
            const fieldId = filter.get(YjsDatabaseKey.field_id);
            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) {
              return;
            }

            if (isCalendar && calendarSetting?.fieldId === fieldId) {
              shouldOpenRowModal = true;
            }

            const type = Number(field.get(YjsDatabaseKey.type));

            if (type === FieldType.DateTime) {
              const { data, endTimestamp, isRange } = dateFilterFillData(filter);

              if (data !== null) {
                cell.set(YjsDatabaseKey.data, data);
              }

              if (endTimestamp) {
                cell.set(YjsDatabaseKey.end_timestamp, endTimestamp);
              }

              if (isRange) {
                cell.set(YjsDatabaseKey.is_range, isRange);
              }
            } else if ([FieldType.CreatedTime, FieldType.LastEditedTime].includes(type)) {
              shouldOpenRowModal = true;
              return;
            } else {
              const data = filterFillData(filter, field);

              if (data === null) {
                return;
              }

              cell.set(YjsDatabaseKey.data, data);
            }

            cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
            cell.set(YjsDatabaseKey.field_type, type);

            cells.set(fieldId, cell);
          });
        }

        if (cellsData) {
          Object.entries(cellsData).forEach(([fieldId, data]) => {
            const cell = new Y.Map() as YDatabaseCell;
            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            const type = Number(field.get(YjsDatabaseKey.type));

            cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
            cell.set(YjsDatabaseKey.field_type, type);

            if (typeof data === 'object') {
              cell.set(YjsDatabaseKey.data, data.data);
              cell.set(YjsDatabaseKey.end_timestamp, data.endTimestamp);
              cell.set(YjsDatabaseKey.is_range, data.isRange);
              cell.set(YjsDatabaseKey.include_time, data.includeTime);
              cell.set(YjsDatabaseKey.reminder_id, data.reminderId);
            } else {
              cell.set(YjsDatabaseKey.data, data);
            }

            cells.set(fieldId, cell);
          });
        }

        row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

        if (shouldOpenRowModal) {
          navigateToRow?.(rowId);
        }
      });

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view, id) => {
          const rowOrders = view.get(YjsDatabaseKey.row_orders);

          if (!rowOrders) {
            throw new Error(`Row orders not found`);
          }

          const row = {
            id: rowId,
            height: 36,
          };

          const index = beforeRowId ? rowOrders.toArray().findIndex((row) => row.id === beforeRowId) + 1 : 0;

          if ((viewId !== id && index === -1) || tailing) {
            rowOrders.push([row]);
          } else {
            rowOrders.insert(index, [row]);
          }
        },
        'newRowDispatch'
      );

      if (isCalendar && shouldOpenRowModal) {
        return null;
      }

      return rowId;
    },
    [calendarSetting, createRow, currentView, database, filters, guid, isCalendar, navigateToRow, sharedRoot, viewId]
  );
}

export function useDuplicateRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const createRow = useCreateRow();
  const guid = useDocGuid();
  const rowMap = useRowMap();

  return useCallback(
    async (referenceRowId: string) => {
      const referenceRowDoc = rowMap?.[referenceRowId];

      if (!referenceRowDoc) {
        throw new Error(`Row not found`);
      }

      if (!createRow) {
        throw new Error('No createRow function');
      }

      const referenceRowSharedRoot = referenceRowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const referenceRow = referenceRowSharedRoot.get(YjsEditorKey.database_row);
      const referenceCells = referenceRow.get(YjsDatabaseKey.cells);
      const referenceMeta = getMetaJSON(referenceRowId, referenceRowSharedRoot.get(YjsEditorKey.meta));

      const rowId = uuidv4();

      const icon = referenceMeta.icon;
      const cover = referenceMeta.cover;

      const newMeta = generateRowMeta(rowId, {
        [RowMetaKey.IsDocumentEmpty]: true,
        [RowMetaKey.IconId]: icon,
        [RowMetaKey.CoverId]: cover ? JSON.stringify(cover) : null,
      });

      const rowKey = getRowKey(guid, rowId);
      const rowDoc = await createRow(rowKey);

      rowDoc.transact(() => {
        initialDatabaseRow(rowId, database.get(YjsDatabaseKey.id), rowDoc);

        const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;

        const row = rowSharedRoot.get(YjsEditorKey.database_row);

        const meta = rowSharedRoot.get(YjsEditorKey.meta);

        Object.keys(newMeta).forEach((key) => {
          const value = newMeta[key];

          if (value) {
            meta.set(key, value);
          }
        });

        const cells = row.get(YjsDatabaseKey.cells);

        Object.keys(referenceCells.toJSON()).forEach((fieldId) => {
          try {
            const referenceCell = referenceCells.get(fieldId);

            if (!referenceCell) {
              throw new Error(`Cell not found`);
            }

            const fields = database.get(YjsDatabaseKey.fields);
            const fieldType = Number(fields.get(fieldId)?.get(YjsDatabaseKey.type));

            const cell = cloneCell(fieldType, referenceCell);

            cells.set(fieldId, cell);
          } catch (e) {
            console.error(e);
          }
        });

        row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
      });

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const rowOrders = view.get(YjsDatabaseKey.row_orders);

          if (!rowOrders) {
            throw new Error(`Row orders not found`);
          }

          const row = {
            id: rowId,
            height: 36,
          };

          const referenceIndex = rowOrders.toArray().findIndex((row) => row.id === referenceRowId);
          const targetIndex = referenceIndex + 1;

          if (targetIndex >= rowOrders.length) {
            rowOrders.push([row]);
            return;
          }

          rowOrders.insert(targetIndex, [row]);
        },
        'duplicateRowDispatch'
      );

      return rowId;
    },
    [createRow, database, guid, rowMap, sharedRoot]
  );
}

export function useUpdateRowMetaDispatch(rowId: string) {
  const rowMap = useRowMap();

  // Store rowMap in a ref so the callback always gets the latest value
  // This fixes a bug where rowDoc might not be in the map when the hook is first called,
  // but is added later when the row document loads asynchronously
  const rowMapRef = useRef(rowMap);

  useEffect(() => {
    rowMapRef.current = rowMap;
  });

  return useCallback(
    (key: RowMetaKey, value?: string | boolean) => {
      // Get rowDoc from the ref to always use the latest map
      const rowDoc = rowMapRef.current?.[rowId];

      if (!rowDoc) {
        console.warn(`[useUpdateRowMetaDispatch] Row not found: ${rowId}`);
        return;
      }

      const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const meta = rowSharedRoot.get(YjsEditorKey.meta);

      const keyId = getMetaIdMap(rowId).get(key);

      if (!keyId) {
        throw new Error(`Meta key not found: ${key}`);
      }

      const isDifferent = meta.get(keyId) !== value;

      if (!isDifferent) {
        return;
      }

      rowDoc.transact(() => {
        if (value === undefined) {
          meta.delete(keyId);
        } else {
          meta.set(keyId, value);
        }
      });
    },
    [rowId]
  );
}
