import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import { useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { calculateFieldValue } from '@/application/database-yjs/calculation';
import {
  useCreateRow,
  useDatabase,
  useDatabaseContext,
  useDatabaseFields,
  useDatabaseView,
  useDatabaseViewId,
  useDefaultTimeSetting,
  useDocGuid,
  useRowDocMap,
  useSharedRoot,
} from '@/application/database-yjs/context';
import {
  AITranslateLanguage,
  CalculationType,
  CalendarLayout,
  CalendarLayoutSetting,
  DateGroupCondition,
  FieldType,
  FieldVisibility,
  FilterType,
  RowMetaKey,
  RollupDisplayMode,
  SortCondition,
} from '@/application/database-yjs/database.type';
import { getFieldName, NumberFormat, parseSelectOptionTypeOptions, SelectOption, SelectOptionColor, SelectTypeOption } from '@/application/database-yjs/fields';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { createSelectOptionCell } from '@/application/database-yjs/fields/select-option/utils';
import { createDateTimeField } from '@/application/database-yjs/fields/text/utils';
import { dateFilterFillData, filterFillData, getDefaultFilterCondition } from '@/application/database-yjs/filter';
import { getOptionsFromRow, initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaIdMap, getMetaJSON, getRowKey } from '@/application/database-yjs/row_meta';
import { useBoardLayoutSettings, useCalendarLayoutSetting, useDatabaseViewLayout, useFieldSelector, useFieldType } from '@/application/database-yjs/selector';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import {
  DatabaseViewLayout,
  DateFormat,
  FieldId,
  RowId,
  TimeFormat,
  UpdatePagePayload,
  View,
  ViewLayout,
  YDatabase,
  YDatabaseBoardLayoutSetting,
  YDatabaseCalculation,
  YDatabaseCalculations,
  YDatabaseCalendarLayoutSetting,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFieldOrders,
  YDatabaseFieldSetting,
  YDatabaseFieldSettings,
  YDatabaseFieldTypeOption,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseGroup,
  YDatabaseGroupColumns,
  YDatabaseGroups,
  YDatabaseLayoutSettings,
  YDatabaseRow,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
  YSharedRoot,
} from '@/application/types';
import { DefaultTimeSetting } from '@/application/user-metadata';
import { isDatabaseContainer } from '@/application/view-utils';
import { applyYDoc } from '@/application/ydoc/apply';
import { Log } from '@/utils/log';

export function useResizeColumnWidthDispatch() {
  const database = useDatabase();
  const viewId = useDatabaseViewId();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldId: string, width: number) => {
      executeOperations(
        sharedRoot,
        [
          () => {
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
          },
        ],
        'resizeColumnWidth'
      );
    },
    [database, sharedRoot, viewId]
  );
}

export function useReorderColumnDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (columnId: string, beforeColumnId?: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const fields = view?.get(YjsDatabaseKey.field_orders);

            if (!fields) {
              throw new Error(`Fields order not found`);
            }

            const columnArray = fields.toJSON() as {
              id: string;
            }[];

            const originalIndex = columnArray.findIndex((column) => column.id === columnId);
            const targetIndex =
              beforeColumnId === undefined ? 0 : columnArray.findIndex((column) => column.id === beforeColumnId) + 1;

            const column = fields.get(originalIndex);

            let adjustedTargetIndex = targetIndex;

            if (targetIndex > originalIndex) {
              adjustedTargetIndex -= 1;
            }

            fields.delete(originalIndex);

            fields.insert(adjustedTargetIndex, [column]);
          },
        ],
        'reorderColumn'
      );
    },
    [sharedRoot, view]
  );
}

function generateGroupByField(field: YDatabaseField) {
  const group = new Y.Map() as YDatabaseGroup;

  const fieldId = field.get(YjsDatabaseKey.id);
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  const columns = new Y.Array() as YDatabaseGroupColumns;

  group.set(YjsDatabaseKey.field_id, fieldId);
  group.set(YjsDatabaseKey.id, `g:${nanoid(6)}`);

  switch (fieldType) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      group.set(YjsDatabaseKey.content, '');
      const typeOption = parseSelectOptionTypeOptions(field);
      const options = (typeOption?.options || []).filter((option) => Boolean(option && option.id));

      columns.push([{ id: fieldId, visible: true }]);

      // Add a column for each option
      options.forEach((option) => {
        const optionId = option?.id;

        if (!optionId) {
          return;
        }

        columns.push([{ id: optionId, visible: true }]);
      });
      break;
    }

    case FieldType.Checkbox:
      group.set(YjsDatabaseKey.content, '');
      // Add a column for the checkbox field
      columns.push([{ id: 'Yes', visible: true }]);
      columns.push([{ id: 'No', visible: true }]);
      break;
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      group.set(
        YjsDatabaseKey.content,
        JSON.stringify({
          hide_empty: false,
          condition: DateGroupCondition.Relative,
        })
      );

      columns.push([{ id: fieldId, visible: true }]);
      break;
    default:
      break;
  }

  group.set(YjsDatabaseKey.groups, columns);

  return group;
}

