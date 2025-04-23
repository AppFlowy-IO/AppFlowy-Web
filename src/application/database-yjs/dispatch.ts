import {
  useCreateRow,
  useDatabase,
  useDatabaseView,
  useDatabaseViewId, useDocGuid,
  useRowDocMap,
  useSharedRoot,
} from '@/application/database-yjs/context';
import { CalculationType, FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import { createSelectOptionCell } from '@/application/database-yjs/fields/select-option/utils';
import { createTextField } from '@/application/database-yjs/fields/text/utils';
import { filterFillData } from '@/application/database-yjs/filter';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaJSON } from '@/application/database-yjs/row_meta';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import dayjs from 'dayjs';
import * as Y from 'yjs';

import {
  YDatabase, YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey, YSharedRoot,
} from '@/application/types';
import { countBy, meanBy, sortBy, sumBy } from 'lodash-es';
import { nanoid } from 'nanoid';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

export function useResizeColumnWidthDispatch () {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const sharedRoot = useSharedRoot();

  return useCallback((fieldId: string, width: number) => {
    executeOperations(sharedRoot, [() => {
      const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
      const fields = database?.get(YjsDatabaseKey.fields);
      const fieldSettings = view?.get(YjsDatabaseKey.field_settings);
      const field = fields?.get(fieldId);
      const fieldSetting = fieldSettings?.get(fieldId);

      if (!field || !fieldSetting) return;

      const currentWidth = fieldSetting.get(YjsDatabaseKey.width);

      if (Number(currentWidth) === width) return;

      fieldSetting.set(YjsDatabaseKey.width, String(width));
    }], 'resizeColumnWidth');

  }, [database, sharedRoot, viewId]);
}

export function useReorderColumnDispatch () {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback((columnId: string, beforeColumnId?: string) => {
    executeOperations(sharedRoot, [() => {
      const fields = view?.get(YjsDatabaseKey.field_orders);

      if (!fields) {
        throw new Error(`Fields order not found`);
      }

      const columnArray = fields.toJSON() as {
        id: string
      }[];

      const originalIndex = columnArray.findIndex(column => column.id === columnId);
      const targetIndex = beforeColumnId === undefined ? 0 : (columnArray.findIndex(column => column.id === beforeColumnId) + 1);

      const column = fields.get(originalIndex);

      let adjustedTargetIndex = targetIndex;

      if (targetIndex > originalIndex) {
        adjustedTargetIndex -= 1;
      }

      fields.delete(originalIndex);

      fields.insert(adjustedTargetIndex, [column]);

    }], 'reorderColumn');
  }, [sharedRoot, view]);
}

export function useReorderGroupColumnDispatch (groupId: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback((columnId: string, beforeColumnId?: string) => {
    executeOperations(sharedRoot, [() => {
      const group = view
        ?.get(YjsDatabaseKey.groups)
        ?.toArray()
        .find((group) => group.get(YjsDatabaseKey.id) === groupId);
      const groupColumns = group?.get(YjsDatabaseKey.groups);

      if (!groupColumns) {
        throw new Error('Group order not found');
      }

      const columnArray = groupColumns.toJSON() as {
        id: string
      }[];

      const originalIndex = columnArray.findIndex(column => column.id === columnId);
      const targetIndex = beforeColumnId === undefined ? 0 : (columnArray.findIndex(column => column.id === beforeColumnId) + 1);

      const column = groupColumns.get(originalIndex);

      let adjustedTargetIndex = targetIndex;

      if (targetIndex > originalIndex) {
        adjustedTargetIndex -= 1;
      }

      groupColumns.delete(originalIndex);

      groupColumns.insert(adjustedTargetIndex, [column]);
    }], 'reorderGroupColumn');

  }, [groupId, sharedRoot, view]);
}

function reorderRow (rowId: string, beforeRowId: string | undefined, view: YDatabaseView) {
  const rows = view.get(YjsDatabaseKey.row_orders);

  if (!rows) {
    throw new Error('Row orders not found');
  }

  const rowArray = rows.toJSON() as {
    id: string;
  }[];

  const sourceIndex = rowArray.findIndex(row => row.id === rowId);
  const targetIndex = beforeRowId !== undefined ? (rowArray.findIndex(row => row.id === beforeRowId) + 1) : 0;

  const row = rows.get(sourceIndex);

  rows.delete(sourceIndex);

  let adjustedTargetIndex = targetIndex;

  if (targetIndex > sourceIndex) {
    adjustedTargetIndex -= 1;
  }

  rows.insert(adjustedTargetIndex, [row]);
}

