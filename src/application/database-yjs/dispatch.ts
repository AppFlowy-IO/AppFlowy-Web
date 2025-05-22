import { parseYDatabaseDateTimeCellToCell } from '@/application/database-yjs/cell.parse';
import {
  useCreateRow,
  useDatabase,
  useDatabaseContext,
  useDatabaseView,
  useDatabaseViewId,
  useDocGuid,
  useRowDocMap,
  useSharedRoot,
} from '@/application/database-yjs/context';
import { CalculationType, FieldType, FieldVisibility, RowMetaKey } from '@/application/database-yjs/database.type';
import {
  DateFormat,
  getDateCellStr,
  getFieldName,
  isDate,
  NumberFormat,
  safeParseTimestamp,
  SelectOption,
  SelectTypeOption,
  TimeFormat,
} from '@/application/database-yjs/fields';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import EnhancedBigStats from '@/application/database-yjs/fields/number/EnhancedBigStats';
import { createSelectOptionCell, getColorByFirstChar } from '@/application/database-yjs/fields/select-option/utils';
import { createTextField } from '@/application/database-yjs/fields/text/utils';
import { filterFillData } from '@/application/database-yjs/filter';
import { getGroupColumns } from '@/application/database-yjs/group';
import { getOptionsFromRow, initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaIdMap, getMetaJSON } from '@/application/database-yjs/row_meta';
import { useFieldSelector, useFieldType } from '@/application/database-yjs/selector';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';

import {
  DatabaseViewLayout,
  FieldId,
  RowId,
  UpdatePagePayload,
  ViewLayout,
  YDatabase,
  YDatabaseCalculation,
  YDatabaseCalculations,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFieldOrders,
  YDatabaseFieldSetting,
  YDatabaseFieldSettings,
  YDatabaseFieldTypeOption,
  YDatabaseFilters,
  YDatabaseGroup,
  YDatabaseGroupColumns,
  YDatabaseGroups,
  YDatabaseLayoutSettings,
  YDatabaseRow,
  YDatabaseRowOrders,
  YDatabaseSorts,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
  YSharedRoot,
} from '@/application/types';
import dayjs from 'dayjs';
import { countBy } from 'lodash-es';
import { nanoid } from 'nanoid';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';
import { YArray } from 'yjs/dist/src/types/YArray';

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
      let fieldSetting = fieldSettings?.get(fieldId);

      if (!field || !fieldSettings) return;

      if (!fieldSetting) {
        fieldSetting = new Y.Map() as YDatabaseFieldSetting;
        fieldSettings.set(fieldId, fieldSetting);
      }

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
  const fieldType = useFieldType(fieldId);

  return useCallback((cells: Map<string, unknown>) => {
    const calculations = view?.get(YjsDatabaseKey.calculations);
    const index = (calculations?.toArray() || []).findIndex((calculation) => {
      return calculation.get(YjsDatabaseKey.field_id) === fieldId;
    });

    if (index === -1 || !calculations) {
      return;
    }

    const cellValues = Array.from(cells.values());

    const countEmptyResult = countBy(cellValues, (data) => {
      if (fieldType === FieldType.Checkbox) {
        if (data === 'Yes') {
          return CalculationType.CountNonEmpty;
        }

        return CalculationType.CountEmpty;
      }

      if (!data) {
        return CalculationType.CountEmpty;
      } else {
        return CalculationType.CountNonEmpty;
      }
    });

    const itemMap = (data: unknown) => {
      if (typeof data === 'number') {
        return data.toString();
      }

      if (typeof data === 'string') {
        return EnhancedBigStats.parse(data);
      }

      return null;
    };

    const nums = cellValues.map(itemMap).filter(item => !!item) as string[];
    const stats = new EnhancedBigStats(nums);

    const getSum = () => {

      return stats.sum().toString();
    };

    const getAverage = () => {

      return stats.average().toString();
    };

    const getMedian = () => {
      return stats.median().toString();
    };

    const getMin = () => {
      return stats.min().toString();
    };

    const getMax = () => {
      return stats.max().toString();
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
        newValue = countEmptyResult[CalculationType.CountNonEmpty];

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

  }, [view, fieldId, fieldType, sharedRoot]);
}

