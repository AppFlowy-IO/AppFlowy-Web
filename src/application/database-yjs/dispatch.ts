import {
  useCreateRow,
  useDatabase, useDatabaseContext,
  useDatabaseView,
  useDatabaseViewId, useDocGuid,
  useRowDocMap,
  useSharedRoot,
} from '@/application/database-yjs/context';
import { CalculationType, FieldType, FieldVisibility, RowMetaKey } from '@/application/database-yjs/database.type';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import { createSelectOptionCell } from '@/application/database-yjs/fields/select-option/utils';
import { createTextField } from '@/application/database-yjs/fields/text/utils';
import { filterFillData } from '@/application/database-yjs/filter';
import { getGroupColumns } from '@/application/database-yjs/group';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaJSON, getMetaIdMap } from '@/application/database-yjs/row_meta';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import dayjs from 'dayjs';
import * as Y from 'yjs';

import {
  DatabaseViewLayout,
  FieldId,
  RowId, UpdatePagePayload,
  ViewLayout,
  YDatabase, YDatabaseCalculations,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFieldOrders,
  YDatabaseFieldSetting,
  YDatabaseFieldSettings,
  YDatabaseFieldTypeOption, YDatabaseFilters, YDatabaseGroup, YDatabaseGroupColumns, YDatabaseGroups,
  YDatabaseLayoutSettings,
  YDatabaseRow,
  YDatabaseRowOrders, YDatabaseSorts,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
  YSharedRoot,
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
  operation: (view: YDatabaseView, viewId: string) => void,
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
        operation(view, viewId);
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
  const viewId = useDatabaseViewId();
  const currentView = useDatabaseView();
  const filters = currentView?.get(YjsDatabaseKey.filters);

  return async (index?: number, cellsData?: Record<FieldId, string>) => {
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

          const type = Number(field.get(YjsDatabaseKey.type));

          cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
          cell.set(YjsDatabaseKey.field_type, type);

          if (data) {
            cell.set(YjsDatabaseKey.data, data);
          }

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

          cell.set(YjsDatabaseKey.data, data);

          cells.set(fieldId, cell);
        });
      }

      row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    });

    executeOperationWithAllViews(sharedRoot, database, (view, id) => {
      const rowOrders = view.get(YjsDatabaseKey.row_orders);

      if (!rowOrders) {
        throw new Error(`Row orders not found`);
      }

      const row = {
        id: rowId,
        height: 36,
      };

      if (index === undefined || index >= rowOrders.length || viewId !== id) {
        rowOrders.push([row]);
      } else {
        rowOrders.insert(index, [row]);
      }
    }, 'newRowDispatch');

    return rowId;
  };
}

function cloneCell (fieldId: string, referenceCell: YDatabaseCell) {
  const cell = new Y.Map() as YDatabaseCell;
  const fieldType = Number(referenceCell.get(YjsDatabaseKey.field_type));
  let data = referenceCell.get(YjsDatabaseKey.data);

  if (fieldType === FieldType.Relation && data) {
    const newData = new Y.Array<RowId>();
    const referenceData = data as Y.Array<RowId>;

    referenceData.toArray().forEach((rowId) => {
      newData.push([rowId]);
    });
    data = newData;
  }

  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
  cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
  cell.set(YjsDatabaseKey.field_type, fieldType);
  cell.set(YjsDatabaseKey.data, data);
  return cell;
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
        try {
          const referenceCell = referenceCells.get(fieldId);

          if (!referenceCell) {
            throw new Error(`Cell not found`);
          }

          const cell = cloneCell(fieldId, referenceCell);

          cells.set(fieldId, cell);
        } catch (e) {
          console.error(e);
        }
      });

      row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
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

      if (targetIndex >= rowOrders.length) {
        rowOrders.push([row]);
        return;
      }

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

export function useUpdatePropertyIconDispatch (fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((iconId: string) => {
    executeOperations(sharedRoot, [() => {
      const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

      field.set(YjsDatabaseKey.icon, iconId);
    }], 'updatePropertyName');
  }, [database, sharedRoot, fieldId]);
}

export function useHidePropertyDispatch () {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback((fieldId: string) => {
    executeOperations(sharedRoot, [() => {
      const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

      const setting = fieldSettings?.get(fieldId);

      if (!setting) {
        throw new Error(`Field not found`);
      }

      setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysHidden);
    }], 'hidePropertyDispatch');
  }, [sharedRoot, view]);
}