export function useReorderRowDispatch () {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback((rowId: string, beforeRowId?: string) => {
    executeOperations(sharedRoot, [() => {
      if (!view) {
        throw new Error(`Unable to reorder card`);
      }

      reorderRow(rowId, beforeRowId, view);

    }], 'reorderRow');
  }, [view, sharedRoot]);
}

export function useMoveCardDispatch () {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowDocMap();
  const database = useDatabase();

  return useCallback(({
    rowId,
    beforeRowId,
    fieldId,
    startColumnId,
    finishColumnId,
  }: {
    rowId: string,
    beforeRowId?: string;
    fieldId: string;
    startColumnId: string;
    finishColumnId: string;
  }) => {
    executeOperations(sharedRoot, [() => {
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

      if (!cell) { // if the cell is empty, create a new cell and set data to finishColumnId
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
          const index = selectedIds.findIndex(id => id === startColumnId);

          if (selectedIds.includes(finishColumnId)) { // if the finishColumnId is already in the selectedIds
            selectedIds.splice(index, 1);  // remove the startColumnId from the selectedIds
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

    }], 'reorderCard');
  }, [database, rowMap, sharedRoot, view]);
}

export function useDeleteRowDispatch () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((rowId: string) => {
    executeOperationWithAllViews(sharedRoot, database, (view) => {
      if (!view) {
        throw new Error(`Unable to delete row`);
      }

      const rows = view.get(YjsDatabaseKey.row_orders);

      const rowArray = rows.toJSON() as {
        id: string;
      }[];

      const sourceIndex = rowArray.findIndex(row => row.id === rowId);

      rows.delete(sourceIndex);
    }, 'deleteRowDispatch');
  }, [sharedRoot, database]);
}

export function useCalculateFieldDispatch (fieldId: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback((cells: Map<string, unknown>) => {
    const calculations = view?.get(YjsDatabaseKey.calculations);
    const index = (calculations?.toArray() || []).findIndex((calculation) => {
      return calculation.get(YjsDatabaseKey.field_id) === fieldId;
    });

    if (index === -1 || !calculations) {
      return;
    }

    const countEmptyResult = countBy(Object.values(cells), (data) => {
      if (!data) {
        return CalculationType.CountEmpty;
      } else {
        return CalculationType.CountNonEmpty;
      }
    });

    const itemMap = (data: unknown) => {
      if (typeof data === 'number') {
        return data;
      }

      if (typeof data === 'string') {
        return parseFloat(data);
      }

      return 0;
    };

    const getSum = () => {
      return sumBy(Object.values(cells), itemMap);
    };

    const getAverage = () => {
      return meanBy(Object.values(cells), itemMap);
    };

    const getMedian = () => {
      const array = Object.values(cells).map(itemMap);

      if (!array || array.length === 0) return NaN;

      const sorted = sortBy(array);
      const mid = Math.floor(sorted.length / 2);

      return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const getMin = () => {
      const array = Object.values(cells).map(itemMap);

      if (!array || array.length === 0) return NaN;

      return Math.min(...array);
    };

    const getMax = () => {
      const array = Object.values(cells).map(itemMap);

      if (!array || array.length === 0) return NaN;
      return Math.max(...array);
    };

    const item = calculations.get(index);
    const type = Number(item.get(YjsDatabaseKey.type)) as CalculationType;
    const oldValue = item.get(YjsDatabaseKey.calculation_value) as string | number;

    let newValue = oldValue;

    switch (type) {
      case CalculationType.CountEmpty:
        newValue = countEmptyResult[CalculationType.CountEmpty];
        break;
      case CalculationType.CountNonEmpty:
        newValue = countEmptyResult[CalculationType.CountNonEmpty];
        break;
      case CalculationType.Count:
        newValue = cells.size;
        break;
      case CalculationType.Sum:
        newValue = getSum();
        break;
      case CalculationType.Average:
        newValue = getAverage();
        break;
      case CalculationType.Median:
        newValue = getMedian();
        break;
      case CalculationType.Max:
        newValue = getMax();
        break;
      case CalculationType.Min:
        newValue = getMin();
        break;
      default:
        break;
    }

    if (newValue !== oldValue) {
      executeOperations(sharedRoot, [() => {
        item.set(YjsDatabaseKey.calculation_value, newValue);
      }], 'calculateFieldDispatch');
    }

  }, [fieldId, view, sharedRoot]);
}

export function useUpdatePropertyNameDispatch (fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((name: string) => {
    executeOperations(sharedRoot, [() => {
      const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

      field.set(YjsDatabaseKey.name, name);
    }], 'updatePropertyName');
  }, [database, fieldId, sharedRoot]);
}

function createField (type: FieldType, fieldId: string) {
  switch (type) {
    case FieldType.RichText:
      return createTextField(fieldId);
    default:
      throw new Error(`Field type ${type} not supported`);
  }
}

export function useNewPropertyDispatch () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((fieldType: FieldType) => {
    const fieldId = nanoid(6);

    executeOperationWithAllViews(sharedRoot, database, (view) => {
      const fields = database?.get(YjsDatabaseKey.fields);
      const fieldOrders = view?.get(YjsDatabaseKey.field_orders);

      if (!fields || !fieldOrders) {
        throw new Error(`Field not found`);
      }

      const field: YDatabaseField = createField(fieldType, fieldId);

      fields.set(fieldId, field);

      fieldOrders.push([{
        id: fieldId,
      }]);

    }, 'newPropertyDispatch');

    return fieldId;

  }, [database, sharedRoot]);
}

export function useAddPropertyLeftDispatch () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((fieldId: string) => {
    const newId = nanoid(6);

    executeOperationWithAllViews(sharedRoot, database, (view) => {
      const fields = database?.get(YjsDatabaseKey.fields);
      const fieldOrders = view?.get(YjsDatabaseKey.field_orders);

      if (!fields || !fieldOrders) {
        throw new Error(`Field not found`);
      }

      const field: YDatabaseField = createField(FieldType.RichText, newId);

      fields.set(newId, field);

      const index = fieldOrders.toArray().findIndex((field) => field.id === fieldId);

      if (index !== -1) {
        fieldOrders.insert(index, [{
          id: newId,
        }]);
      }

    }, 'addPropertyLeftDispatch');
    return newId;
  }, [database, sharedRoot]);
}