export function useUpdateCalculate (fieldId: string) {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback((type: CalculationType) => {
    if (!view) return;
    executeOperations(sharedRoot, [() => {
      let calculations = view?.get(YjsDatabaseKey.calculations);

      if (!calculations) {
        calculations = new Y.Array() as YDatabaseCalculations;
        view.set(YjsDatabaseKey.calculations, calculations);
      }

      let item = calculations.toArray().find((calculation) => {
        return calculation.get(YjsDatabaseKey.field_id) === fieldId;
      });

      if (!item) {
        item = new Y.Map() as YDatabaseCalculation;
        item.set(YjsDatabaseKey.id, nanoid(6));
        item.set(YjsDatabaseKey.field_id, fieldId);
        calculations.push([item]);
      }

      item.set(YjsDatabaseKey.type, type);
    }], 'updateCalculate');
  }, [fieldId, sharedRoot, view]);
}

export function useClearCalculate (fieldId: string) {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(() => {
    executeOperations(sharedRoot, [() => {
      const calculations = view?.get(YjsDatabaseKey.calculations);

      if (!calculations) {
        throw new Error(`Calculations not found`);
      }

      const index = calculations.toArray().findIndex((calculation) => {
        return calculation.get(YjsDatabaseKey.field_id) === fieldId;
      });

      if (index !== -1) {
        calculations.delete(index);
      }
    }], 'clearCalculate');
  }, [fieldId, sharedRoot, view]);
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

function cloneCell (fieldType: FieldType, referenceCell?: YDatabaseCell) {
  const cell = new Y.Map() as YDatabaseCell;
  let data = referenceCell?.get(YjsDatabaseKey.data);

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
  if (referenceCell) {
    cell.set(YjsDatabaseKey.data, data);
  }

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

          const field = database.get(YjsDatabaseKey.fields);
          const fieldType = Number(field.get(fieldId)?.get(YjsDatabaseKey.type));

          const cell = cloneCell(fieldType, referenceCell);

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

      if (!fieldSettings) {
        throw new Error(`Field settings not found`);
      }

      let setting = fieldSettings?.get(fieldId);

      if (!setting) {
        setting = new Y.Map() as YDatabaseFieldSetting;

        fieldSettings.set(fieldId, setting);
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

      if (!fieldSettings) {
        throw new Error(`Field settings not found`);
      }

      let setting = fieldSettings.get(fieldId);

      if (!setting) {
        setting = new Y.Map() as YDatabaseFieldSetting;
        fieldSettings.set(fieldId, setting);
      }

      const wrap = setting.get(YjsDatabaseKey.wrap) ?? true;

      if (checked !== undefined) {
        setting.set(YjsDatabaseKey.wrap, checked);
      } else {
        setting.set(YjsDatabaseKey.wrap, !wrap);
      }

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
          return;
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

      if (fieldTypeOption) {
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
      }

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

      const setting = fieldSettings.get(fieldId);

      if (setting) {
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
      }

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
        return;
      }

      rowDoc.transact(() => {
        const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
        const rowData = rowSharedRoot.get(YjsEditorKey.database_row);

        const cells = rowData.get(YjsDatabaseKey.cells);

        const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);
        const fieldType = Number(field.get(YjsDatabaseKey.type));

        const cell = cells.get(fieldId);
        const newCell = cloneCell(fieldType, cell);

        cells.set(newId, newCell);

        if (fieldType !== FieldType.CreatedTime && fieldType !== FieldType.LastEditedTime) {
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

function updateDateCell (cell: YDatabaseCell, payload: {
  data: string;
  endTimestamp?: string;
  includeTime?: boolean;
  isRange?: boolean;
  reminderId?: string;
}) {
  cell.set(YjsDatabaseKey.data, payload.data);

  if (payload.endTimestamp !== undefined) {
    cell.set(YjsDatabaseKey.end_timestamp, payload.endTimestamp);
  }

  if (payload.includeTime !== undefined) {
    console.log('includeTime', payload.includeTime);
    cell.set(YjsDatabaseKey.include_time, payload.includeTime);
  }

  if (payload.isRange !== undefined) {
    cell.set(YjsDatabaseKey.is_range, payload.isRange);
  }

  if (payload.reminderId !== undefined) {
    cell.set(YjsDatabaseKey.reminder_id, payload.reminderId);
  }
}

export function useUpdateCellDispatch (rowId: string, fieldId: string) {
  const rowDocMap = useRowDocMap();
  const { field } = useFieldSelector(fieldId);

  return useCallback((data: string | YArray<string>, dateOpts?: {
    endTimestamp?: string;
    includeTime?: boolean;
    isRange?: boolean;
    reminderId?: string;
  }) => {
    const rowDoc = rowDocMap?.[rowId];

    if (!rowDoc) {
      throw new Error(`Row not found`);
    }

    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const row = rowSharedRoot.get(YjsEditorKey.database_row);
    const cells = row.get(YjsDatabaseKey.cells);
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

  }, [field, fieldId, rowDocMap, rowId]);
}

function generateBoardGroup (database: YDatabase, fieldOrders: YDatabaseFieldOrders) {
  const groups = new Y.Array() as YDatabaseGroups;
  const group = new Y.Map() as YDatabaseGroup;
  const id = `g:${nanoid(6)}`;
  const columns = new Y.Array() as YDatabaseGroupColumns;

  let groupField: YDatabaseField | undefined;

  fieldOrders.toArray().some(({ id }) => {
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

  return groups;
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
    const databaseId = database.get(YjsDatabaseKey.id);

    const newViewId = await createFolderView({
      layout: viewLayout,
      parentViewId: iidIndex,
      name,
      databaseId,
    });

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
      let groups = new Y.Array() as YDatabaseGroups;
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
        groups = generateBoardGroup(database, refFieldOrders);
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
      newView.set(YjsDatabaseKey.is_inline, false);

      views.set(newViewId, newView);
    }], 'addDatabaseView');
    return newViewId;
  }, [createFolderView, database, iidIndex, sharedRoot]);
}

export function useUpdateDatabaseLayout (viewId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((layout: DatabaseViewLayout) => {
    executeOperations(sharedRoot, [() => {
      const view = database.get(YjsDatabaseKey.views)?.get(viewId);

      if (!view) {
        throw new Error(`View not found`);
      }

      if (layout === DatabaseViewLayout.Board) {
        const fieldOrders = view.get(YjsDatabaseKey.field_orders);
        const groups = generateBoardGroup(database, fieldOrders);

        view.set(YjsDatabaseKey.groups, groups);
      }

      if (Number(view.get(YjsDatabaseKey.layout)) === layout) {
        return;
      }

      view.set(YjsDatabaseKey.layout, layout);
    }], 'updateDatabaseLayout');
  }, [database, sharedRoot, viewId]);
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

      const name = payload.name || view.get(YjsDatabaseKey.name);

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

export function useSwitchPropertyType () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowDocMap = useRowDocMap();

  return useCallback((fieldId: string, fieldType: FieldType) => {
    if (!rowDocMap) {
      throw new Error(`Row docs not found`);
    }

    const rows = Object.keys(rowDocMap);

    executeOperations(sharedRoot, [() => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      const oldFieldType = Number(field.get(YjsDatabaseKey.type));

      let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

      // Check if the field type is supported for type options
      if ([FieldType.Number, FieldType.SingleSelect, FieldType.MultiSelect, FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime].includes(fieldType)) {
        // Ensure the type option map is created
        if (!typeOptionMap) {
          typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

          field.set(YjsDatabaseKey.type_option, typeOptionMap);
        }

        const typeOption = typeOptionMap.get(String(fieldType));

        // Check if the type option is created, if not, create it with default values
        // Otherwise, just ignore it
        if (typeOption === undefined || Array.from(typeOption.keys()).length === 0) {
          const newTypeOption = new Y.Map() as YMapFieldTypeOption;

          // Set default values for the type option
          if ([FieldType.CreatedTime, FieldType.LastEditedTime, FieldType.DateTime].includes(fieldType)) {
            newTypeOption.set(YjsDatabaseKey.time_format, TimeFormat.TwentyFourHour);
            newTypeOption.set(YjsDatabaseKey.date_format, DateFormat.Friendly);
          } else if (fieldType === FieldType.Number) {
            newTypeOption.set(YjsDatabaseKey.format, NumberFormat.Num);
          } else if ([FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
            const rows = Object.keys(rowDocMap);
            const options = new Set<string>();

            if (oldFieldType === FieldType.Checkbox) {
              options.add('Yes');
              options.add('No');
            } else if (
              [FieldType.RichText, FieldType.Number, FieldType.URL].includes(oldFieldType)
            ) {
              rows.forEach(rowId => {
                const rowDoc = rowDocMap[rowId];

                if (!rowDoc) {
                  return;
                }

                getOptionsFromRow(rowDoc, fieldId).forEach((option) => {
                  options.add(option);
                });
              });
            }

            const content = JSON.stringify({
              disable_color: false,
              options: Array.from(options).map(name => {
                return {
                  id: name,
                  name,
                  color: getColorByFirstChar(name),
                };
              }),
            });

            newTypeOption.set(YjsDatabaseKey.content, content);
          }

          typeOptionMap.set(String(fieldType), newTypeOption);
        }
      }

      field.set(YjsDatabaseKey.type, fieldType);

      const lastModified = field.get(YjsDatabaseKey.last_modified);

      // Before update-last modified time, check if the field is created
      if (!lastModified) {
        const fieldName = getFieldName(fieldType);

        // Set the default name for the field if it is created
        field.set(YjsDatabaseKey.name, fieldName);
      }

      field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

      rows.forEach((row) => {
        const rowDoc = rowDocMap?.[row];

        if (!rowDoc) {
          return;
        }

        rowDoc.transact(() => {
          const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
          const row = rowSharedRoot.get(YjsEditorKey.database_row);
          const cells = row.get(YjsDatabaseKey.cells);
          const cell = cells.get(fieldId);

          // Update each cell
          if (cell) {
            const data = cell.get(YjsDatabaseKey.data);
            let newData = data;

            // Handle transformation of data based on the new field type
            // 1. to RichText
            if ([FieldType.RichText, FieldType.URL].includes(fieldType)) {
              const cellType = Number(cell.get(YjsDatabaseKey.field_type));
              const typeOption = field.get(YjsDatabaseKey.type_option)?.get(String(cellType));

              switch (cellType) {
                // From Number to RichText, keep the number format value
                case FieldType.Number: {
                  const format = Number(typeOption.get(YjsDatabaseKey.format)) as NumberFormat ?? NumberFormat.Num;

                  newData = EnhancedBigStats.parse(data.toString(), format) || '';
                  break;
                }

                case FieldType.SingleSelect:
                case FieldType.MultiSelect: {
                  const selectedIds = (data as string).split(',');
                  const typeOption = typeOptionMap.get(String(cellType));
                  const content = typeOption.get(YjsDatabaseKey.content);

                  try {
                    const parsedContent = JSON.parse(content) as SelectTypeOption;
                    const options = parsedContent.options;
                    const selectedNames = selectedIds.map((id) => {
                      const option = options.find((opt) => opt.id === id);

                      if (!option) {
                        return '';
                      }

                      return option.name;
                    }).filter((name) => name !== '');

                    newData = selectedNames.join(',');
                  } catch (e) {
                    // do nothing
                  }

                  break;
                }

                case FieldType.DateTime: {
                  const dateCell = parseYDatabaseDateTimeCellToCell(cell);

                  newData = getDateCellStr({
                    cell: dateCell,
                    field,
                  });

                  break;
                }

                default:
                  break;
              }
            }

            if (fieldType === FieldType.Number) {
              const start = (typeof data === 'number' || typeof data === 'string') ? data.toString().split('-')[0] : '';

              if (data && isDate(start)) {
                const date = safeParseTimestamp(start);

                if (date) {
                  newData = date.unix().toString();
                }
              }
            }

            if ([FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
              const typeOption = typeOptionMap.get(String(fieldType));
              const content = typeOption.get(YjsDatabaseKey.content);

              try {
                const parsedContent = JSON.parse(content) as SelectTypeOption;
                const options = parsedContent.options;
                const selectedOptionNames = (data as string).split(',');
                const selectedOptionIds = selectedOptionNames.map((name) => {
                  const option = options.find((opt) => opt.name === name);

                  if (!option) {
                    return '';
                  }

                  return option.id;
                }).filter((id) => id !== '');

                if (fieldType === FieldType.MultiSelect) {
                  newData = selectedOptionIds.join(',');
                } else {
                  newData = selectedOptionIds[0];
                }

              } catch (e) {
                // do nothing
              }
            }

            if (fieldType === FieldType.DateTime) {
              if (data && (typeof data === 'string' || typeof data === 'number')) {
                const start = data.toString().split('-')[0];

                newData = safeParseTimestamp(start).unix();
              }
            }

            cell.set(YjsDatabaseKey.field_type, fieldType);
            cell.set(YjsDatabaseKey.data, newData);
            cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
            row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
          }

        });
      });
    }], 'switchPropertyType');

  }, [database, sharedRoot, rowDocMap]);
}

export function useUpdateNumberTypeOption () {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((fieldId: string, format: NumberFormat) => {
    executeOperations(sharedRoot, [() => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

      if (!typeOptionMap) {
        typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

        field.set(YjsDatabaseKey.type_option, typeOptionMap);
      }

      const typeOption = typeOptionMap.get(String(FieldType.Number));

      if (!typeOption) {
        const newTypeOption = new Y.Map() as YMapFieldTypeOption;

        newTypeOption.set(YjsDatabaseKey.format, format);

        typeOptionMap.set(String(FieldType.Number), newTypeOption);
      } else {
        typeOption.set(YjsDatabaseKey.format, format);
      }

      field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
    }], 'updateNumberTypeOption');
  }, [database, sharedRoot]);
}

export function useAddSelectOption (fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((option: SelectOption) => {
    executeOperations(sharedRoot, [() => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type));

      let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

      if (!typeOptionMap) {
        typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

        field.set(YjsDatabaseKey.type_option, typeOptionMap);
      }

      let typeOption = typeOptionMap.get(String(fieldType));

      if (!typeOption) {
        typeOption = new Y.Map() as YMapFieldTypeOption;

        typeOption.set(YjsDatabaseKey.content, JSON.stringify({
          disable_color: false,
          options: [],
        }));

        typeOptionMap.set(String(fieldType), typeOption);
      }

      const content = typeOption.get(YjsDatabaseKey.content);

      if (!content) {
        throw new Error(`Content not found`);
      }

      const options = JSON.parse(content) as SelectTypeOption;
      const newOptions = [...options.options];

      // Check if the option already exists
      if (newOptions.some((opt) => opt.name === option.name)) {
        return;
      }

      newOptions.push(option);
      typeOption.set(YjsDatabaseKey.content, JSON.stringify({
        ...options,
        options: newOptions,
      }));

    }], 'addSelectOption');
  }, [database, fieldId, sharedRoot]);
}