export function useTogglePropertyWrapDispatch () {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback((fieldId: string, checked?: boolean) => {
    executeOperations(sharedRoot, [() => {
      const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

      const setting = fieldSettings?.get(fieldId);

      if (!setting) {
        throw new Error(`Field not found`);
      }

      const wrap = setting.get(YjsDatabaseKey.wrap);

      if (checked !== undefined) {
        setting.set(YjsDatabaseKey.wrap, checked);
        return;
      }

      setting.set(YjsDatabaseKey.wrap, !wrap);
    }], 'togglePropertyWrapDispatch');
  }, [sharedRoot, view]);
}

export function useShowPropertyDispatch () {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback((fieldId: string) => {
    executeOperations(sharedRoot, [() => {
      const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

      const setting = fieldSettings?.get(fieldId);

      if (!setting) {
        throw new Error(`Field not found`);
      }

      setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
    }], 'showPropertyDispatch');
  }, [sharedRoot, view]);
}

export function useClearCellsWithFieldDispatch () {
  const sharedRoot = useSharedRoot();
  const rowDocs = useRowDocMap();

  return useCallback((fieldId: string) => {
    executeOperations(sharedRoot, [() => {
      if (!rowDocs) {
        throw new Error(`Row docs not found`);
      }

      const rows = Object.keys(rowDocs);

      if (!rows) {
        throw new Error(`Row orders not found`);
      }

      rows.forEach((rowId) => {
        const rowDoc = rowDocs?.[rowId];

        if (!rowDoc) {
          throw new Error(`Row not found`);
        }

        rowDoc.transact(() => {
          const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
          const row = rowSharedRoot.get(YjsEditorKey.database_row);
          const cells = row.get(YjsDatabaseKey.cells);

          cells.delete(fieldId);
          row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
        });

      });
    }], 'clearCellsWithFieldDispatch');
  }, [rowDocs, sharedRoot]);
}

export function useDuplicatePropertyDispatch () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowDocs = useRowDocMap();

  return useCallback((fieldId: string) => {
    const newId = nanoid(6);

    executeOperations(sharedRoot, [() => {
      const fields = database?.get(YjsDatabaseKey.fields);

      if (!fields) {
        throw new Error(`Fields not found`);
      }

      const field = fields.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      // Clone Field
      const newField = new Y.Map() as YDatabaseField;

      newField.set(YjsDatabaseKey.id, newId);
      newField.set(YjsDatabaseKey.name, field.get(YjsDatabaseKey.name) + ' (copy)');
      newField.set(YjsDatabaseKey.type, Number(field.get(YjsDatabaseKey.type)));
      newField.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
      newField.set(YjsDatabaseKey.is_primary, false);
      newField.set(YjsDatabaseKey.icon, field.get(YjsDatabaseKey.icon));
      const fieldTypeOption = field.get(YjsDatabaseKey.type_option);
      const newFieldTypeOption = new Y.Map() as YDatabaseFieldTypeOption;

      Object.keys(fieldTypeOption.toJSON()).forEach((key) => {
        const value = fieldTypeOption.get(key);

        const newValue = new Y.Map() as YMapFieldTypeOption;

        Object.keys(value.toJSON()).forEach(key => {
          // eslint-disable-next-line
          // @ts-ignore
          const option = value.get(key);

          newValue.set(key, option);
        });
        newFieldTypeOption.set(key, newValue);
      });
      newField.set(YjsDatabaseKey.type_option, newFieldTypeOption);

      fields.set(newId, newField);

    }], 'duplicatePropertyDispatch');

    // Insert new field to all views
    executeOperationWithAllViews(sharedRoot, database, (view) => {
      const fields = database?.get(YjsDatabaseKey.fields);
      const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
      const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

      if (!fields || !fieldOrders || !fieldSettings) {
        throw new Error(`Fields not found`);
      }

      const field = fields.get(newId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      const setting = fieldSettings?.get(fieldId);
      const newSetting = new Y.Map() as YDatabaseFieldSetting;

      Object.keys(setting.toJSON()).forEach((key) => {
        // eslint-disable-next-line
        // @ts-ignore
        const value = setting.get(key);

        if (key === YjsDatabaseKey.visibility) {
          newSetting.set(key, FieldVisibility.AlwaysShown);
          return;
        }

        newSetting.set(key, value);
      });

      fieldSettings.set(newId, newSetting);

      const index = fieldOrders.toArray().findIndex((field) => field.id === fieldId);

      fieldOrders.insert(index + 1, [{
        id: newId,
      }]);

    }, 'insertDuplicateProperty');

    if (!rowDocs) {
      throw new Error(`Row docs not found`);
    }

    const rows = Object.keys(rowDocs);

    if (!rows) {
      throw new Error(`Row orders not found`);
    }

    // Clone cell for each row
    rows.forEach((rowId) => {
      const rowDoc = rowDocs?.[rowId];

      if (!rowDoc) {
        throw new Error(`Row not found`);
      }

      rowDoc.transact(() => {
        const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
        const rowData = rowSharedRoot.get(YjsEditorKey.database_row);

        const cells = rowData.get(YjsDatabaseKey.cells);
        const cell = cells.get(fieldId);
        const newCell = cloneCell(fieldId, cell);

        cells.set(newId, newCell);

        const type = Number(cell.get(YjsDatabaseKey.field_type));

        if (type !== FieldType.CreatedTime && type !== FieldType.LastEditedTime) {
          rowData.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
        }
      });

    });

    return newId;
  }, [database, rowDocs, sharedRoot]);
}

