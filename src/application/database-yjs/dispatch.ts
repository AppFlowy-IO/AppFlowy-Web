import {
  useDatabase,
  useDatabaseView,
  useDatabaseViewId,
  useRowDocMap,
  useSharedRoot,
} from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import { createSelectOptionCell } from '@/application/database-yjs/fields/select-option/utils';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import { YDatabaseRow, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

export function useResizeColumnWidthDispatch () {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const sharedRoot = useSharedRoot();

  return (fieldId: string, width: number) => {
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

  };
}

export function useReorderColumnDispatch () {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return (columnId: string, beforeColumnId?: string) => {
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
  };
}

export function useReorderGroupColumnDispatch (groupId: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return (columnId: string, beforeColumnId?: string) => {
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

  };
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

  return (rowId: string, beforeRowId?: string) => {
    executeOperations(sharedRoot, [() => {
      if (!view) {
        throw new Error(`Unable to reorder card`);
      }

      reorderRow(rowId, beforeRowId, view);

    }], 'reorderRow');
  };
}

export function useMoveCardDispatch () {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowDocMap();
  const database = useDatabase();

  return ({
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

      if (!cell) {
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

          selectedIds.splice(index, 1, finishColumnId);
          newCellData = selectedIds.join(',');
        } else if (fieldType === FieldType.Checkbox) {
          newCellData = finishColumnId;
        }

        cell.set(YjsDatabaseKey.data, newCellData);
      }

      reorderRow(rowId, beforeRowId, view);

    }], 'reorderCard');
  };
}