export function useReorderSelectFieldOptions (fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

  if (!field) {
    throw new Error(`Field not found`);
  }

  return useCallback((optionId: string, beforeId?: string) => {
    executeOperations(sharedRoot, [() => {
      const fieldType = Number(field.get(YjsDatabaseKey.type));

      let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

      if (!typeOptionMap) {
        typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

        field.set(YjsDatabaseKey.type_option, typeOptionMap);
      }

      let typeOption = typeOptionMap.get(String(fieldType));

      if (!typeOption) {
        typeOption = new Y.Map() as YMapFieldTypeOption;

        typeOption.set(YjsDatabaseKey.content, JSON.stringify({
          disable_color: false,
          options: [],
        }));

        typeOptionMap.set(String(fieldType), typeOption);
      }

      let content = typeOption.get(YjsDatabaseKey.content);

      if (!content) {
        content = JSON.stringify({
          disable_color: false,
          options: [],
        });
      }

      const data = JSON.parse(content) as SelectTypeOption;

      const options = data.options;

      const index = options.findIndex((opt) => opt.id === optionId);
      const option = options[index];

      if (index === -1) {
        return;
      }

      const newOptions = [...options];
      const beforeIndex = newOptions.findIndex((opt) => opt.id === beforeId);

      if (beforeIndex === index) {
        return;
      }

      newOptions.splice(index, 1);

      if (beforeId === undefined || beforeIndex === -1) {
        newOptions.unshift(option);
      } else {
        const targetIndex = beforeIndex > index ? beforeIndex - 1 : beforeIndex;

        newOptions.splice(targetIndex + 1, 0, option);
      }

      typeOption.set(YjsDatabaseKey.content, JSON.stringify({
        ...data,
        options: newOptions,
      }));
    }], 'updateSelectOptions');
  }, [field, sharedRoot]);
}