export function useUpdateRowMetaDispatch (rowId: string) {
  const rowDocMap = useRowDocMap();

  const rowDoc = rowDocMap?.[rowId];

  return useCallback((key: RowMetaKey, value?: string) => {
    if (!rowDoc) {
      throw new Error(`Row not found`);
    }

    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const row = rowSharedRoot.get(YjsEditorKey.database_row);
    const meta = rowSharedRoot.get(YjsEditorKey.meta);

    const keyId = getMetaIdMap(rowId).get(key);

    if (!keyId) {
      throw new Error(`Meta key not found: ${key}`);
    }

    rowDoc.transact(() => {
      if (value === undefined) {
        meta.delete(keyId);
      } else {
        meta.set(keyId, value);
      }

      row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    });

  }, [rowDoc, rowId]);
}

export function useUpdateCellDispatch (rowId: string, fieldId: string) {
  const rowDocMap = useRowDocMap();
  const { field } = useFieldSelector(fieldId);

  return useCallback((data: string) => {
    const rowDoc = rowDocMap?.[rowId];

    if (!rowDoc) {
      throw new Error(`Row not found`);
    }

    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const row = rowSharedRoot.get(YjsEditorKey.database_row);
    const cells = row.get(YjsDatabaseKey.cells);
    const cell = cells.get(fieldId);

    if (cell?.get(YjsDatabaseKey.data) === data) return;

    rowDoc.transact(() => {
      if (!cell) {
        const newCell = new Y.Map() as YDatabaseCell;
        const type = Number(field.get(YjsDatabaseKey.type));

        newCell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
        newCell.set(YjsDatabaseKey.field_type, type);
        newCell.set(YjsDatabaseKey.data, data);
        cells.set(fieldId, newCell);
      } else {
        cell.set(YjsDatabaseKey.data, data);
      }

      row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    });

  }, [field, fieldId, rowDocMap, rowId]);
}