export function useGroupByFieldDispatch() {
  const view = useDatabaseView();
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const { fieldId: currentFieldId } = useBoardLayoutSettings();

  return useCallback(
    (fieldId: string) => {
      if (!view) {
        throw new Error('View not found');
      }

      if (currentFieldId && currentFieldId === fieldId) {
        // If the field is already grouped, do nothing
        return;
      }

      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field with id ${fieldId} not found`);
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            // Remove the filter for the field if it will be grouped
            const filters = view.get(YjsDatabaseKey.filters);
            const filterIndex = filters
              ?.toArray()
              .findIndex((filter) => filter.get(YjsDatabaseKey.field_id) === fieldId);

            if (filters && filterIndex > -1) {
              filters?.delete(filterIndex);
            }

            let groups = view.get(YjsDatabaseKey.groups);

            if (!groups) {
              groups = new Y.Array() as YDatabaseGroups;
              view.set(YjsDatabaseKey.groups, groups);
            }

            const group = generateGroupByField(field);

            // Only one group can exist at a time, so we clear the existing groups
            groups.delete(0, groups.length);
            groups.insert(0, [group]);
          },
        ],
        'groupByField'
      );
    },
    [currentFieldId, database, sharedRoot, view]
  );
}

export function useReorderGroupColumnDispatch(groupId: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (columnId: string, beforeColumnId?: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const group = view
              ?.get(YjsDatabaseKey.groups)
              ?.toArray()
              .find((group) => group.get(YjsDatabaseKey.id) === groupId);
            const groupColumns = group?.get(YjsDatabaseKey.groups);

            if (!groupColumns) {
              throw new Error('Group order not found');
            }

            const columnArray = groupColumns.toJSON() as {
              id: string;
            }[];

            const originalIndex = columnArray.findIndex((column) => column.id === columnId);
            const targetIndex =
              beforeColumnId === undefined ? 0 : columnArray.findIndex((column) => column.id === beforeColumnId) + 1;

            const column = groupColumns.get(originalIndex);

            let adjustedTargetIndex = targetIndex;

            if (targetIndex > originalIndex) {
              adjustedTargetIndex -= 1;
            }

            groupColumns.delete(originalIndex);

            groupColumns.insert(adjustedTargetIndex, [column]);
          },
        ],
        'reorderGroupColumn'
      );
    },
    [groupId, sharedRoot, view]
  );
}

export function useDeleteGroupColumnDispatch(groupId: string, columnId: string, fieldId: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const deleteRows = useBulkDeleteRowDispatch();
  const deleteSelectOption = useDeleteSelectOption(fieldId);
  const fieldType = useFieldType(fieldId);
  const deleteGroupColumn = useCallback(() => {
    executeOperations(
      sharedRoot,
      [
        () => {
          const groups = view?.get(YjsDatabaseKey.groups);

          if (!groups) {
            throw new Error('Groups not found');
          }

          const group = groups.toArray().find((group) => group.get(YjsDatabaseKey.id) === groupId);

          const columns = group?.get(YjsDatabaseKey.groups) as YDatabaseGroupColumns;

          if (!columns) {
            throw new Error('Group columns not found');
          }

          const columnArray = columns.toJSON() as {
            id: string;
          }[];

          const index = columnArray.findIndex((column) => column.id === columnId);

          if (index === -1) {
            throw new Error(`Column with id ${columnId} not found in group ${groupId}`);
          }

          columns.delete(index);
        },
      ],
      'deleteGroupColumn'
    );
  }, [groupId, columnId, sharedRoot, view]);

  const isSelectField = useMemo(() => {
    return [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);
  }, [fieldType]);

  return useCallback(
    (rowIds?: string[]) => {
      if (isSelectField) {
        // Delete the group column
        deleteGroupColumn();

        // Delete the select option if it exists
        deleteSelectOption(columnId);
      }

      // If rowIds are provided, delete the rows
      if (rowIds && rowIds.length > 0) {
        deleteRows(rowIds);
      }
    },
    [isSelectField, deleteGroupColumn, deleteSelectOption, columnId, deleteRows]
  );
}

export function useToggleHiddenGroupColumnDispatch(groupId: string, fieldId: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const layoutSetting = view?.get(YjsDatabaseKey.layout_settings)?.get('1');

  return useCallback(
    (columnId: string, hidden: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const groups = view?.get(YjsDatabaseKey.groups);

            if (!groups) {
              throw new Error('Groups not found');
            }

            const group = groups.toArray().find((group) => group.get(YjsDatabaseKey.id) === groupId);

            if (!group) {
              throw new Error(`Group with id ${groupId} not found`);
            }

            const columns = group.get(YjsDatabaseKey.groups);

            if (!columns) {
              throw new Error('Group columns not found');
            }

            const index = columns.toArray().findIndex((column) => column.id === columnId);
            const column = columns.toArray().find((column) => column.id === columnId);

            if (index === -1 || !column) {
              throw new Error(`Column with id ${columnId} not found in group ${groupId}`);
            }

            const newColumn = {
              ...column,
              visible: !hidden,
            };

            columns.delete(index);

            columns.insert(index, [newColumn]);

            if (column.id === fieldId && layoutSetting) {
              layoutSetting.set(YjsDatabaseKey.hide_ungrouped_column, hidden);
            }
          },
        ],
        'hideGroupColumn'
      );
    },
    [fieldId, groupId, layoutSetting, sharedRoot, view]
  );
}

export function useToggleCollapsedHiddenGroupColumnDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (collapsed: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error(`Unable to toggle collapsed hidden group column`);
            }

            // Get or create the layout settings for the view
            let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

            if (!layoutSettings) {
              layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
            }

            let layoutSetting = layoutSettings.get('1');

            if (!layoutSetting) {
              layoutSetting = new Y.Map() as YDatabaseBoardLayoutSetting;
              layoutSettings.set('1', layoutSetting);
            }

            layoutSetting.set(YjsDatabaseKey.collapse_hidden_groups, collapsed);
          },
        ],
        'toggleCollapsedHiddenGroupColumn'
      );
    },
    [sharedRoot, view]
  );
}

export function useToggleHideUnGrouped() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (hide: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error(`Unable to toggle hide ungrouped column`);
            }

            // Get or create the layout settings for the view
            let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

            if (!layoutSettings) {
              layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
            }

            let layoutSetting = layoutSettings.get('1');

            if (!layoutSetting) {
              layoutSetting = new Y.Map() as YDatabaseBoardLayoutSetting;
              layoutSettings.set('1', layoutSetting);
            }

            layoutSetting.set(YjsDatabaseKey.hide_ungrouped_column, hide);
          },
        ],
        'toggleHideUnGrouped'
      );
    },
    [sharedRoot, view]
  );
}

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
  const rowMap = useRowDocMap();
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

export function useCalculateFieldDispatch(fieldId: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const fieldType = useFieldType(fieldId);

  return useCallback(
    (cells: Map<string, unknown>) => {
      const calculations = view?.get(YjsDatabaseKey.calculations);
      const index = (calculations?.toArray() || []).findIndex((calculation) => {
        return calculation.get(YjsDatabaseKey.field_id) === fieldId;
      });

      if (index === -1 || !calculations) {
        return;
      }

      const cellValues = Array.from(cells.values());

      const item = calculations.get(index);
      const type = Number(item.get(YjsDatabaseKey.type)) as CalculationType;
      const oldValue = item.get(YjsDatabaseKey.calculation_value) as string | number;

      const newValue = calculateFieldValue({
        fieldType,
        calculationType: type,
        cellValues,
      });

      if (newValue !== null && newValue !== oldValue) {
        executeOperations(
          sharedRoot,
          [
            () => {
              item.set(YjsDatabaseKey.calculation_value, newValue);
            },
          ],
          'calculateFieldDispatch'
        );
      }
    },
    [view, fieldId, fieldType, sharedRoot]
  );
}

export function useUpdateCalculate(fieldId: string) {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(
    (type: CalculationType) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
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
          },
        ],
        'updateCalculate'
      );
    },
    [fieldId, sharedRoot, view]
  );
}

export function useClearCalculate(fieldId: string) {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(() => {
    executeOperations(
      sharedRoot,
      [
        () => {
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
        },
      ],
      'clearCalculate'
    );
  }, [fieldId, sharedRoot, view]);
}

export function useUpdatePropertyNameDispatch(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (name: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) {
              throw new Error(`Field not found`);
            }

            field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

            field.set(YjsDatabaseKey.name, name);
          },
        ],
        'updatePropertyName'
      );
    },
    [database, fieldId, sharedRoot]
  );
}

function createField(type: FieldType, fieldId: string) {
  const createSimpleField = (
    fieldType: FieldType,
    initTypeOption?: (typeOption: YMapFieldTypeOption) => void
  ) => {
    const field = new Y.Map() as YDatabaseField;
    const typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
    const typeOption = new Y.Map() as YMapFieldTypeOption;
    const timestamp = String(dayjs().unix());

    field.set(YjsDatabaseKey.name, getFieldName(fieldType));
    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.type, fieldType);
    field.set(YjsDatabaseKey.created_at, timestamp);
    field.set(YjsDatabaseKey.last_modified, timestamp);
    field.set(YjsDatabaseKey.is_primary, false);
    field.set(YjsDatabaseKey.icon, '');

    initTypeOption?.(typeOption);
    typeOptionMap.set(String(fieldType), typeOption);
    field.set(YjsDatabaseKey.type_option, typeOptionMap);

    return field;
  };

  switch (type) {
    case FieldType.RichText:
      return createSimpleField(FieldType.RichText);
    case FieldType.Number:
      return createSimpleField(FieldType.Number, (typeOption) => {
        typeOption.set(YjsDatabaseKey.format, NumberFormat.Num);
      });
    case FieldType.DateTime:
      return createDateTimeField(fieldId);
    case FieldType.SingleSelect:
      return createSimpleField(FieldType.SingleSelect, (typeOption) => {
        typeOption.set(
          YjsDatabaseKey.content,
          JSON.stringify({
            disable_color: false,
            options: [],
          })
        );
      });
    case FieldType.MultiSelect:
      return createSimpleField(FieldType.MultiSelect, (typeOption) => {
        typeOption.set(
          YjsDatabaseKey.content,
          JSON.stringify({
            disable_color: false,
            options: [],
          })
        );
      });
    case FieldType.Checkbox:
      return createSimpleField(FieldType.Checkbox);
    case FieldType.URL:
      return createSimpleField(FieldType.URL);
    case FieldType.Checklist:
      return createSimpleField(FieldType.Checklist);
    case FieldType.LastEditedTime:
      return createSimpleField(FieldType.LastEditedTime);
    case FieldType.CreatedTime:
      return createSimpleField(FieldType.CreatedTime);
    case FieldType.Relation:
      return createRelationField(fieldId);
    case FieldType.AISummaries:
      return createSimpleField(FieldType.AISummaries);
    case FieldType.AITranslations:
      return createSimpleField(FieldType.AITranslations, (typeOption) => {
        typeOption.set(YjsDatabaseKey.language, AITranslateLanguage.English);
      });
    case FieldType.Time:
      return createSimpleField(FieldType.Time);
    case FieldType.FileMedia:
      return createSimpleField(FieldType.FileMedia, (typeOption) => {
        typeOption.set(
          YjsDatabaseKey.content,
          JSON.stringify({
            hide_file_names: true,
          })
        );
      });
    case FieldType.Person:
      return createSimpleField(FieldType.Person);
    case FieldType.Rollup:
      return createRollupField(fieldId);
    default:
      throw new Error(`Field type ${type} not supported`);
  }
}

export function useNewPropertyDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldType: FieldType) => {
      const fieldId = nanoid(6);

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const fields = database?.get(YjsDatabaseKey.fields);
          const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
          const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

          if (!fields || !fieldOrders || !fieldSettings) {
            throw new Error(`Field not found`);
          }

          const field: YDatabaseField = createField(fieldType, fieldId);

          fields.set(fieldId, field);
          const setting = new Y.Map() as YDatabaseFieldSetting;

          setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
          fieldSettings.set(fieldId, setting);

          fieldOrders.push([
            {
              id: fieldId,
            },
          ]);
        },
        'newPropertyDispatch'
      );

      return fieldId;
    },
    [database, sharedRoot]
  );
}

export function useAddPropertyLeftDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldId: string) => {
      const newId = nanoid(6);

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const fields = database?.get(YjsDatabaseKey.fields);
          const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
          const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

          if (!fields || !fieldOrders || !fieldSettings) {
            throw new Error(`Field not found`);
          }

          const field: YDatabaseField = createField(FieldType.RichText, newId);

          fields.set(newId, field);
          const setting = new Y.Map() as YDatabaseFieldSetting;

          setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
          fieldSettings.set(newId, setting);

          const index = fieldOrders.toArray().findIndex((field) => field.id === fieldId);

          if (index !== -1) {
            fieldOrders.insert(index, [
              {
                id: newId,
              },
            ]);
          }
        },
        'addPropertyLeftDispatch'
      );
      return newId;
    },
    [database, sharedRoot]
  );
}

export function useAddPropertyRightDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldId: string) => {
      const newId = nanoid(6);

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const fields = database?.get(YjsDatabaseKey.fields);
          const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
          const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

          if (!fields || !fieldOrders || !fieldSettings) {
            throw new Error(`Field not found`);
          }

          const field: YDatabaseField = createField(FieldType.RichText, newId);

          fields.set(newId, field);
          const setting = new Y.Map() as YDatabaseFieldSetting;

          setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
          fieldSettings.set(newId, setting);

          const index = fieldOrders.toArray().findIndex((field) => field.id === fieldId);

          if (index !== -1) {
            fieldOrders.insert(index + 1, [
              {
                id: newId,
              },
            ]);
          }
        },
        'addPropertyRightDispatch'
      );
      return newId;
    },
    [database, sharedRoot]
  );
}

function executeOperationWithAllViews(
  sharedRoot: YSharedRoot,
  database: YDatabase,
  operation: (view: YDatabaseView, viewId: string) => void,
  operationName: string
) {
  const views = database.get(YjsDatabaseKey.views);
  const viewIds = Object.keys(views.toJSON());

  executeOperations(
    sharedRoot,
    [
      () => {
        viewIds.forEach((viewId) => {
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
      },
    ],
    operationName
  );
}

export function useDeletePropertyDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldId: string) => {
      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const fields = database.get(YjsDatabaseKey.fields);
          const fieldOrders = view.get(YjsDatabaseKey.field_orders);
          const filters = view.get(YjsDatabaseKey.filters);
          const sorts = view.get(YjsDatabaseKey.sorts);

          if (!fields || !fieldOrders) {
            throw new Error(`Field not found`);
          }

          if (filters) {
            const index = filters.toArray().findIndex((filter) => filter.get(YjsDatabaseKey.field_id) === fieldId);

            if (index !== -1) {
              filters.delete(index);
            }
          }

          if (sorts) {
            const index = sorts.toArray().findIndex((sort) => sort.get(YjsDatabaseKey.field_id) === fieldId);

            if (index !== -1) {
              sorts.delete(index);
            }
          }

          fields.delete(fieldId);

          const index = fieldOrders.toArray().findIndex((field) => field.id === fieldId);

          if (index !== -1) {
            fieldOrders.delete(index);
          }
        },
        'deletePropertyDispatch'
      );
    },
    [database, sharedRoot]
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

export function useCreateCalendarEvent() {
  const newRowDispatch = useNewRowDispatch();
  const currentView = useDatabaseView();
  const defaultTimeSetting = useDefaultTimeSetting();
  const enhanceCalendarLayoutByFieldExists = useEnhanceCalendarLayoutByFieldExists();
  const calendarSetting = useCalendarLayoutSetting();

  return useCallback(
    async ({
      startTimestamp,
      endTimestamp,
      includeTime,
    }: {
      startTimestamp: string;
      endTimestamp?: string;
      includeTime?: boolean;
    }) => {
      if (!currentView) {
        throw new Error('Current view not found');
      }

      // Create or ensure correct date field before creating the event
      const fieldOrders = currentView.get(YjsDatabaseKey.field_orders);
      const validFieldId = () => {
        if (!calendarSetting || !calendarSetting.fieldId) {
          return false;
        }

        return fieldOrders.toArray().some((fieldOrder) => fieldOrder.id === calendarSetting.fieldId);
      }

      let finalFieldId = calendarSetting?.fieldId;

      if (!validFieldId()) {
        const dateField: YDatabaseField | undefined = enhanceCalendarLayoutByFieldExists(fieldOrders);
        const createdFieldId = dateField?.get(YjsDatabaseKey.id);

        if (!createdFieldId) {
          throw new Error(`Date field not found`);
        }

        const newCalendarSetting = generateCalendarLayoutSettings(createdFieldId, defaultTimeSetting);

        currentView.set(YjsDatabaseKey.layout_settings, newCalendarSetting);

        // Use the created field ID for the event
        finalFieldId = createdFieldId;
      }

      if (!finalFieldId) {
        throw new Error(`Field ID not found`);
      }

      const rowId = await newRowDispatch({
        tailing: true,
        cellsData: {
          [finalFieldId]: {
            data: startTimestamp,
            endTimestamp,
            isRange: !!endTimestamp,
            includeTime,
          },
        },
      });

      return rowId;
    },
    [newRowDispatch, currentView, defaultTimeSetting, enhanceCalendarLayoutByFieldExists, calendarSetting]
  );
}

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

export function useDuplicateRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const createRow = useCreateRow();
  const guid = useDocGuid();
  const rowDocMap = useRowDocMap();

  return useCallback(
    async (referenceRowId: string) => {
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
    [createRow, database, guid, rowDocMap, sharedRoot]
  );
}

export function useClearSortingDispatch() {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(() => {
    executeOperations(
      sharedRoot,
      [
        () => {
          const sorting = view?.get(YjsDatabaseKey.sorts);

          if (!sorting) {
            throw new Error(`Sorting not found`);
          }

          sorting.delete(0, sorting.length);
        },
      ],
      'clearSortingDispatch'
    );
  }, [sharedRoot, view]);
}

export function useUpdatePropertyIconDispatch(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (iconId: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) {
              throw new Error(`Field not found`);
            }

            field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

            field.set(YjsDatabaseKey.icon, iconId);
          },
        ],
        'updatePropertyName'
      );
    },
    [database, sharedRoot, fieldId]
  );
}

export function useHidePropertyDispatch() {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(
    (fieldId: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
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
          },
        ],
        'hidePropertyDispatch'
      );
    },
    [sharedRoot, view]
  );
}

export function useTogglePropertyWrapDispatch() {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(
    (fieldId: string, checked?: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
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
          },
        ],
        'togglePropertyWrapDispatch'
      );
    },
    [sharedRoot, view]
  );
}

export function useShowPropertyDispatch() {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(
    (fieldId: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

            const setting = fieldSettings?.get(fieldId);

            if (!setting) {
              throw new Error(`Field not found`);
            }

            setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
          },
        ],
        'showPropertyDispatch'
      );
    },
    [sharedRoot, view]
  );
}

export function useClearCellsWithFieldDispatch() {
  const sharedRoot = useSharedRoot();
  const rowDocs = useRowDocMap();

  return useCallback(
    (fieldId: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
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
          },
        ],
        'clearCellsWithFieldDispatch'
      );
    },
    [rowDocs, sharedRoot]
  );
}

export function useDuplicatePropertyDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowDocs = useRowDocMap();

  return useCallback(
    (fieldId: string) => {
      const newId = nanoid(6);

      executeOperations(
        sharedRoot,
        [
          () => {
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

            const fieldType = Number(field.get(YjsDatabaseKey.type));

            newField.set(YjsDatabaseKey.id, newId);
            newField.set(YjsDatabaseKey.name, field.get(YjsDatabaseKey.name) + ' (copy)');
            newField.set(YjsDatabaseKey.type, fieldType);
            newField.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
            newField.set(YjsDatabaseKey.is_primary, false);
            newField.set(YjsDatabaseKey.icon, field.get(YjsDatabaseKey.icon));
            const fieldTypeOptionMap = field.get(YjsDatabaseKey.type_option);

            if (fieldTypeOptionMap) {
              const newFieldTypeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
              const fieldTypeOption = fieldTypeOptionMap.get(String(fieldType));

              if (fieldTypeOption) {
                const newFieldTypeOption = new Y.Map() as YMapFieldTypeOption;

                fieldTypeOption.forEach((value, key) => {
                  // Because rust uses bigint for enum or some other values, so we need to convert it to string
                  // Yjs cannot set bigint value directly
                  if (typeof value === 'bigint') {
                    newFieldTypeOption.set(key, Number(value));
                  } else {
                    newFieldTypeOption.set(key, value);
                  }
                });
                newFieldTypeOptionMap.set(String(fieldType), newFieldTypeOption);
              }

              newField.set(YjsDatabaseKey.type_option, newFieldTypeOptionMap);
            }

            fields.set(newId, newField);
          },
        ],
        'duplicatePropertyDispatch'
      );

      // Insert new field to all views
      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
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

            setting.forEach((value, key) => {
              let newValue = value;

              // Because rust uses bigint for enum or some other values, so we need to convert it to string
              // Yjs cannot set bigint value directly
              if (typeof value === 'bigint') {
                newValue = Number(value);
              }

              newSetting.set(key, newValue);
            });
            fieldSettings.set(newId, newSetting);
          }

          const index = fieldOrders.toArray().findIndex((field) => field.id === fieldId);

          fieldOrders.insert(index + 1, [
            {
              id: newId,
            },
          ]);
        },
        'insertDuplicateProperty'
      );

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
    },
    [database, rowDocs, sharedRoot]
  );
}

export function useUpdateRowMetaDispatch(rowId: string) {
  const rowDocMap = useRowDocMap();

  const rowDoc = rowDocMap?.[rowId];

  return useCallback(
    (key: RowMetaKey, value?: string | boolean) => {
      if (!rowDoc) {
        throw new Error(`Row not found`);
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
    [rowDoc, rowId]
  );
}

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
  const rowDocMap = useRowDocMap();
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
      const rowDoc = rowDocMap?.[rowId];

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
    [field, fieldId, rowDocMap, rowId]
  );
}

export function useUpdateStartEndTimeCell() {
  const rowDocMap = useRowDocMap();

  return useCallback(
    (rowId: string, fieldId: string, startTimestamp: string, endTimestamp?: string, isAllDay?: boolean) => {
      const rowDoc = rowDocMap?.[rowId];

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
    [rowDocMap]
  );
}

function generateBoardSetting(database: YDatabase): YDatabaseFieldSettings {
  const fieldSettingsMap = new Y.Map() as YDatabaseFieldSettings;

  const boardFields = database.get(YjsDatabaseKey.fields);

  if (!boardFields) {
    return fieldSettingsMap;
  }

  boardFields.forEach((_, id) => {
    const setting = new Y.Map() as YDatabaseFieldSetting;

    setting.set(YjsDatabaseKey.visibility, FieldVisibility.HideWhenEmpty);

    fieldSettingsMap.set(id, setting);
  });

  return fieldSettingsMap;
}

function generateBoardLayoutSettings() {
  const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
  const layoutSetting = new Y.Map() as YDatabaseBoardLayoutSetting;

  layoutSetting.set(YjsDatabaseKey.hide_ungrouped_column, false);
  layoutSetting.set(YjsDatabaseKey.collapse_hidden_groups, true);
  layoutSettings.set('1', layoutSetting);
  return layoutSettings;
}

function generateBoardGroup(database: YDatabase, fieldOrders: YDatabaseFieldOrders) {
  const groups = new Y.Array() as YDatabaseGroups;
  let groupField: YDatabaseField | undefined;

  fieldOrders.toArray().some(({ id }) => {
    const field = database.get(YjsDatabaseKey.fields)?.get(id);

    if (!field) {
      return;
    }

    const type = Number(field.get(YjsDatabaseKey.type));

    if (
      [
        FieldType.SingleSelect,
        FieldType.MultiSelect,
        FieldType.Checkbox,
        // FieldType.DateTime,
        // FieldType.CreatedTime,
        // FieldType.LastEditedTime,
      ].includes(type)
    ) {
      groupField = field;
      return true;
    }

    return false;
  });

  if (groupField) {
    const group = generateGroupByField(groupField);

    groups.push([group]);
  }

  return groups;
}

function generateCalendarLayoutSettings(fieldId: FieldId, _defaultTimeSetting: DefaultTimeSetting) {
  const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
  const layoutSetting = new Y.Map() as YDatabaseCalendarLayoutSetting;

  layoutSetting.set(YjsDatabaseKey.field_id, fieldId);
  layoutSetting.set(YjsDatabaseKey.layout_ty, CalendarLayout.MonthLayout);
  layoutSetting.set(YjsDatabaseKey.show_week_numbers, true);
  layoutSetting.set(YjsDatabaseKey.show_weekends, true);
  layoutSettings.set('2', layoutSetting);
  return layoutSettings;
}

function useEnhanceCalendarLayoutByFieldExists() {
  const database = useDatabase();
  const fields = database.get(YjsDatabaseKey.fields);

  const sharedRoot = useSharedRoot();

  return useCallback((fieldOrders: YDatabaseFieldOrders) => {
    // find date field in all views
    let dateField: YDatabaseField | undefined;

    fieldOrders.forEach((fieldOrder) => {
      const field = fields?.get(fieldOrder.id);

      if (
        !dateField &&
        [FieldType.DateTime].includes(
          Number(field?.get(YjsDatabaseKey.type))
        )
      ) {
        dateField = field;
      }
    });

    // if no date field, create a new one
    if (!dateField) {
      const fieldId = nanoid(6);

      dateField = createField(FieldType.DateTime, fieldId);

      const typeOptionMap = generateDateTimeFieldTypeOptions();

      dateField.set(YjsDatabaseKey.type_option, typeOptionMap);
      fields.set(fieldId, dateField);

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const fieldOrders = view?.get(YjsDatabaseKey.field_orders);
          const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

          if (!fieldSettings) {
            throw new Error(`Field settings not found`);
          }

          fieldOrders.push([
            {
              id: fieldId,
            },
          ]);

          const setting = new Y.Map() as YDatabaseFieldSetting;

          setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
          fieldSettings.set(fieldId, setting);
        },
        'newDateTimeField'
      );
    }

    return dateField;
  }, [database, fields, sharedRoot])

}

/**
 * Hook to add a new database view (Grid, Board, or Calendar tab).
 * Creates a new view tab as a child of the main database page.
 */
export function useAddDatabaseView() {
  // databasePageId: The main database page in folder (used as parent for new views)
  const { databasePageId, activeViewId, createDatabaseView, databaseDoc, loadViewMeta, isDocumentBlock } =
    useDatabaseContext();
  const sharedRoot = useSharedRoot();

  const database = useMemo(() => {
    const dataSection = sharedRoot || (databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined);

    return dataSection?.get(YjsEditorKey.database) as YDatabase | undefined;
  }, [databaseDoc, sharedRoot]);

  const databaseId = useMemo(() => {
    return database?.get(YjsDatabaseKey.id);
  }, [database]);

  return useCallback(
    async (layout: DatabaseViewLayout, nameOverride?: string) => {
      if (!createDatabaseView) {
        throw new Error('createDatabaseView not found');
      }

      if (!databasePageId) {
        throw new Error('databasePageId not found');
      }

      const requestViewId = activeViewId || databasePageId;

      if (!databaseId) {
        throw new Error('databaseId not found');
      }

      const viewLayout = {
        [DatabaseViewLayout.Grid]: ViewLayout.Grid,
        [DatabaseViewLayout.Board]: ViewLayout.Board,
        [DatabaseViewLayout.Calendar]: ViewLayout.Calendar,
      }[layout];
      const name = {
        [DatabaseViewLayout.Grid]: 'Grid',
        [DatabaseViewLayout.Board]: 'Board',
        [DatabaseViewLayout.Calendar]: 'Calendar',
      }[layout];

      const tabsParentViewId = await (async (): Promise<string> => {
        // Best-effort: fall back to previous behavior if meta lookup isn't available.
        if (!loadViewMeta) {
          return databasePageId;
        }

        const safeLoadViewMeta = async (viewId: string): Promise<View | null> => {
          try {
            return await loadViewMeta(viewId);
          } catch {
            return null;
          }
        };

        const currentMeta = await safeLoadViewMeta(requestViewId);

        // If the current view itself is a container, attach under it.
        if (currentMeta && isDatabaseContainer(currentMeta)) {
          return currentMeta.view_id;
        }

        const parentId = currentMeta?.parent_view_id;

        if (!parentId) {
          return databasePageId;
        }

        // If parent is a database container, attach under the container (Scenario 4).
        const parentMeta = await safeLoadViewMeta(parentId);

        if (isDatabaseContainer(parentMeta)) {
          return parentId;
        }

        // Embedded databases without a container attach under the document (Scenario 3).
        if (isDocumentBlock) {
          return parentId;
        }

        // Backward-compatible fallback: attach under the current database view.
        return databasePageId;
      })();

      // Create new view as a child of the database container (or document for embedded linked views).
      const response = await createDatabaseView(requestViewId, {
        parent_view_id: tabsParentViewId,
        database_id: databaseId,
        layout: viewLayout,
        name: nameOverride ?? name,
        embedded: isDocumentBlock ?? false,
      });

      if (response?.database_update?.length) {
        applyYDoc(databaseDoc, new Uint8Array(response.database_update));
      }

      return response.view_id;
    },
    [createDatabaseView, databaseDoc, databasePageId, databaseId, activeViewId, loadViewMeta, isDocumentBlock]
  );
}

export function useUpdateDatabaseLayout(viewId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  const enhanceCalendarLayoutByFieldExists = useEnhanceCalendarLayoutByFieldExists();
  const defaultTimeSetting = useDefaultTimeSetting();

  return useCallback(
    (layout: DatabaseViewLayout) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const view = database.get(YjsDatabaseKey.views)?.get(viewId);

            if (!view) {
              throw new Error(`View not found`);
            }

            if (Number(view.get(YjsDatabaseKey.layout)) === layout) {
              return;
            }

            const fieldOrders = view.get(YjsDatabaseKey.field_orders);

            if (layout === DatabaseViewLayout.Board) {
              const groups = generateBoardGroup(database, fieldOrders);
              const settings = generateBoardSetting(database);
              const layoutSettings = generateBoardLayoutSettings();

              view.set(YjsDatabaseKey.groups, groups);
              view.set(YjsDatabaseKey.field_settings, settings);
              view.set(YjsDatabaseKey.layout_settings, layoutSettings);
            }

            if (layout === DatabaseViewLayout.Calendar) {
              // find date field in all views
              const dateField: YDatabaseField | undefined = enhanceCalendarLayoutByFieldExists(fieldOrders);
              const fieldId = dateField?.get(YjsDatabaseKey.id);

              if (!fieldId) {
                throw new Error(`Date field not found`);
              }

              const layoutSettings = generateCalendarLayoutSettings(fieldId, defaultTimeSetting);

              view.set(YjsDatabaseKey.layout_settings, layoutSettings);

            }

            view.set(YjsDatabaseKey.layout, layout);
          },
        ],
        'updateDatabaseLayout'
      );
    },
    [database, defaultTimeSetting, enhanceCalendarLayoutByFieldExists, sharedRoot, viewId]
  );
}

export function useUpdateDatabaseView() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const { updatePage } = useDatabaseContext();

  return useCallback(
    async (viewId: string, payload: UpdatePagePayload) => {
      await updatePage?.(viewId, payload);

      executeOperations(
        sharedRoot,
        [
          () => {
            const view = database.get(YjsDatabaseKey.views)?.get(viewId);

            if (!view) {
              throw new Error(`View not found`);
            }

            const name = payload.name || view.get(YjsDatabaseKey.name);

            view.set(YjsDatabaseKey.name, name);
          },
        ],
        'renameDatabaseView'
      );
    },
    [database, updatePage, sharedRoot]
  );
}

export function useDeleteView() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const { deletePage } = useDatabaseContext();

  return useCallback(
    async (viewId: string) => {
      await deletePage?.(viewId);

      executeOperations(
        sharedRoot,
        [
          () => {
            const view = database.get(YjsDatabaseKey.views)?.get(viewId);

            if (!view) {
              throw new Error(`View not found`);
            }

            database.get(YjsDatabaseKey.views)?.delete(viewId);
          },
        ],
        'deleteView'
      );
    },
    [database, deletePage, sharedRoot]
  );
}

function generateDateTimeFieldTypeOptions() {
  const typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;

  typeOptionMap.set(String(FieldType.DateTime), typeOption);

  typeOption.set(YjsDatabaseKey.time_format, TimeFormat.TwentyFourHour);
  typeOption.set(YjsDatabaseKey.date_format, DateFormat.Friendly);
  typeOption.set(YjsDatabaseKey.include_time, true);

  return typeOptionMap;
}

export function useSwitchPropertyType() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowDocMap = useRowDocMap();

  return useCallback(
    (fieldId: string, fieldType: FieldType) => {
      if (!rowDocMap) {
        throw new Error(`Row docs not found`);
      }

      const rows = Object.keys(rowDocMap);

      executeOperations(
        sharedRoot,
        [
          () => {
            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) {
              throw new Error(`Field not found`);
            }

            const oldFieldType = Number(field.get(YjsDatabaseKey.type));

            let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

            // Check if the field type is supported for type options
            if (
              [
                FieldType.Number,
                FieldType.SingleSelect,
                FieldType.MultiSelect,
                FieldType.Checklist,
                FieldType.Checkbox,
                FieldType.URL,
                FieldType.DateTime,
                FieldType.CreatedTime,
                FieldType.LastEditedTime,
                FieldType.FileMedia,
                FieldType.AITranslations,
                FieldType.Rollup,
              ].includes(fieldType)
            ) {
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
                  // to DateTime
                  if (oldFieldType !== FieldType.DateTime) {
                    newTypeOption.set(YjsDatabaseKey.include_time, true);
                  }
                } else if (fieldType === FieldType.Number) {
                  // to Number
                  newTypeOption.set(YjsDatabaseKey.format, NumberFormat.Num);
                } else if ([FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
                  // to Select
                  const rows = Object.keys(rowDocMap);
                  let content = '';

                  switch (oldFieldType) {
                    // From SingleSelect or MultiSelect to Select, keep the content
                    case FieldType.SingleSelect:
                    case FieldType.MultiSelect: {
                      const oldTypeOption = typeOptionMap.get(String(oldFieldType));

                      if (oldTypeOption) {
                        content = oldTypeOption.get(YjsDatabaseKey.content) || '';
                      }

                      break;
                    }

                    // From other types to Select, generate options from rows
                    case FieldType.Checkbox:
                    case FieldType.RichText:
                    case FieldType.Number:
                    case FieldType.URL: {
                      const options = new Set<string>();

                      // If the old field type is Checkbox, add Yes/No options
                      if (oldFieldType === FieldType.Checkbox) {
                        options.add('Yes');
                        options.add('No');
                      } else {
                        rows.forEach((rowId) => {
                          const rowDoc = rowDocMap[rowId];

                          if (!rowDoc) {
                            return;
                          }

                          getOptionsFromRow(rowDoc, fieldId).forEach((option) => {
                            options.add(option);
                          });
                        });
                      }

                      content = JSON.stringify({
                        disable_color: false,
                        options: Array.from(options).map((name, index) => {
                          return {
                            id: name,
                            name,
                            color: Object.values(SelectOptionColor)[index % 10],
                          };
                        }),
                      });

                      break;
                    }
                  }

                  // Set the content for the type option
                  newTypeOption.set(YjsDatabaseKey.content, content);
                } else if (fieldType === FieldType.URL) {
                  newTypeOption.set(YjsDatabaseKey.content, '');
                } else if (fieldType === FieldType.AITranslations) {
                  newTypeOption.set(YjsDatabaseKey.language, AITranslateLanguage.English);
                } else if (fieldType === FieldType.FileMedia) {
                  // to FileMedia
                  const content = JSON.stringify({
                    hide_file_names: true,
                  });

                  newTypeOption.set(YjsDatabaseKey.content, content);
                } else if (fieldType === FieldType.Rollup) {
                  newTypeOption.set(YjsDatabaseKey.relation_field_id, '');
                  newTypeOption.set(YjsDatabaseKey.target_field_id, '');
                  newTypeOption.set(YjsDatabaseKey.calculation_type, CalculationType.Count);
                  newTypeOption.set(YjsDatabaseKey.show_as, RollupDisplayMode.Calculated);
                  newTypeOption.set(YjsDatabaseKey.condition_value, '');
                }

                typeOptionMap.set(String(fieldType), newTypeOption);
              }
            }

            field.set(YjsDatabaseKey.type, fieldType);

            const lastModified = field.get(YjsDatabaseKey.last_modified);
            const createdAt = field.get(YjsDatabaseKey.created_at);
            const currentName = field.get(YjsDatabaseKey.name);
            const oldDefaultName = getFieldName(oldFieldType);
            const isNewField =
              createdAt !== undefined &&
              lastModified !== undefined &&
              String(createdAt) === String(lastModified);

            // Only auto-rename for untouched default fields (desktop parity).
            if (isNewField && (!currentName || currentName === oldDefaultName)) {
              field.set(YjsDatabaseKey.name, getFieldName(fieldType));
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

                // Update each cell lazily: preserve existing data, record source type, update target type only.
                if (cell) {
                  const data = cell.get(YjsDatabaseKey.data);
                  const oldCellType = Number(cell.get(YjsDatabaseKey.field_type));

                  // Remember the original type so rendering can decode on demand.
                  cell.set(YjsDatabaseKey.source_field_type, String(oldCellType));

                  // Move the cell to the new type without mutating data.
                  cell.set(YjsDatabaseKey.field_type, fieldType);
                  cell.set(YjsDatabaseKey.data, data instanceof Y.Array ? data.clone() : data);
                  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
                  row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
                }
              });
            });
          },
        ],
        'switchPropertyType'
      );
    },
    [database, sharedRoot, rowDocMap]
  );
}

export function useUpdateNumberTypeOption() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldId: string, format: NumberFormat) => {
      executeOperations(
        sharedRoot,
        [
          () => {
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
          },
        ],
        'updateNumberTypeOption'
      );
    },
    [database, sharedRoot]
  );
}

export function useUpdateTranslateLanguage(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (language: AITranslateLanguage) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) {
              throw new Error(`Field not found`);
            }

            let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

            if (!typeOptionMap) {
              typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

              field.set(YjsDatabaseKey.type_option, typeOptionMap);
            }

            const typeOption = typeOptionMap.get(String(FieldType.AITranslations));

            if (!typeOption) {
              const newTypeOption = new Y.Map() as YMapFieldTypeOption;

              newTypeOption.set(YjsDatabaseKey.language, language);

              typeOptionMap.set(String(FieldType.AITranslations), newTypeOption);
            } else {
              typeOption.set(YjsDatabaseKey.language, language);
            }

            field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
          },
        ],
        'updateTranslateLanguage'
      );
    },
    [database, fieldId, sharedRoot]
  );
}

export function useAddSelectOption(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (option: SelectOption) => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            const fieldType = Number(field.get(YjsDatabaseKey.type));

            let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

            if (!typeOptionMap) {
              typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

              field.set(YjsDatabaseKey.type_option, typeOptionMap);
            }

            let typeOption = typeOptionMap.get(String(fieldType));

            if (!typeOption) {
              typeOption = new Y.Map() as YMapFieldTypeOption;

              typeOption.set(
                YjsDatabaseKey.content,
                JSON.stringify({
                  disable_color: false,
                  options: [],
                })
              );

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
            typeOption.set(
              YjsDatabaseKey.content,
              JSON.stringify({
                ...options,
                options: newOptions,
              })
            );
          },
        ],
        'addSelectOption'
      );

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const groups = view?.get(YjsDatabaseKey.groups);

          const group = groups?.toArray().find((item) => {
            return item.get(YjsDatabaseKey.field_id) === fieldId;
          });

          if (group) {
            const columns = group.get(YjsDatabaseKey.groups);
            const optionId = option.id;

            const column = columns.toArray().find((col) => col.id === optionId);

            if (!column) {
              columns.push([
                {
                  id: optionId,
                  visible: true,
                },
              ]);
            }
          }
        },
        'insertSelectOptionToGroup'
      );
    },
    [database, fieldId, sharedRoot]
  );
}

export function useReorderSelectFieldOptions(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

  if (!field) {
    throw new Error(`Field not found`);
  }

  return useCallback(
    (optionId: string, beforeId?: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const fieldType = Number(field.get(YjsDatabaseKey.type));

            let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

            if (!typeOptionMap) {
              typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

              field.set(YjsDatabaseKey.type_option, typeOptionMap);
            }

            let typeOption = typeOptionMap.get(String(fieldType));

            if (!typeOption) {
              typeOption = new Y.Map() as YMapFieldTypeOption;

              typeOption.set(
                YjsDatabaseKey.content,
                JSON.stringify({
                  disable_color: false,
                  options: [],
                })
              );

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

            typeOption.set(
              YjsDatabaseKey.content,
              JSON.stringify({
                ...data,
                options: newOptions,
              })
            );
          },
        ],
        'updateSelectOptions'
      );
    },
    [field, sharedRoot]
  );
}

export function useDeleteSelectOption(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (optionId: string) => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            const fieldType = Number(field.get(YjsDatabaseKey.type));

            if (![FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
              return;
            }

            let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

            if (!typeOptionMap) {
              typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

              field.set(YjsDatabaseKey.type_option, typeOptionMap);
            }

            let typeOption = typeOptionMap.get(String(fieldType));

            if (!typeOption) {
              typeOption = new Y.Map() as YMapFieldTypeOption;

              typeOption.set(
                YjsDatabaseKey.content,
                JSON.stringify({
                  disable_color: false,
                  options: [],
                })
              );

              typeOptionMap.set(String(fieldType), typeOption);
            }

            const content = typeOption.get(YjsDatabaseKey.content);

            if (!content) {
              throw new Error(`Content not found`);
            }

            const options = JSON.parse(content) as SelectTypeOption;
            const newOptions = options.options.filter((opt) => opt.id !== optionId);

            typeOption.set(
              YjsDatabaseKey.content,
              JSON.stringify({
                ...options,
                options: newOptions,
              })
            );
          },
        ],
        'deleteSelectOption'
      );

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const groups = view?.get(YjsDatabaseKey.groups);

          const group = groups?.toArray().find((item) => {
            return item.get(YjsDatabaseKey.field_id) === fieldId;
          });

          if (group) {
            const columns = group.get(YjsDatabaseKey.groups);
            const columnIndex = columns.toArray().findIndex((col) => col.id === optionId);

            if (columnIndex !== -1) {
              columns.delete(columnIndex);
            }
          }

          const filters = view?.get(YjsDatabaseKey.filters);
          const filter = filters?.toArray().find((filter) => filter.get(YjsDatabaseKey.field_id) === fieldId);

          if (filter) {
            const content = filter?.get(YjsDatabaseKey.content);
            const filterOptionIds = content?.split(',')?.filter((item) => item.trim() !== '') ?? [];

            if (filterOptionIds.includes(optionId)) {
              const newContent = filterOptionIds.filter((id) => id !== optionId).join(',');

              filter.set(YjsDatabaseKey.content, newContent);
            }
          }
        },
        'deleteSelectOptionFromGroup'
      );
    },
    [database, fieldId, sharedRoot]
  );
}

export function useUpdateSelectOption(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (optionId: string, option: SelectOption) => {
      executeOperations(
        sharedRoot,
        [
          () => {
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

              typeOption.set(
                YjsDatabaseKey.content,
                JSON.stringify({
                  disable_color: false,
                  options: [],
                })
              );

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

            typeOption.set(
              YjsDatabaseKey.content,
              JSON.stringify({
                ...options,
                options: newOptions,
              })
            );
          },
        ],
        'updateSelectOption'
      );
    },
    [database, fieldId, sharedRoot]
  );
}

export function useUpdateDateTimeFieldFormat(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    ({
      dateFormat,
      timeFormat,
      includeTime,
    }: {
      dateFormat?: DateFormat;
      timeFormat?: TimeFormat;
      includeTime?: boolean;
    }) => {
      executeOperations(
        sharedRoot,
        [
          () => {
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
          },
        ],
        'updateDateTimeFieldFormat'
      );
    },
    [database, fieldId, sharedRoot]
  );
}

export function useUpdateRelationDatabaseId(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const clearCells = useClearCellsWithFieldDispatch();

  return useCallback(
    (databaseId: string) => {
      // Check if the relation database id is dirty
      let isDirty = false;

      executeOperations(
        sharedRoot,
        [
          () => {
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

            // Check if the relation database id is dirty
            if (typeOption.get(YjsDatabaseKey.database_id) !== databaseId) {
              isDirty = true;
            }

            typeOption.set(YjsDatabaseKey.database_id, databaseId);

            field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
          },
        ],
        'updateRelationDatabaseId'
      );

      // Clear cells when the relation database id is changed
      if (isDirty) {
        clearCells(fieldId);
      }
    },
    [database, fieldId, sharedRoot, clearCells]
  );
}

export function useUpdateRollupTypeOption(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (updates: {
      relation_field_id?: string;
      target_field_id?: string;
      calculation_type?: CalculationType;
      show_as?: RollupDisplayMode;
      condition_value?: string;
    }) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) {
              throw new Error(`Field not found`);
            }

            let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

            if (!typeOptionMap) {
              typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
              field.set(YjsDatabaseKey.type_option, typeOptionMap);
            }

            let typeOption = typeOptionMap.get(String(FieldType.Rollup));

            if (!typeOption) {
              typeOption = new Y.Map() as YMapFieldTypeOption;
              typeOptionMap.set(String(FieldType.Rollup), typeOption);
            }

            if (updates.relation_field_id !== undefined) {
              typeOption.set(YjsDatabaseKey.relation_field_id, updates.relation_field_id);
            }

            if (updates.target_field_id !== undefined) {
              typeOption.set(YjsDatabaseKey.target_field_id, updates.target_field_id);
            }

            if (updates.calculation_type !== undefined) {
              typeOption.set(YjsDatabaseKey.calculation_type, updates.calculation_type);
            }

            if (updates.show_as !== undefined) {
              typeOption.set(YjsDatabaseKey.show_as, updates.show_as);
            }

            if (updates.condition_value !== undefined) {
              typeOption.set(YjsDatabaseKey.condition_value, updates.condition_value);
            }

            field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
          },
        ],
        'updateRollupTypeOption'
      );
    },
    [database, fieldId, sharedRoot]
  );
}

export function useAddSort() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldId: string) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            let sorts = view.get(YjsDatabaseKey.sorts);

            if (!sorts) {
              sorts = new Y.Array() as YDatabaseSorts;
              view.set(YjsDatabaseKey.sorts, sorts);
            }

            const isExist = sorts.toArray().some((sort) => {
              const sortFieldId = sort.get(YjsDatabaseKey.field_id);

              if (sortFieldId === fieldId) {
                return true;
              }

              return false;
            });

            if (isExist) {
              return;
            }

            const sort = new Y.Map() as YDatabaseSort;
            const id = `${nanoid(6)}`;

            sort.set(YjsDatabaseKey.id, id);
            sort.set(YjsDatabaseKey.field_id, fieldId);
            sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);

            sorts.push([sort]);
          },
        ],
        'addSort'
      );
    },
    [view, sharedRoot]
  );
}

export function useRemoveSort() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (sortId: string) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            const sorts = view.get(YjsDatabaseKey.sorts);

            if (!sorts) {
              return;
            }

            const index = sorts.toArray().findIndex((sort) => sort.get(YjsDatabaseKey.id) === sortId);

            if (index === -1) {
              return;
            }

            sorts.delete(index);
          },
        ],
        'removeSort'
      );
    },
    [view, sharedRoot]
  );
}

export function useUpdateSort() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    ({ sortId, fieldId, condition }: { sortId: string; fieldId?: string; condition?: SortCondition }) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            const sorts = view.get(YjsDatabaseKey.sorts);

            if (!sorts) {
              return;
            }

            const sort = sorts.toArray().find((sort) => sort.get(YjsDatabaseKey.id) === sortId);

            if (!sort) {
              return;
            }

            if (fieldId) {
              sort.set(YjsDatabaseKey.field_id, fieldId);
            }

            if (condition !== undefined) {
              sort.set(YjsDatabaseKey.condition, condition);
            }
          },
        ],
        'updateSort'
      );
    },
    [view, sharedRoot]
  );
}

export function useReorderSorts() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (sortId: string, beforeId?: string) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            const sorts = view.get(YjsDatabaseKey.sorts);

            if (!sorts) {
              return;
            }

            const sortArray = sorts.toJSON() as {
              id: string;
            }[];

            const sourceIndex = sortArray.findIndex((sort) => sort.id === sortId);
            const targetIndex = beforeId !== undefined ? sortArray.findIndex((sort) => sort.id === beforeId) + 1 : 0;

            const sort = sorts.get(sourceIndex);

            const newSort = new Y.Map() as YDatabaseSort;

            sort.forEach((value, key) => {
              let newValue = value;

              // Because rust uses bigint for enum or some other values, so we need to convert it to string
              // Yjs cannot set bigint value directly
              if (typeof value === 'bigint') {
                newValue = value.toString();
              }

              newSort.set(key, newValue);
            });

            sorts.delete(sourceIndex);

            let adjustedTargetIndex = targetIndex;

            if (targetIndex > sourceIndex) {
              adjustedTargetIndex -= 1;
            }

            sorts.insert(adjustedTargetIndex, [newSort]);
          },
        ],
        'reorderSort'
      );
    },
    [view, sharedRoot]
  );
}

export function useAddFilter() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const fields = useDatabaseFields();

  return useCallback(
    (fieldId: string) => {
      Log.debug('[useAddFilter] Creating filter', { fieldId });

      // Guard: Don't create filter if fieldId is missing or empty
      if (!view || !fieldId || fieldId.trim() === '') {
        Log.warn('[useAddFilter] Skipping filter creation: view or fieldId is missing', {
          hasView: !!view,
          fieldId,
        });
        return;
      }

      const id = `${nanoid(6)}`;

      Log.debug('[useAddFilter] Generated filter id', { filterId: id, fieldId });

      executeOperations(
        sharedRoot,
        [
          () => {
            const field = fields.get(fieldId);

            if (!field) {
              Log.warn('[useAddFilter] Field not found for fieldId:', fieldId);
              return;
            }

            const fieldType = Number(field.get(YjsDatabaseKey.type));

            Log.debug('[useAddFilter] Field info', { fieldId, fieldType });

            let filters = view.get(YjsDatabaseKey.filters);

            if (!filters) {
              Log.debug('[useAddFilter] Creating new filters array');
              filters = new Y.Array() as YDatabaseFilters;
              view.set(YjsDatabaseKey.filters, filters);
            }

            const filter = new Y.Map() as YDatabaseFilter;

            filter.set(YjsDatabaseKey.id, id);
            filter.set(YjsDatabaseKey.field_id, fieldId);
            const conditionData = getDefaultFilterCondition(fieldType);

            if (!conditionData) {
              Log.warn('[useAddFilter] No default condition for fieldType:', fieldType);
              return;
            }

            Log.debug('[useAddFilter] Setting filter data', {
              filterId: id,
              fieldId,
              fieldType,
              condition: conditionData.condition,
              content: conditionData.content,
            });

            filter.set(YjsDatabaseKey.condition, conditionData.condition);
            if (conditionData.content !== undefined) {
              filter.set(YjsDatabaseKey.content, conditionData.content);
            }

            filter.set(YjsDatabaseKey.type, fieldType);
            filter.set(YjsDatabaseKey.filter_type, FilterType.Data);

            filters.push([filter]);

            Log.debug('[useAddFilter] Filter created successfully', { filterId: id, filter: filter.toJSON() });
          },
        ],
        'addFilter'
      );

      return id;
    },
    [view, sharedRoot, fields]
  );
}

export function useRemoveFilter() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (filterId: string) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            const filters = view.get(YjsDatabaseKey.filters);

            if (!filters) {
              return;
            }

            const index = filters.toArray().findIndex((filter) => filter.get(YjsDatabaseKey.id) === filterId);

            if (index === -1) {
              return;
            }

            filters.delete(index);
          },
        ],
        'removeFilter'
      );
    },
    [view, sharedRoot]
  );
}

export interface UpdateFilterParams {
  filterId: string;
  fieldId?: string;
  condition?: number;
  content?: string;
}

export function useUpdateFilter() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (params: UpdateFilterParams) => {
      const { filterId, fieldId, condition, content } = params;

      Log.debug('[useUpdateFilter] Updating filter', { filterId, fieldId, condition, content });

      // Guard: view must exist
      if (!view) {
        Log.warn('[useUpdateFilter] View is not available');
        return;
      }

      // Guard: fieldId is required for filter updates
      if (!fieldId) {
        Log.warn('[useUpdateFilter] FieldId is missing', { filterId });
        return;
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            // Get filters array from view
            const filters = view.get(YjsDatabaseKey.filters);

            if (!filters) {
              Log.warn('[useUpdateFilter] No filters found in view', { filterId });
              return;
            }

            // Find the filter by id
            const filter = filters.toArray().find((f) => f.get(YjsDatabaseKey.id) === filterId);

            if (!filter) {
              Log.warn('[useUpdateFilter] Filter not found', { filterId });
              return;
            }

            // Update field_id (always required)
            filter.set(YjsDatabaseKey.field_id, fieldId);

            // Update condition if provided
            if (condition !== undefined) {
              filter.set(YjsDatabaseKey.condition, condition);
            }

            // Update content if provided
            if (content !== undefined) {
              filter.set(YjsDatabaseKey.content, content);
            }

            Log.debug('[useUpdateFilter] Filter updated successfully', {
              filterId,
              filter: filter.toJSON(),
            });
          },
        ],
        'updateFilter'
      );
    },
    [view, sharedRoot]
  );
}

export function useUpdateFileMediaTypeOption(fieldId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    ({ hideFileNames }: { hideFileNames: boolean }) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) {
              throw new Error(`Field not found`);
            }

            let typeOptionMap = field?.get(YjsDatabaseKey.type_option);

            if (!typeOptionMap) {
              typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;

              field.set(YjsDatabaseKey.type_option, typeOptionMap);
            }

            const typeOption = typeOptionMap.get(String(FieldType.FileMedia));

            if (!typeOption) {
              const newTypeOption = new Y.Map() as YMapFieldTypeOption;

              newTypeOption.set(
                YjsDatabaseKey.content,
                JSON.stringify({
                  hide_file_names: hideFileNames,
                })
              );
              typeOptionMap.set(String(FieldType.FileMedia), newTypeOption);
            } else {
              Log.debug('Updating file media type option', typeOption.toJSON());
              typeOption.set(
                YjsDatabaseKey.content,
                JSON.stringify({
                  hide_file_names: hideFileNames,
                })
              );
            }
          },
        ],
        'updateFileMediaType'
      );
    },
    [database, fieldId, sharedRoot]
  );
}

export function useUpdateCalendarSetting() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (settings: Partial<CalendarLayoutSetting>) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error(`Unable to toggle hide ungrouped column`);
            }

            // Get or create the layout settings for the view
            let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

            if (!layoutSettings) {
              layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
            }

            let layoutSetting = layoutSettings.get('2');

            if (!layoutSetting) {
              layoutSetting = new Y.Map() as YDatabaseCalendarLayoutSetting;
              layoutSettings.set('2', layoutSetting);
            }

            if (settings.fieldId !== undefined) {
              layoutSetting.set(YjsDatabaseKey.field_id, settings.fieldId);
            }

            if (settings.firstDayOfWeek !== undefined) {
              layoutSetting.set(YjsDatabaseKey.first_day_of_week, settings.firstDayOfWeek);
            }

            if (settings.showWeekNumbers !== undefined) {
              layoutSetting.set(YjsDatabaseKey.show_week_numbers, settings.showWeekNumbers);
            }

            if (settings.showWeekends !== undefined) {
              layoutSetting.set(YjsDatabaseKey.show_weekends, settings.showWeekends);
            }

            if (settings.layout !== undefined) {
              layoutSetting.set(YjsDatabaseKey.layout_ty, settings.layout);
            }

            if (settings.numberOfDays !== undefined) {
              layoutSetting.set(YjsDatabaseKey.number_of_days, settings.numberOfDays);
            }
          },
        ],
        'updateCalendarSetting'
      );
    },
    [sharedRoot, view]
  );
}