export function useDeleteSelectOption (fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((optionId: string) => {
    executeOperations(sharedRoot, [() => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type));

      let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

      if (!typeOptionMap) {
        typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

        field.set(YjsDatabaseKey.type_option, typeOptionMap);
      }

      let typeOption = typeOptionMap.get(String(fieldType));

      if (!typeOption) {
        typeOption = new Y.Map() as YMapFieldTypeOption;

        typeOption.set(YjsDatabaseKey.content, JSON.stringify({
          disable_color: false,
          options: [],
        }));

        typeOptionMap.set(String(fieldType), typeOption);
      }

      const content = typeOption.get(YjsDatabaseKey.content);

      if (!content) {
        throw new Error(`Content not found`);
      }

      const options = JSON.parse(content) as SelectTypeOption;
      const newOptions = options.options.filter((opt) => opt.id !== optionId);

      typeOption.set(YjsDatabaseKey.content, JSON.stringify({
        ...options,
        options: newOptions,
      }));
    }], 'deleteSelectOption');
  }, [database, fieldId, sharedRoot]);
}

export function useUpdateSelectOption (fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((optionId: string, option: SelectOption) => {
    executeOperations(sharedRoot, [() => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type));

      let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

      if (!typeOptionMap) {
        typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

        field.set(YjsDatabaseKey.type_option, typeOptionMap);
      }

      let typeOption = typeOptionMap.get(String(fieldType));

      if (!typeOption) {
        typeOption = new Y.Map() as YMapFieldTypeOption;

        typeOption.set(YjsDatabaseKey.content, JSON.stringify({
          disable_color: false,
          options: [],
        }));

        typeOptionMap.set(String(fieldType), typeOption);
      }

      const content = typeOption.get(YjsDatabaseKey.content);

      if (!content) {
        throw new Error(`Content not found`);
      }

      const options = JSON.parse(content) as SelectTypeOption;

      const newOptions = options.options.map((opt) => {
        if (opt.id === optionId) {
          return option;
        }

        return opt;
      });

      typeOption.set(YjsDatabaseKey.content, JSON.stringify({
        ...options,
        options: newOptions,
      }));
    }], 'updateSelectOption');
  }, [database, fieldId, sharedRoot]);
}