export function useAddDatabaseView () {
  const {
    iidIndex,
    createFolderView,
  } = useDatabaseContext();
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(async (layout: DatabaseViewLayout) => {
    if (!createFolderView) {
      throw new Error('createFolderView not found');
    }

    const viewLayout = {
      [DatabaseViewLayout.Grid]: ViewLayout.Grid,
      [DatabaseViewLayout.Board]: ViewLayout.Board,
      [DatabaseViewLayout.Calendar]: ViewLayout.Calendar,
    }[layout] as ViewLayout;
    const name = {
      [DatabaseViewLayout.Grid]: 'Grid',
      [DatabaseViewLayout.Board]: 'Board',
      [DatabaseViewLayout.Calendar]: 'Calendar',
    }[layout];

    const newViewId = await createFolderView({
      layout: viewLayout,
      parentViewId: iidIndex,
      name,
    });

    const databaseId = database.get(YjsDatabaseKey.id);
    const views = database.get(YjsDatabaseKey.views);
    const refView = database.get(YjsDatabaseKey.views)?.get(iidIndex);
    const refRowOrders = refView.get(YjsDatabaseKey.row_orders);
    const refFieldOrders = refView.get(YjsDatabaseKey.field_orders);

    executeOperations(sharedRoot, [() => {
      const newView = new Y.Map() as YDatabaseView;
      const rowOrders = new Y.Array() as YDatabaseRowOrders;
      const fieldOrders = new Y.Array() as YDatabaseFieldOrders;
      const fieldSettings = new Y.Map() as YDatabaseFieldSettings;
      const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
      const filters = new Y.Array() as YDatabaseFilters;
      const sorts = new Y.Array() as YDatabaseSorts;
      const groups = new Y.Array() as YDatabaseGroups;
      const calculations = new Y.Array() as YDatabaseCalculations;

      refRowOrders.forEach(rowOrder => {
        const newRowOrder = {
          ...rowOrder,
        };

        rowOrders.push([newRowOrder]);
      });

      refFieldOrders.forEach(fieldOrder => {
        const newFieldOrder = {
          ...fieldOrder,
        };

        fieldOrders.push([newFieldOrder]);
      });

      if (layout === DatabaseViewLayout.Board) {
        const group = new Y.Map() as YDatabaseGroup;
        const id = `g:${nanoid(6)}`;
        const columns = new Y.Array() as YDatabaseGroupColumns;

        let groupField: YDatabaseField | undefined;

        refFieldOrders.toArray().some(({ id }) => {
          const field = database.get(YjsDatabaseKey.fields)?.get(id);

          if (!field) {
            return;
          }

          const type = Number(field.get(YjsDatabaseKey.type));

          if ([FieldType.SingleSelect, FieldType.MultiSelect, FieldType.Checkbox].includes(type)) {
            groupField = field;
            return true;
          }

          return false;
        });

        if (groupField) {
          group.set(YjsDatabaseKey.id, id);
          group.set(YjsDatabaseKey.content, '');
          group.set(YjsDatabaseKey.field_id, groupField.get(YjsDatabaseKey.id));
          const groupColumns = getGroupColumns(groupField) || [];

          groupColumns.forEach((column) => {
            columns.push([{
              id: column.id,
              visible: true,
            }]);
          });

          group.set(YjsDatabaseKey.groups, columns);
          groups.push([group]);
        }
      }

      newView.set(YjsDatabaseKey.database_id, databaseId);
      newView.set(YjsDatabaseKey.name, name);
      newView.set(YjsDatabaseKey.layout, layout);
      newView.set(YjsDatabaseKey.row_orders, rowOrders);
      newView.set(YjsDatabaseKey.field_orders, fieldOrders);
      newView.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
      newView.set(YjsDatabaseKey.modified_at, String(dayjs().unix()));
      newView.set(YjsDatabaseKey.field_settings, fieldSettings);
      newView.set(YjsDatabaseKey.layout_settings, layoutSettings);
      newView.set(YjsDatabaseKey.filters, filters);
      newView.set(YjsDatabaseKey.sorts, sorts);
      newView.set(YjsDatabaseKey.groups, groups);
      newView.set(YjsDatabaseKey.calculations, calculations);

      views.set(newViewId, newView);
    }], 'addDatabaseView');
    return newViewId;
  }, [createFolderView, database, iidIndex, sharedRoot]);
}

export function useUpdateDatabaseView () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const {
    updatePage,
  } = useDatabaseContext();

  return useCallback(async (viewId: string, payload: UpdatePagePayload) => {

    await updatePage?.(viewId, payload);

    executeOperations(sharedRoot, [() => {
      const view = database.get(YjsDatabaseKey.views)?.get(viewId);

      if (!view) {
        throw new Error(`View not found`);
      }

      view.set(YjsDatabaseKey.name, name);
    }], 'renameDatabaseView');
  }, [database, updatePage, sharedRoot]);
}

export function useDeleteView () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const {
    deletePage,
  } = useDatabaseContext();

  return useCallback(async (viewId: string) => {
    await deletePage?.(viewId);

    executeOperations(sharedRoot, [() => {
      const view = database.get(YjsDatabaseKey.views)?.get(viewId);

      if (!view) {
        throw new Error(`View not found`);
      }

      database.get(YjsDatabaseKey.views)?.delete(viewId);
    }], 'deleteView');
  }, [database, deletePage, sharedRoot]);
}