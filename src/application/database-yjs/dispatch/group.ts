/**
 * Group dispatch hooks (for Board view)
 *
 * Handles board grouping operations:
 * - useGroupByFieldDispatch: Group rows by a field
 * - useReorderGroupColumnDispatch: Reorder columns within a group
 * - useDeleteGroupColumnDispatch: Delete a group column
 * - useToggleHiddenGroupColumnDispatch: Toggle column visibility
 * - useToggleCollapsedHiddenGroupColumnDispatch: Toggle collapsed state
 * - useToggleHideUnGrouped: Toggle hiding ungrouped items
 */

import { nanoid } from 'nanoid';
import { useCallback, useMemo } from 'react';
import * as Y from 'yjs';

import { useDatabase, useDatabaseView, useSharedRoot } from '@/application/database-yjs/context';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields';
import { useBoardLayoutSettings, useFieldType } from '@/application/database-yjs/selector';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import {
  YDatabaseBoardLayoutSetting,
  YDatabaseField,
  YDatabaseGroup,
  YDatabaseGroupColumns,
  YDatabaseGroups,
  YDatabaseLayoutSettings,
  YjsDatabaseKey,
} from '@/application/types';

// Import from sibling dispatch files
import { useBulkDeleteRowDispatch } from './row';
import { useDeleteSelectOption } from './type-option';

/**
 * Helper: Generate a group configuration for a field
 */
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