export function useUpdateDateTimeFieldFormat (fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(({
    dateFormat,
    timeFormat,
    includeTime,
  }: {
    dateFormat?: DateFormat;
    timeFormat?: TimeFormat;
    includeTime?: boolean;
  }) => {
    executeOperations(sharedRoot, [() => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

      if (!typeOptionMap) {
        typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

        field.set(YjsDatabaseKey.type_option, typeOptionMap);
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type));

      let typeOption = typeOptionMap.get(String(fieldType));

      if (!typeOption) {
        typeOption = new Y.Map() as YMapFieldTypeOption;
        typeOptionMap.set(String(FieldType.DateTime), typeOption);
      }

      if (dateFormat !== undefined) {
        typeOption.set(YjsDatabaseKey.date_format, dateFormat);
      }

      if (timeFormat !== undefined) {
        typeOption.set(YjsDatabaseKey.time_format, timeFormat);
      }

      if (includeTime !== undefined) {
        typeOption.set(YjsDatabaseKey.include_time, includeTime);
      }
    }], 'updateDateTimeFieldFormat');
  }, [database, fieldId, sharedRoot]);
}

export function useUpdateRelationDatabaseId (fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback((databaseId: string) => {
    executeOperations(sharedRoot, [() => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

      if (!typeOptionMap) {
        typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

        field.set(YjsDatabaseKey.type_option, typeOptionMap);
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type));

      let typeOption = typeOptionMap.get(String(fieldType));

      if (!typeOption) {
        typeOption = new Y.Map() as YMapFieldTypeOption;
        typeOptionMap.set(String(fieldType), typeOption);
      }

      typeOption.set(YjsDatabaseKey.database_id, databaseId);

      field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

    }], 'updateRelationDatabaseId');
  }, [database, fieldId, sharedRoot]);
}