export function useAddPropertyRightDispatch () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((fieldId: string) => {
    const newId = nanoid(6);

    executeOperationWithAllViews(sharedRoot, database, (view) => {
      const fields = database?.get(YjsDatabaseKey.fields);
      const fieldOrders = view?.get(YjsDatabaseKey.field_orders);

      if (!fields || !fieldOrders) {
        throw new Error(`Field not found`);
      }

      const field: YDatabaseField = createField(FieldType.RichText, newId);

      fields.set(newId, field);

      const index = fieldOrders.toArray().findIndex((field) => field.id === fieldId);

      if (index !== -1) {
        fieldOrders.insert(index + 1, [{
          id: newId,
        }]);
      }
    }, 'addPropertyRightDispatch');
    return newId;
  }, [database, sharedRoot]);
}

function executeOperationWithAllViews (
  sharedRoot: YSharedRoot,
  database: YDatabase,
  operation: (view: YDatabaseView) => void,
  operationName: string,
) {
  const views = database.get(YjsDatabaseKey.views);
  const viewIds = Object.keys(views.toJSON());

  executeOperations(sharedRoot, [() => {
    viewIds.forEach(viewId => {
      const view = database.get(YjsDatabaseKey.views)?.get(viewId);

      if (!view) {
        throw new Error(`View not found`);
      }

      try {
        operation(view);
      } catch (e) {
        // do nothing
      }
    });
  }], operationName);
}

export function useDeletePropertyDispatch () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((fieldId: string) => {
    executeOperationWithAllViews(sharedRoot, database, (view) => {
      const fields = database.get(YjsDatabaseKey.fields);
      const fieldOrders = view.get(YjsDatabaseKey.field_orders);

      if (!fields || !fieldOrders) {
        throw new Error(`Field not found`);
      }

      fields.delete(fieldId);

      const index = fieldOrders.toArray().findIndex((field) => field.id === fieldId);

      if (index !== -1) {
        fieldOrders.delete(index);
      }
    }, 'deletePropertyDispatch');
  }, [database, sharedRoot]);
}

export function useNewRowDispatch () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const createRow = useCreateRow();
  const guid = useDocGuid();
  const view = useDatabaseView();
  const filters = view?.get(YjsDatabaseKey.filters);

  return async (index?: number) => {
    if (!createRow) {
      throw new Error('No createRow function');
    }

    const rowId = uuidv4();

    const rowDoc = await createRow(`${guid}_rows_${rowId}`);

    rowDoc.transact(() => {
      initialDatabaseRow(rowId, database.get(YjsDatabaseKey.id), rowDoc);
      const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const row = rowSharedRoot.get(YjsEditorKey.database_row);

      const cells = row.get(YjsDatabaseKey.cells);

      if (filters) {
        filters.toArray().forEach(filter => {
          const cell = new Y.Map() as YDatabaseCell;
          const fieldId = filter.get(YjsDatabaseKey.field_id);
          const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);
          const data = filterFillData(filter, field);

          if (data === null) {
            return;
          }

          const type = Number(filter.get(YjsDatabaseKey.type));

          cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
          cell.set(YjsDatabaseKey.field_type, type);

          if (data) {
            cell.set(YjsDatabaseKey.data, data);
          }

          cells.set(fieldId, cell);
        });
      }

    });

    executeOperationWithAllViews(sharedRoot, database, view => {
      const rowOrders = view.get(YjsDatabaseKey.row_orders);

      if (!rowOrders) {
        throw new Error(`Row orders not found`);
      }

      const row = {
        id: rowId,
        height: 36,
      };

      console.log('rowOrders', index);

      if (index === undefined) {
        rowOrders.push([row]);
      } else {
        rowOrders.insert(index, [row]);
      }
    }, 'newRowDispatch');

    return rowId;
  };
}

export function useDuplicateRowDispatch () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const createRow = useCreateRow();
  const guid = useDocGuid();
  const rowDocMap = useRowDocMap();

  return async (referenceRowId: string) => {
    const referenceRowDoc = rowDocMap?.[referenceRowId];

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

    const rowDoc = await createRow(`${guid}_rows_${rowId}`);

    rowDoc.transact(() => {
      initialDatabaseRow(rowId, database.get(YjsDatabaseKey.id), rowDoc);

      const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;

      const row = rowSharedRoot.get(YjsEditorKey.database_row);

      const meta = rowSharedRoot.get(YjsEditorKey.meta);

      Object.keys(newMeta).forEach(key => {
        const value = newMeta[key];

        if (value) {
          meta.set(key, value);
        }
      });

      const cells = row.get(YjsDatabaseKey.cells);

      Object.keys(referenceCells.toJSON()).forEach(fieldId => {
        const referenceCell = referenceCells.get(fieldId);
        const cell = new Y.Map() as YDatabaseCell;
        const fieldType = Number(referenceCell.get(YjsDatabaseKey.field_type));
        let data = referenceCell.get(YjsDatabaseKey.data);

        if (data && typeof data === 'bigint') {
          data = String(data);
        }

        cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
        cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
        cell.set(YjsDatabaseKey.field_type, fieldType);
        cell.set(YjsDatabaseKey.data, data);

        cells.set(fieldId, cell);
      });
    });

    executeOperationWithAllViews(sharedRoot, database, view => {
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

      rowOrders.insert(targetIndex, [row]);
    }, 'duplicateRowDispatch');

    return rowId;
  };
}

export function useClearSortingDispatch () {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(() => {
    executeOperations(sharedRoot, [() => {
      const sorting = view?.get(YjsDatabaseKey.sorts);

      if (!sorting) {
        throw new Error(`Sorting not found`);
      }

      sorting.delete(0, sorting.length);
    }], 'clearSortingDispatch');
  }, [sharedRoot, view]);
}