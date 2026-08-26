import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import { useCallback, useMemo } from 'react';
import * as Y from 'yjs';

import { resolveUserAttributionUid, touchRowAttribution } from '@/application/database-yjs/attribution';
import { calculateFieldValue } from '@/application/database-yjs/calculation';
import { cloneDatabaseCell } from '@/application/database-yjs/cell.clone';
import { normalizeLegacyCellFieldType, setCellStoredType } from '@/application/database-yjs/cell.field-type';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { DEFAULT_FIELD_WRAP } from '@/application/database-yjs/const';
import {
  useDatabase,
  useDatabaseContext,
  useDatabaseFields,
  useDatabaseView,
  useDatabaseViewId,
  useDefaultTimeSetting,
  useRowMap,
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
  isAttributionFieldType,
  RowMetaKey,
  RollupDisplayMode,
  SortCondition,
} from '@/application/database-yjs/database.type';
import { deleteReciprocalRelationField } from '@/application/database-yjs/dispatch/relation';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch/row';
import {
  getFieldName,
  NumberFormat,
  parseChecklistData,
  parseSelectOptionTypeOptions,
  SelectOption,
  SelectOptionColor,
  SelectTypeOption,
} from '@/application/database-yjs/fields';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { createSelectOptionCell } from '@/application/database-yjs/fields/select-option/utils';
import { createDateTimeField } from '@/application/database-yjs/fields/text/utils';
import { getDefaultFilterCondition, resolveRollupFilterTargetFieldType } from '@/application/database-yjs/filter';
import {
  initializeGalleryLayoutSetting,
  normalizeCreatedDatabaseGalleryView,
  updateCreatesExactGalleryView as updateCreatesExactDatabaseView,
} from '@/application/database-yjs/gallery-layout';
import {
  getGroupColumns,
  isDatabaseGroupableFieldType,
  parseDateGroupConfiguration,
} from '@/application/database-yjs/group';
import {
  cloneYDatabaseGroupColumn,
  createYDatabaseGroupColumn,
  getDatabaseGroupColumnId,
  markLocalDatabaseGroupInitialization,
  normalizeDatabaseGroupColumn,
} from '@/application/database-yjs/group-column';
import {
  initializeListLayoutSetting,
  normalizeCreatedDatabaseListView,
  removeCreatedDatabaseView,
} from '@/application/database-yjs/list-layout';
import { waitForDatabaseRowHydration } from '@/application/database-yjs/row.hydration';
import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { useCalendarLayoutSetting, useFieldType } from '@/application/database-yjs/selector';
import { deleteCollabDB } from '@/application/db';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import {
  DatabaseViewLayout,
  DateFormat,
  FieldId,
  GalleryLayoutSettings,
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
  YDatabaseChartLayoutSetting,
  YDatabaseField,
  YDatabaseFieldOrders,
  YDatabaseFields,
  YDatabaseFieldSetting,
  YDatabaseFieldTypeOption,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseGroup,
  YDatabaseGroupColumns,
  YDatabaseGroups,
  YDatabaseGridLayoutSetting,
  YDatabaseLayoutSettings,
  YDatabaseListLayoutSetting,
  YDatabaseRow,
  YDatabaseRowOrders,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
  YSharedRoot,
} from '@/application/types';
import { DefaultTimeSetting } from '@/application/user-metadata';
import { isDatabaseContainer } from '@/application/view-utils';
import { applyYDoc } from '@/application/ydoc/apply';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
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
  group.set(YjsDatabaseKey.type, fieldType);
  group.set(YjsDatabaseKey.collapsed_group_ids, new Y.Array<string>());

  switch (fieldType) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      group.set(YjsDatabaseKey.content, '');
      const typeOption = parseSelectOptionTypeOptions(field);
      const options = (typeOption?.options || []).filter((option) => Boolean(option && option.id));

      columns.push([createYDatabaseGroupColumn({ id: fieldId })]);

      // Add a column for each option
      options.forEach((option) => {
        const optionId = option?.id;

        if (!optionId) {
          return;
        }

        columns.push([createYDatabaseGroupColumn({ id: optionId })]);
      });
      break;
    }

    case FieldType.Checkbox:
      group.set(YjsDatabaseKey.content, '');
      // Add a column for the checkbox field
      columns.push([createYDatabaseGroupColumn({ id: 'Yes' })]);
      columns.push([createYDatabaseGroupColumn({ id: 'No' })]);
      break;
    case FieldType.DateTime:
      group.set(
        YjsDatabaseKey.content,
        JSON.stringify({
          hide_empty: false,
          condition: DateGroupCondition.Relative,
        })
      );

      columns.push([createYDatabaseGroupColumn({ id: fieldId })]);
      break;
    case FieldType.RichText:
    case FieldType.Number:
    case FieldType.URL:
    case FieldType.Relation:
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      group.set(YjsDatabaseKey.content, '');
      columns.push([createYDatabaseGroupColumn({ id: fieldId })]);
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

  return useCallback(
    (fieldId: string) => {
      if (!view) {
        throw new Error('View not found');
      }

      const currentFieldId = view.get(YjsDatabaseKey.groups)?.toArray()[0]?.get(YjsDatabaseKey.field_id);

      if (currentFieldId === fieldId) {
        // If the field is already grouped, do nothing
        return;
      }

      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field with id ${fieldId} not found`);
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (!isDatabaseGroupableFieldType(fieldType)) {
        throw new Error(`Field with id ${fieldId} cannot be grouped`);
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            const layout = Number(view.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;
            const supportsOptionalGrouping = layout === DatabaseViewLayout.Grid || layout === DatabaseViewLayout.List;

            if (!supportsOptionalGrouping) {
              // Board keeps its existing behavior: a field cannot simultaneously
              // act as the grouping source and as a filter.
              const filters = view.get(YjsDatabaseKey.filters);
              const filterIndex = filters
                ?.toArray()
                .findIndex((filter) => filter.get(YjsDatabaseKey.field_id) === fieldId);

              if (filters && filterIndex > -1) {
                filters.delete(filterIndex);
              }
            }

            let groups = view.get(YjsDatabaseKey.groups);

            if (!groups) {
              groups = new Y.Array() as YDatabaseGroups;
              view.set(YjsDatabaseKey.groups, groups);
            }

            const group = generateGroupByField(field);

            if (supportsOptionalGrouping) markLocalDatabaseGroupInitialization(group);

            // Only one group can exist at a time, so we clear the existing groups
            groups.delete(0, groups.length);
            groups.insert(0, [group]);

            if (supportsOptionalGrouping) {
              const layoutSetting = getOrCreateDatabaseGroupingLayoutSetting(view, layout);

              if (layoutSetting.get(YjsDatabaseKey.hide_empty_groups) === undefined) {
                layoutSetting.set(YjsDatabaseKey.hide_empty_groups, true);
              }
            }
          },
        ],
        'groupByField'
      );
    },
    [database, sharedRoot, view]
  );
}

export function useClearGroupByFieldDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(() => {
    executeOperations(
      sharedRoot,
      [
        () => {
          const groups = view?.get(YjsDatabaseKey.groups);

          if (groups?.length) groups.delete(0, groups.length);
        },
      ],
      'clearGroupByField'
    );
  }, [sharedRoot, view]);
}

export function useUpdateGroupContentDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (content: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const group = view?.get(YjsDatabaseKey.groups)?.toArray()?.[0];

            if (!group) throw new Error('Group not found');
            const layout = Number(view?.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;

            if (layout === DatabaseViewLayout.Grid || layout === DatabaseViewLayout.List) {
              markLocalDatabaseGroupInitialization(group);
            }

            group.set(YjsDatabaseKey.content, content);
          },
        ],
        'updateGroupContent'
      );
    },
    [sharedRoot, view]
  );
}

export function useUpdateDateGroupConditionDispatch() {
  const view = useDatabaseView();
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (condition: DateGroupCondition) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const groups = view?.get(YjsDatabaseKey.groups);
            const currentGroup = groups?.get(0);
            const fieldId = currentGroup?.get(YjsDatabaseKey.field_id);
            const field = fieldId ? database.get(YjsDatabaseKey.fields)?.get(fieldId) : undefined;

            if (!groups || !currentGroup || !field) throw new Error('Date group not found');
            if (Number(field.get(YjsDatabaseKey.type)) !== FieldType.DateTime) {
              throw new Error('Grouping field is not a date field');
            }

            const configuration = parseDateGroupConfiguration(currentGroup.get(YjsDatabaseKey.content));

            if (configuration.condition === condition) return;

            // Desktop rebuilds the group setting when its date condition
            // changes. Old day/week/month/year IDs are categorically invalid
            // under the new condition, so replacing this map is safe even when
            // some offscreen row documents are only seed snapshots.
            const replacement = generateGroupByField(field);

            replacement.set(YjsDatabaseKey.content, JSON.stringify({ ...configuration, condition }));
            const layout = Number(view?.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;

            if (layout === DatabaseViewLayout.Grid || layout === DatabaseViewLayout.List) {
              markLocalDatabaseGroupInitialization(replacement);
            }

            groups.delete(0, groups.length);
            groups.insert(0, [replacement]);
          },
        ],
        'updateDateGroupCondition'
      );
    },
    [database, sharedRoot, view]
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

            if (originalIndex === -1) {
              throw new Error(`Column with id ${columnId} not found in group ${groupId}`);
            }

            const beforeColumnIndex =
              beforeColumnId === undefined ? -1 : columnArray.findIndex((column) => column.id === beforeColumnId);

            if (beforeColumnId !== undefined && beforeColumnIndex === -1) {
              throw new Error(`Column with id ${beforeColumnId} not found in group ${groupId}`);
            }

            const targetIndex = beforeColumnId === undefined ? 0 : beforeColumnIndex + 1;
            const column = cloneYDatabaseGroupColumn(groupColumns.get(originalIndex));

            if (!column) throw new Error(`Column with id ${columnId} is invalid`);

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

function setGroupColumnsHidden({
  allowDynamicColumn = false,
  columnIds,
  fieldId,
  fields,
  groupId,
  hidden,
  mirrorBoardUngrouped = true,
  view,
}: {
  allowDynamicColumn?: boolean;
  columnIds: readonly string[];
  fieldId: string;
  fields: YDatabaseFields | undefined;
  groupId: string;
  hidden: boolean;
  mirrorBoardUngrouped?: boolean;
  view: YDatabaseView;
}) {
  const groups = view.get(YjsDatabaseKey.groups);

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

  const requestedColumnIds = new Set(columnIds.filter(Boolean));

  if (requestedColumnIds.size === 0) return;

  const columnsById = new Map<string, { column: unknown; index: number }>();

  columns.toArray().forEach((column, index) => {
    const id = getDatabaseGroupColumnId(column);

    if (id && !columnsById.has(id)) columnsById.set(id, { column, index });
  });

  const missingRequestedColumnIds = [...requestedColumnIds].filter((id) => !columnsById.has(id));

  if (missingRequestedColumnIds.length > 0) {
    const field = fields?.get(fieldId);
    const fallbackColumns = field ? getGroupColumns(field) ?? [] : [];
    const fallbackColumnIds = new Set(fallbackColumns.map((column) => column.id));

    if (!allowDynamicColumn) {
      const invalidColumnId = missingRequestedColumnIds.find((id) => !fallbackColumnIds.has(id));

      if (invalidColumnId) throw new Error(`Column with id ${invalidColumnId} not found in group ${groupId}`);
    }

    const additions: ReturnType<typeof createYDatabaseGroupColumn>[] = [];
    const appendColumn = (id: string) => {
      if (columnsById.has(id)) return;

      const column = createYDatabaseGroupColumn({ id });
      const index = columns.length + additions.length;

      additions.push(column);
      columnsById.set(id, { column, index });
    };

    fallbackColumns.forEach((column) => appendColumn(column.id));
    if (allowDynamicColumn) missingRequestedColumnIds.forEach(appendColumn);
    if (additions.length > 0) columns.insert(columns.length, additions);
  }

  requestedColumnIds.forEach((columnId) => {
    const entry = columnsById.get(columnId);

    if (!entry) throw new Error(`Column with id ${columnId} not found in group ${groupId}`);

    if (entry.column instanceof Y.Map) {
      entry.column.set(YjsDatabaseKey.visible, !hidden);
      return;
    }

    const normalized = normalizeDatabaseGroupColumn(entry.column);

    if (!normalized) throw new Error(`Column with id ${columnId} is invalid`);
    columns.delete(entry.index);
    columns.insert(entry.index, [
      createYDatabaseGroupColumn({
        groupColor: normalized.groupColor,
        id: normalized.id,
        visible: !hidden,
      }),
    ]);
  });

  if (mirrorBoardUngrouped && requestedColumnIds.has(fieldId)) {
    getOrCreateBoardLayoutSetting(view).set(YjsDatabaseKey.hide_ungrouped_column, hidden);
  }
}

function setGroupColumnHidden({
  columnId,
  ...options
}: Omit<Parameters<typeof setGroupColumnsHidden>[0], 'columnIds'> & { columnId: string }) {
  setGroupColumnsHidden({ ...options, columnIds: [columnId] });
}

export function useSyncDatabaseGroupColumnsDispatch(groupId?: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (activeGroupIds: readonly string[]) => {
      if (!view || !groupId) return;

      const uniqueGroupIds = [...new Set(activeGroupIds.filter(Boolean))];
      const group = view
        .get(YjsDatabaseKey.groups)
        ?.toArray()
        .find((candidate) => candidate.get(YjsDatabaseKey.id) === groupId);
      const columns = group?.get(YjsDatabaseKey.groups);

      if (!columns) return;

      const currentColumns = columns.toArray();
      const currentGroupIds = new Set<string>();
      const currentGroupIdOrder: string[] = [];
      let hasDuplicateOrInvalidColumns = false;

      currentColumns.forEach((column) => {
        const id = getDatabaseGroupColumnId(column);

        if (!id || currentGroupIds.has(id)) {
          hasDuplicateOrInvalidColumns = true;
          return;
        }

        currentGroupIds.add(id);
        currentGroupIdOrder.push(id);
      });
      const missingGroupIds = uniqueGroupIds.filter((id) => !currentGroupIds.has(id));
      const legacyColumns = currentColumns.filter(
        (column) => !(column instanceof Y.Map) || !column.has(YjsDatabaseKey.visible)
      );
      const isNumberGroup = Number(group?.get(YjsDatabaseKey.type)) === FieldType.Number;
      const hasCanonicalNumberOrder =
        !isNumberGroup || uniqueGroupIds.every((id, index) => currentGroupIdOrder[index] === id);
      const alreadyCanonical =
        missingGroupIds.length === 0 &&
        legacyColumns.length === 0 &&
        !hasDuplicateOrInvalidColumns &&
        hasCanonicalNumberOrder;

      if (alreadyCanonical) return;

      executeOperations(
        sharedRoot,
        [
          () => {
            const latestGroup = view
              .get(YjsDatabaseKey.groups)
              ?.toArray()
              .find((candidate) => candidate.get(YjsDatabaseKey.id) === groupId);
            const latestColumns = latestGroup?.get(YjsDatabaseKey.groups);

            if (!latestColumns) return;

            const seenColumnIds = new Set<string>();
            const redundantColumnIndexes: number[] = [];

            latestColumns.toArray().forEach((column, index) => {
              const id = getDatabaseGroupColumnId(column);

              if (!id || seenColumnIds.has(id)) {
                redundantColumnIndexes.push(index);
                return;
              }

              seenColumnIds.add(id);
            });
            redundantColumnIndexes.reverse().forEach((index) => latestColumns.delete(index));

            latestColumns.toArray().forEach((column, index) => {
              const existing = normalizeDatabaseGroupColumn(column);

              if (!existing || (column instanceof Y.Map && column.has(YjsDatabaseKey.visible))) return;

              latestColumns.delete(index);
              latestColumns.insert(index, [
                createYDatabaseGroupColumn({
                  groupColor: existing.groupColor,
                  id: existing.id,
                  visible: existing.visible,
                }),
              ]);
            });
            if (Number(latestGroup?.get(YjsDatabaseKey.type)) === FieldType.Number) {
              // Desktop keeps the default Number group first and inserts dynamic
              // ranges by their numeric start. The selector supplies that desired
              // order; reconcile it without replacing columns already in place so
              // visibility and color metadata retain their Y.Map identity.
              uniqueGroupIds.forEach((id, targetIndex) => {
                const currentIndex = latestColumns
                  .toArray()
                  .findIndex((column) => getDatabaseGroupColumnId(column) === id);

                if (currentIndex === targetIndex) return;

                const column =
                  currentIndex === -1
                    ? createYDatabaseGroupColumn({ id })
                    : cloneYDatabaseGroupColumn(latestColumns.get(currentIndex));

                if (!column) return;
                if (currentIndex !== -1) latestColumns.delete(currentIndex);
                latestColumns.insert(Math.min(targetIndex, latestColumns.length), [column]);
              });
            } else {
              const latestColumnIds = new Set(latestColumns.toArray().map(getDatabaseGroupColumnId));
              const missingColumns = uniqueGroupIds
                .filter((id) => !latestColumnIds.has(id))
                .map((id) => createYDatabaseGroupColumn({ id }));

              if (missingColumns.length > 0) latestColumns.insert(latestColumns.length, missingColumns);
            }
          },
        ],
        'syncDatabaseGroupColumns'
      );
    },
    [groupId, sharedRoot, view]
  );
}

export function useSyncGridGroupColumnsDispatch(groupId?: string) {
  return useSyncDatabaseGroupColumnsDispatch(groupId);
}

export function useSyncListGroupColumnsDispatch(groupId?: string) {
  return useSyncDatabaseGroupColumnsDispatch(groupId);
}

function readShownEmptyGroupIds(layoutSetting: YDatabaseBoardLayoutSetting) {
  const storedIds = layoutSetting.get(YjsDatabaseKey.shown_empty_group_ids) as unknown;
  const ids = storedIds instanceof Y.Array ? storedIds.toArray() : Array.isArray(storedIds) ? storedIds : [];

  return new Set(ids.filter((id): id is string => typeof id === 'string'));
}

function setEmptyGroupOverride(layoutSetting: YDatabaseBoardLayoutSetting, columnId: string, shown: boolean) {
  const shownIds = readShownEmptyGroupIds(layoutSetting);

  if (shownIds.has(columnId) === shown) return;

  if (shown) {
    shownIds.add(columnId);
  } else {
    shownIds.delete(columnId);
  }

  layoutSetting.set(YjsDatabaseKey.shown_empty_group_ids, [...shownIds].sort());
}

export function useToggleHiddenGroupColumnDispatch(groupId: string, fieldId: string) {
  const view = useDatabaseView();
  const fields = useDatabaseFields();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (columnId: string, hidden: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error('View not found');
            }

            setGroupColumnHidden({ columnId, fieldId, fields, groupId, hidden, view });
            if (hidden) {
              setEmptyGroupOverride(getOrCreateBoardLayoutSetting(view), columnId, false);
            }
          },
        ],
        'hideGroupColumn'
      );
    },
    [fieldId, fields, groupId, sharedRoot, view]
  );
}

export function useSetBoardColumnRenderedDispatch(groupId: string, fieldId: string) {
  const view = useDatabaseView();
  const fields = useDatabaseFields();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (columnId: string, shown: boolean, automaticallyHidden: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error('View not found');
            }

            setGroupColumnHidden({ columnId, fieldId, fields, groupId, hidden: !shown, view });
            setEmptyGroupOverride(getOrCreateBoardLayoutSetting(view), columnId, shown && automaticallyHidden);
          },
        ],
        'setBoardColumnRendered'
      );
    },
    [fieldId, fields, groupId, sharedRoot, view]
  );
}

function getOrCreateBoardLayoutSetting(view: YDatabaseView) {
  let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

  if (!layoutSettings) {
    layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  let layoutSetting = layoutSettings.get('1');

  if (!layoutSetting) {
    layoutSetting = new Y.Map() as YDatabaseBoardLayoutSetting;
    layoutSettings.set('1', layoutSetting);
  }

  return layoutSetting;
}

function getOrCreateDatabaseGroupingLayoutSetting(
  view: YDatabaseView,
  layout: DatabaseViewLayout.Grid | DatabaseViewLayout.List
): YDatabaseGridLayoutSetting | YDatabaseListLayoutSetting {
  let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

  if (!layoutSettings) {
    layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  let layoutSetting = layout === DatabaseViewLayout.List ? layoutSettings.get('4') : layoutSettings.get('0');

  if (!layoutSetting) {
    layoutSetting = new Y.Map() as YDatabaseGridLayoutSetting | YDatabaseListLayoutSetting;
    layoutSettings.set(String(layout), layoutSetting);
  }

  return layoutSetting;
}

export function useToggleDatabaseHideEmptyGroups(layout: DatabaseViewLayout.Grid | DatabaseViewLayout.List) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (hide: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) throw new Error('Unable to toggle database empty groups');
            getOrCreateDatabaseGroupingLayoutSetting(view, layout).set(YjsDatabaseKey.hide_empty_groups, hide);
          },
        ],
        'toggleDatabaseHideEmptyGroups'
      );
    },
    [layout, sharedRoot, view]
  );
}

export function useToggleGridHideEmptyGroups() {
  return useToggleDatabaseHideEmptyGroups(DatabaseViewLayout.Grid);
}

export function useToggleListHideEmptyGroups() {
  return useToggleDatabaseHideEmptyGroups(DatabaseViewLayout.List);
}

export function useSetDatabaseGroupVisibilityDispatch(groupId?: string, fieldId?: string) {
  const view = useDatabaseView();
  const fields = useDatabaseFields();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (columnId: string, visible: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view || !groupId || !fieldId) throw new Error('Database group not found');
            setGroupColumnHidden({
              allowDynamicColumn: true,
              columnId,
              fieldId,
              fields,
              groupId,
              hidden: !visible,
              mirrorBoardUngrouped: false,
              view,
            });
          },
        ],
        'setDatabaseGroupVisibility'
      );
    },
    [fieldId, fields, groupId, sharedRoot, view]
  );
}

export function useSetGridGroupVisibilityDispatch(groupId?: string, fieldId?: string) {
  return useSetDatabaseGroupVisibilityDispatch(groupId, fieldId);
}

export function useSetListGroupVisibilityDispatch(groupId?: string, fieldId?: string) {
  return useSetDatabaseGroupVisibilityDispatch(groupId, fieldId);
}

export function useSetAllDatabaseGroupsVisibilityDispatch(groupId?: string, fieldId?: string) {
  const view = useDatabaseView();
  const fields = useDatabaseFields();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (columnIds: string[], visible: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view || !groupId || !fieldId) throw new Error('Database group not found');
            setGroupColumnsHidden({
              allowDynamicColumn: true,
              columnIds,
              fieldId,
              fields,
              groupId,
              hidden: !visible,
              mirrorBoardUngrouped: false,
              view,
            });
          },
        ],
        'setAllDatabaseGroupsVisibility'
      );
    },
    [fieldId, fields, groupId, sharedRoot, view]
  );
}

export function useSetAllGridGroupsVisibilityDispatch(groupId?: string, fieldId?: string) {
  return useSetAllDatabaseGroupsVisibilityDispatch(groupId, fieldId);
}

export function useSetAllListGroupsVisibilityDispatch(groupId?: string, fieldId?: string) {
  return useSetAllDatabaseGroupsVisibilityDispatch(groupId, fieldId);
}

export function useToggleDatabaseGroupCollapsedDispatch(groupId?: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (columnId: string, collapsed: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            const group = view
              ?.get(YjsDatabaseKey.groups)
              ?.toArray()
              .find((candidate) => candidate.get(YjsDatabaseKey.id) === groupId);

            if (!group) throw new Error('Database group not found');

            const stored = group.get(YjsDatabaseKey.collapsed_group_ids) as unknown;
            const ids = new Set<string>(
              (stored instanceof Y.Array ? stored.toArray() : Array.isArray(stored) ? stored : []).filter(
                (id): id is string => typeof id === 'string'
              )
            );

            if (collapsed) ids.add(columnId);
            else ids.delete(columnId);

            const next = new Y.Array<string>();

            if (ids.size > 0) next.push([...ids]);
            group.set(YjsDatabaseKey.collapsed_group_ids, next);
          },
        ],
        'toggleDatabaseGroupCollapsed'
      );
    },
    [groupId, sharedRoot, view]
  );
}

export function useToggleGridGroupCollapsedDispatch(groupId?: string) {
  return useToggleDatabaseGroupCollapsedDispatch(groupId);
}

export function useToggleListGroupCollapsedDispatch(groupId?: string) {
  return useToggleDatabaseGroupCollapsedDispatch(groupId);
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

            getOrCreateBoardLayoutSetting(view).set(YjsDatabaseKey.collapse_hidden_groups, collapsed);
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
  const fields = useDatabaseFields();
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

            const group = view.get(YjsDatabaseKey.groups)?.toArray()?.[0];
            const fieldId = group?.get(YjsDatabaseKey.field_id);

            // Desktop only reads the ungrouped column's `visible` flag, so the
            // canonical write must go through it; setGroupColumnHidden also
            // mirrors hide_ungrouped_column for older web clients.
            if (group && fieldId) {
              setGroupColumnHidden({
                columnId: fieldId,
                fieldId,
                fields,
                groupId: group.get(YjsDatabaseKey.id),
                hidden: hide,
                view,
              });
              return;
            }

            getOrCreateBoardLayoutSetting(view).set(YjsDatabaseKey.hide_ungrouped_column, hide);
          },
        ],
        'toggleHideUnGrouped'
      );
    },
    [fields, sharedRoot, view]
  );
}

export function useToggleHideEmptyGroups() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (hide: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error('Unable to toggle hide empty groups');
            }

            const layoutSetting = getOrCreateBoardLayoutSetting(view);

            layoutSetting.set(YjsDatabaseKey.hide_empty_groups, hide);
            if (!hide) {
              layoutSetting.set(YjsDatabaseKey.shown_empty_group_ids, []);
            }
          },
        ],
        'toggleHideEmptyGroups'
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
  const rowMap = useRowMap();
  const database = useDatabase();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

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

            if (!field) {
              throw new Error(`Field not found`);
            }

            const fieldType = Number(field.get(YjsDatabaseKey.type));

            if (isAttributionFieldType(fieldType)) {
              if (startColumnId === finishColumnId) {
                reorderRow(rowId, beforeRowId, view);
              }

              return;
            }

            const rowDoc = rowMap?.[rowId];

            if (!rowDoc) {
              throw new Error(`Unable to reorder card`);
            }

            const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

            const cells = row.get(YjsDatabaseKey.cells);
            const isSelectOptionField = [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);
            let cellChanged = false;

            let cell = cells.get(fieldId);

            if (!cell) {
              // if the cell is empty, create a new cell and set data to finishColumnId
              if (isSelectOptionField) {
                cell = createSelectOptionCell(fieldId, fieldType, finishColumnId);
              } else if (fieldType === FieldType.Checkbox) {
                cell = createCheckboxCell(fieldId, finishColumnId);
              }

              if (cell) {
                cells.set(fieldId, cell);
                cellChanged = true;
              }
            } else {
              const cellData = parseYDatabaseCellToCell(cell, field).data;
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
              setCellStoredType(cell, fieldType);
              cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
              cellChanged = newCellData !== cellData;
            }

            if (cellChanged) {
              touchRowAttribution(row, actorUid);
            }

            reorderRow(rowId, beforeRowId, view);
          },
        ],
        'reorderCard'
      );
    },
    [actorUid, database, rowMap, sharedRoot, view]
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
      void deleteOutboxByObjectId(rowId);
      void deleteCollabDB(rowId, { destroyDoc: false });
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
      rowIds.forEach((rowId) => {
        void deleteOutboxByObjectId(rowId);
        void deleteCollabDB(rowId, { destroyDoc: false });
      });
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
  const createSimpleField = (fieldType: FieldType, initTypeOption?: (typeOption: YMapFieldTypeOption) => void) => {
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
      return createSimpleField(FieldType.URL, (typeOption) => {
        typeOption.set(YjsDatabaseKey.url, '');
        typeOption.set(YjsDatabaseKey.content, '');
      });
    case FieldType.Checklist:
      return createSimpleField(FieldType.Checklist);
    case FieldType.LastEditedTime:
      return createSimpleField(FieldType.LastEditedTime);
    case FieldType.CreatedTime:
      return createSimpleField(FieldType.CreatedTime);
    case FieldType.CreatedBy:
      return createSimpleField(FieldType.CreatedBy);
    case FieldType.LastEditedBy:
      return createSimpleField(FieldType.LastEditedBy);
    case FieldType.Relation:
      return createRelationField(fieldId);
    case FieldType.Summary:
      return createSimpleField(FieldType.Summary, (typeOption) => {
        typeOption.set(YjsDatabaseKey.auto_fill, false);
      });
    case FieldType.Translate:
      return createSimpleField(FieldType.Translate, (typeOption) => {
        typeOption.set(YjsDatabaseKey.auto_fill, false);
        typeOption.set(YjsDatabaseKey.language, AITranslateLanguage.English);
      });
    case FieldType.Time:
      return createSimpleField(FieldType.Time);
    case FieldType.Media:
      return createSimpleField(FieldType.Media, (typeOption) => {
        typeOption.set(
          YjsDatabaseKey.content,
          JSON.stringify({
            hide_file_names: true,
          })
        );
      });
    case FieldType.Person:
      return createSimpleField(FieldType.Person, (typeOption) => {
        typeOption.set(YjsDatabaseKey.is_single_select, false);
        typeOption.set(YjsDatabaseKey.fill_with_creator, false);
        typeOption.set(YjsDatabaseKey.disable_notification, false);
        typeOption.set(YjsDatabaseKey.persons, JSON.stringify([]));
      });
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
          setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
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
          setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
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
          setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
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
  const { databaseDoc, getViewIdFromDatabaseId, loadView, bindViewSync } = useDatabaseContext();

  return useCallback(
    (fieldId: string) => {
      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);
      const fieldType = Number(field?.get(YjsDatabaseKey.type));
      const relationOption = field && fieldType === FieldType.Relation ? parseRelationTypeOption(field) : null;

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

      void deleteReciprocalRelationField({
        sourceDatabase: database,
        sourceDatabaseDoc: databaseDoc,
        relationOption,
        loadView,
        getViewIdFromDatabaseId,
        bindViewSync,
      });
    },
    [bindViewSync, database, databaseDoc, getViewIdFromDatabaseId, loadView, sharedRoot]
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
      };

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

// Re-export from the extracted dispatch module.
// Note: re-exporting useNewRowDispatch is necessary because Vite's module
// resolver picks this file (dispatch.ts) over dispatch/index.ts when both
// exist as siblings, while TS picks the folder. Without this re-export the
// two paths resolve to different implementations and silently drift.
export {
  useDuplicateRowDispatch,
  useNewRowDispatch,
  useSoftDeleteRowsDispatch,
  useTrashAwareDeleteRowsDispatch,
} from './dispatch/row';

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

            const wrap = setting.get(YjsDatabaseKey.wrap) ?? DEFAULT_FIELD_WRAP;

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
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowMap();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

  return useCallback(
    (fieldId: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!rowMap) {
              throw new Error(`Row docs not found`);
            }

            const rows = Object.keys(rowMap);
            const fieldType = Number(database.get(YjsDatabaseKey.fields)?.get(fieldId)?.get(YjsDatabaseKey.type));

            if (!rows) {
              throw new Error(`Row orders not found`);
            }

            rows.forEach((rowId) => {
              const rowDoc = rowMap?.[rowId];

              if (!rowDoc) {
                return;
              }

              rowDoc.transact(() => {
                const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
                const row = rowSharedRoot.get(YjsEditorKey.database_row);
                const cells = row.get(YjsDatabaseKey.cells);
                const hadCell = cells.has(fieldId);

                cells.delete(fieldId);

                if (hadCell && !isAttributionFieldType(fieldType)) {
                  touchRowAttribution(row, actorUid);
                }
              });
            });
          },
        ],
        'clearCellsWithFieldDispatch'
      );
    },
    [actorUid, database, rowMap, sharedRoot]
  );
}

export function useDuplicatePropertyDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowMap();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

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

              fieldTypeOptionMap.forEach((fieldTypeOption, typeOptionKey) => {
                const newFieldTypeOption = new Y.Map() as YMapFieldTypeOption;
                const typeOptionFieldType = Number(typeOptionKey) as FieldType;
                const sourceFieldTypeOption = fieldTypeOption as YMapFieldTypeOption;

                sourceFieldTypeOption.forEach((value, key) => {
                  // Reciprocal metadata is owned by the original field. Copying it
                  // would let a deletion of the duplicate orphan or remove the
                  // original's reciprocal in the related database, so the duplicate
                  // starts as a plain one-way relation.
                  if (
                    typeOptionFieldType === FieldType.Relation &&
                    (key === YjsDatabaseKey.is_two_way ||
                      key === YjsDatabaseKey.reciprocal_field_id ||
                      key === YjsDatabaseKey.reciprocal_field_name)
                  ) {
                    return;
                  }

                  // Because rust uses bigint for enum or some other values, so we need to convert it to string
                  // Yjs cannot set bigint value directly
                  if (typeof value === 'bigint') {
                    newFieldTypeOption.set(key, Number(value));
                  } else {
                    newFieldTypeOption.set(key, value);
                  }
                });

                if (typeOptionFieldType === FieldType.Relation) {
                  newFieldTypeOption.set(YjsDatabaseKey.is_two_way, false);
                }

                newFieldTypeOptionMap.set(typeOptionKey, newFieldTypeOption);
              });

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

      const sourceFieldType = Number(database.get(YjsDatabaseKey.fields)?.get(fieldId)?.get(YjsDatabaseKey.type));

      // Duplicating an attribution column creates another projection of the
      // same row metadata; it must not create editable per-field cells.
      if (isAttributionFieldType(sourceFieldType)) return newId;

      if (!rowMap) {
        throw new Error(`Row docs not found`);
      }

      const rows = Object.keys(rowMap);

      if (!rows) {
        throw new Error(`Row orders not found`);
      }

      // Clone cell for each row
      rows.forEach((rowId) => {
        const rowDoc = rowMap?.[rowId];

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
          const newCell = cloneDatabaseCell(fieldType, cell);

          cells.set(newId, newCell);

          if (fieldType !== FieldType.CreatedTime && fieldType !== FieldType.LastEditedTime) {
            touchRowAttribution(rowData, actorUid);
          }
        });
      });

      return newId;
    },
    [actorUid, database, rowMap, sharedRoot]
  );
}

export function useUpdateRowMetaDispatch(rowId: string) {
  const rowMap = useRowMap();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

  const rowDoc = rowMap?.[rowId];

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

        const row = rowSharedRoot.get(YjsEditorKey.database_row);

        if (row) touchRowAttribution(row, actorUid);
      });
    },
    [actorUid, rowDoc, rowId]
  );
}

export { useUpdateCellDispatch, useUpdateStartEndTimeCell } from './dispatch/cell';

function createBoardLayoutSetting() {
  const layoutSetting = new Y.Map() as YDatabaseBoardLayoutSetting;

  layoutSetting.set(YjsDatabaseKey.hide_ungrouped_column, false);
  layoutSetting.set(YjsDatabaseKey.hide_empty_groups, false);
  layoutSetting.set(YjsDatabaseKey.collapse_hidden_groups, true);
  return layoutSetting;
}

function initializeBoardLayoutSetting(view: YDatabaseView) {
  let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

  if (!layoutSettings) {
    layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  if (!layoutSettings.has('1')) {
    layoutSettings.set('1', createBoardLayoutSetting());
  }
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

function hasBoardCompatibleGroup(database: YDatabase, groups: YDatabaseGroups | undefined) {
  if (!groups?.length) return false;

  const fieldId = groups?.get(0)?.get(YjsDatabaseKey.field_id);
  const field = fieldId ? database.get(YjsDatabaseKey.fields)?.get(fieldId) : undefined;
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

  return [FieldType.SingleSelect, FieldType.MultiSelect, FieldType.Checkbox].includes(fieldType);
}

function generateCalendarLayoutSettings(fieldId: FieldId, _defaultTimeSetting: DefaultTimeSetting) {
  const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
  const layoutSetting = createCalendarLayoutSetting(fieldId);

  layoutSettings.set('2', layoutSetting);
  return layoutSettings;
}

function createCalendarLayoutSetting(fieldId: FieldId) {
  const layoutSetting = new Y.Map() as YDatabaseCalendarLayoutSetting;

  layoutSetting.set(YjsDatabaseKey.field_id, fieldId);
  layoutSetting.set(YjsDatabaseKey.layout_ty, CalendarLayout.MonthLayout);
  layoutSetting.set(YjsDatabaseKey.show_week_numbers, true);
  layoutSetting.set(YjsDatabaseKey.show_weekends, true);
  return layoutSetting;
}

function initializeCalendarLayoutSetting(view: YDatabaseView, fieldId: FieldId) {
  let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

  if (!layoutSettings) {
    layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  const calendarSetting = layoutSettings.get('2');

  if (!calendarSetting) {
    layoutSettings.set('2', createCalendarLayoutSetting(fieldId));
  } else if (calendarSetting.get(YjsDatabaseKey.field_id) !== fieldId) {
    calendarSetting.set(YjsDatabaseKey.field_id, fieldId);
  }
}

function getValidCalendarField(database: YDatabase, fieldOrders: YDatabaseFieldOrders, fieldId: FieldId | undefined) {
  if (!fieldId || !fieldOrders.toArray().some((fieldOrder) => fieldOrder.id === fieldId)) return undefined;

  const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

  return Number(field?.get(YjsDatabaseKey.type)) === FieldType.DateTime ? field : undefined;
}

function useEnhanceCalendarLayoutByFieldExists() {
  const database = useDatabase();
  const fields = database.get(YjsDatabaseKey.fields);

  const sharedRoot = useSharedRoot();

  return useCallback(
    (fieldOrders: YDatabaseFieldOrders) => {
      // find date field in all views
      let dateField: YDatabaseField | undefined;

      fieldOrders.forEach((fieldOrder) => {
        const field = fields?.get(fieldOrder.id);

        if (!dateField && [FieldType.DateTime].includes(Number(field?.get(YjsDatabaseKey.type)))) {
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
            setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
            fieldSettings.set(fieldId, setting);
          },
          'newDateTimeField'
        );
      }

      return dateField;
    },
    [database, fields, sharedRoot]
  );
}

/**
 * Hook to add a new database view (Grid, Board, or Calendar tab).
 * Creates a new view tab as a child of the main database page.
 */
interface AddDatabaseViewOptions {
  /** Place the new folder child immediately before this existing database view. */
  insertBeforeViewId?: string;
  /** Validate the returned child in an isolated Y.Doc before applying its update. */
  requireExactCreatedView?: boolean;
}

export function useAddDatabaseView() {
  // databasePageId: The main database page in folder (used as parent for new views)
  const { databasePageId, activeViewId, createDatabaseView, databaseDoc, deletePage, loadViewMeta, isDocumentBlock } =
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
    async (layout: DatabaseViewLayout, nameOverride?: string, options?: AddDatabaseViewOptions) => {
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

      const layoutToViewLayout: Record<DatabaseViewLayout, ViewLayout> = {
        [DatabaseViewLayout.Grid]: ViewLayout.Grid,
        [DatabaseViewLayout.Board]: ViewLayout.Board,
        [DatabaseViewLayout.Calendar]: ViewLayout.Calendar,
        [DatabaseViewLayout.Chart]: ViewLayout.Chart,
        [DatabaseViewLayout.List]: ViewLayout.List,
        [DatabaseViewLayout.Gallery]: ViewLayout.Gallery,
      };
      const layoutToName: Record<DatabaseViewLayout, string> = {
        [DatabaseViewLayout.Grid]: 'Grid',
        [DatabaseViewLayout.Board]: 'Board',
        [DatabaseViewLayout.Calendar]: 'Calendar',
        [DatabaseViewLayout.Chart]: 'Chart',
        [DatabaseViewLayout.List]: 'List',
        [DatabaseViewLayout.Gallery]: 'Gallery',
      };
      const viewLayout = layoutToViewLayout[layout];
      const name = layoutToName[layout];

      const getLastChildViewId = (view: View | null | undefined): string | undefined => {
        const children = view?.children ?? [];

        return children.length > 0 ? children[children.length - 1].view_id : undefined;
      };

      const getInsertionPrevViewId = (view: View | null | undefined, fallbackViewId?: string): string | undefined => {
        const insertBeforeViewId = options?.insertBeforeViewId;
        const children = view?.children ?? [];

        if (insertBeforeViewId) {
          const insertBeforeIndex = children.findIndex((child) => child.view_id === insertBeforeViewId);

          if (insertBeforeIndex >= 0) {
            return insertBeforeIndex > 0 ? children[insertBeforeIndex - 1].view_id : undefined;
          }
        }

        return getLastChildViewId(view) ?? fallbackViewId;
      };

      const { tabsParentViewId, prevViewId } = await (async (): Promise<{
        tabsParentViewId: string;
        prevViewId?: string;
      }> => {
        // Best-effort: fall back to previous behavior if meta lookup isn't available.
        if (!loadViewMeta) {
          return { tabsParentViewId: databasePageId };
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
          return {
            tabsParentViewId: currentMeta.view_id,
            prevViewId: getInsertionPrevViewId(currentMeta),
          };
        }

        const parentId = currentMeta?.parent_view_id;

        if (!parentId) {
          return { tabsParentViewId: databasePageId };
        }

        // If parent is a database container, attach under the container (Scenario 4).
        const parentMeta = await safeLoadViewMeta(parentId);

        if (isDatabaseContainer(parentMeta)) {
          return {
            tabsParentViewId: parentId,
            prevViewId: getInsertionPrevViewId(parentMeta),
          };
        }

        // Embedded databases without a container attach under the document (Scenario 3).
        if (isDocumentBlock) {
          return {
            tabsParentViewId: parentId,
            prevViewId: getInsertionPrevViewId(parentMeta, currentMeta?.view_id),
          };
        }

        // Backward-compatible fallback: attach under the current database view.
        const databasePageMeta =
          currentMeta?.view_id === databasePageId ? currentMeta : await safeLoadViewMeta(databasePageId);

        return {
          tabsParentViewId: databasePageId,
          prevViewId: getInsertionPrevViewId(databasePageMeta),
        };
      })();

      const existingViewIds = new Set(database?.get(YjsDatabaseKey.views)?.keys() ?? []);
      const requiresIsolatedValidation =
        layout === DatabaseViewLayout.Gallery || options?.requireExactCreatedView === true;
      const preRequestState = requiresIsolatedValidation ? Y.encodeStateAsUpdate(databaseDoc) : undefined;

      // Create new view as a child of the database container (or document for embedded linked views).
      const response = await createDatabaseView(requestViewId, {
        parent_view_id: tabsParentViewId,
        prev_view_id: prevViewId,
        database_id: databaseId,
        layout: viewLayout,
        name: nameOverride ?? name,
        embedded: isDocumentBlock ?? false,
      });

      if (requiresIsolatedValidation) {
        const returnedViewWasNew = Boolean(response.view_id) && !existingViewIds.has(response.view_id);
        const databaseUpdate = response.database_update;
        const hasExactDatabaseUpdate =
          Boolean(response.view_id) &&
          response.database_id === databaseId &&
          preRequestState !== undefined &&
          databaseUpdate !== undefined &&
          databaseUpdate.length > 0 &&
          updateCreatesExactDatabaseView({
            databaseId,
            existingViewIds,
            preRequestState,
            update: databaseUpdate,
            viewId: response.view_id,
          });

        if (!hasExactDatabaseUpdate) {
          if (response.view_id && returnedViewWasNew) {
            try {
              await deletePage?.(response.view_id);
            } catch (error) {
              Log.warn('[useAddDatabaseView] failed to compensate an invalid database view', {
                viewId: response.view_id,
                layout,
                error,
              });
            }
          }

          throw new Error(`The server did not return the requested ${name} database view`);
        }
      }

      if (response.database_update?.length) {
        applyYDoc(databaseDoc, new Uint8Array(response.database_update));
      }

      if (layout === DatabaseViewLayout.List) {
        const createdView = database?.get(YjsDatabaseKey.views)?.get(response.view_id);
        const createdViewWasNew = !existingViewIds.has(response.view_id);
        const isExactReturnedView =
          Boolean(response.view_id) &&
          createdViewWasNew &&
          response.database_id === databaseId &&
          Boolean(createdView?.get(YjsDatabaseKey.field_orders));

        if (
          !isExactReturnedView ||
          normalizeCreatedDatabaseListView(databaseDoc, response.view_id) !== response.view_id
        ) {
          if (response.view_id && createdViewWasNew) {
            removeCreatedDatabaseView(databaseDoc, response.view_id);

            try {
              await deletePage?.(response.view_id);
            } catch (error) {
              Log.warn('[useAddDatabaseView] failed to roll back an invalid List view', {
                viewId: response.view_id,
                error,
              });
            }
          }

          throw new Error('The server did not return the requested List database view');
        }
      }

      if (layout === DatabaseViewLayout.Gallery) {
        const createdView = database?.get(YjsDatabaseKey.views)?.get(response.view_id);
        const isExactReturnedView =
          Boolean(response.view_id) &&
          !existingViewIds.has(response.view_id) &&
          Boolean(createdView?.get(YjsDatabaseKey.field_orders));

        if (
          !isExactReturnedView ||
          normalizeCreatedDatabaseGalleryView(databaseDoc, response.view_id) !== response.view_id
        ) {
          if (response.view_id && !existingViewIds.has(response.view_id)) {
            removeCreatedDatabaseView(databaseDoc, response.view_id);

            try {
              await deletePage?.(response.view_id);
            } catch (error) {
              Log.warn('[useAddDatabaseView] failed to roll back an invalid Gallery view', {
                viewId: response.view_id,
                error,
              });
            }
          }

          throw new Error('The server did not return the requested Gallery database view');
        }
      }

      return response.view_id;
    },
    [
      createDatabaseView,
      database,
      databaseDoc,
      databasePageId,
      databaseId,
      activeViewId,
      deletePage,
      loadViewMeta,
      isDocumentBlock,
    ]
  );
}

const DUPLICATED_DATABASE_VIEW_CONFIGURATION_KEYS = [
  YjsDatabaseKey.field_orders,
  YjsDatabaseKey.field_settings,
  YjsDatabaseKey.filters,
  YjsDatabaseKey.groups,
  YjsDatabaseKey.layout_settings,
  YjsDatabaseKey.sorts,
  YjsDatabaseKey.calculations,
] as const;

function cloneDatabaseViewConfigurationValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const clone = new Y.Map<unknown>();

    value.forEach((childValue, key) => {
      clone.set(key, cloneDatabaseViewConfigurationValue(childValue));
    });
    return clone;
  }

  if (value instanceof Y.Array) {
    const clone = new Y.Array<unknown>();

    clone.push(value.toArray().map(cloneDatabaseViewConfigurationValue));
    return clone;
  }

  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map(cloneDatabaseViewConfigurationValue);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
        key,
        cloneDatabaseViewConfigurationValue(childValue),
      ])
    );
  }

  return value;
}

export function copyDatabaseViewConfiguration(
  source: YDatabaseView,
  target: YDatabaseView,
  canonicalRowOrders?: YDatabaseRowOrders
) {
  const sourceMap = source as unknown as Y.Map<unknown>;
  const targetMap = target as unknown as Y.Map<unknown>;

  DUPLICATED_DATABASE_VIEW_CONFIGURATION_KEYS.forEach((key) => {
    const value = sourceMap.get(key);

    if (value === undefined) {
      targetMap.delete(key);
      return;
    }

    targetMap.set(key, cloneDatabaseViewConfigurationValue(value));
  });

  const sourceRowOrders = source.get(YjsDatabaseKey.row_orders);

  if (!sourceRowOrders) {
    targetMap.delete(YjsDatabaseKey.row_orders);
    return;
  }

  const visibleRowOrders = materializeVisibleRowOrders(sourceRowOrders.toJSON(), canonicalRowOrders?.toJSON()) ?? [];
  const copiedRowOrders = new Y.Array() as YDatabaseRowOrders;

  copiedRowOrders.push(
    visibleRowOrders.map((rowOrder) => cloneDatabaseViewConfigurationValue(rowOrder)) as Array<{
      id: RowId;
      height: number;
      is_deleted?: boolean;
    }>
  );
  target.set(YjsDatabaseKey.row_orders, copiedRowOrders);
}

/**
 * Duplicate a database tab while retaining the source database and rows.
 * The server creates the new child view/folder entry; the client then copies
 * the source's per-view configuration into that exact returned view.
 */
export function useDuplicateDatabaseView() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const { databaseDoc, deletePage } = useDatabaseContext();
  const addDatabaseView = useAddDatabaseView();

  return useCallback(
    async (sourceViewId: string, duplicatedName?: string) => {
      const views = database.get(YjsDatabaseKey.views);
      const sourceView = views?.get(sourceViewId);

      if (!views || !sourceView) throw new Error('Database view not found');

      const layout = Number(sourceView.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;
      const targetName = duplicatedName?.trim() || `${sourceView.get(YjsDatabaseKey.name) || 'View'} (Copy)`;
      const existingViewIds = new Set(views.keys());
      let duplicatedViewId: string | undefined;
      let duplicatedViewWasNew = false;

      try {
        duplicatedViewId = await addDatabaseView(layout, targetName, {
          insertBeforeViewId: sourceViewId,
          requireExactCreatedView: true,
        });
        duplicatedViewWasNew = Boolean(duplicatedViewId) && !existingViewIds.has(duplicatedViewId);

        if (!duplicatedViewId || !duplicatedViewWasNew) {
          throw new Error('The server did not return a new duplicated database view');
        }

        const duplicatedView = views.get(duplicatedViewId);
        const exactDuplicatedViewId = (duplicatedView as unknown as Y.Map<unknown> | undefined)?.get(YjsDatabaseKey.id);

        if (!duplicatedView || exactDuplicatedViewId !== duplicatedViewId) {
          throw new Error('Duplicated database view not found');
        }

        const canonicalRowOrders = getInlineViewRowOrders(database);

        executeOperations(
          sharedRoot,
          [() => copyDatabaseViewConfiguration(sourceView, duplicatedView, canonicalRowOrders)],
          'duplicateDatabaseView'
        );
      } catch (error) {
        if (!duplicatedViewId || !duplicatedViewWasNew) throw error;

        removeCreatedDatabaseView(databaseDoc, duplicatedViewId);

        try {
          await deletePage?.(duplicatedViewId);
        } catch (rollbackError) {
          Log.warn('[useDuplicateDatabaseView] failed to roll back duplicated view', {
            viewId: duplicatedViewId,
            error: rollbackError,
          });
        }

        throw error;
      }

      if (!duplicatedViewId) throw new Error('Duplicated database view not found');

      return duplicatedViewId;
    },
    [addDatabaseView, database, databaseDoc, deletePage, sharedRoot]
  );
}

export function useUpdateDatabaseLayout(viewId: string) {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  const enhanceCalendarLayoutByFieldExists = useEnhanceCalendarLayoutByFieldExists();

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

            const currentLayout = Number(view.get(YjsDatabaseKey.layout));

            if (currentLayout === layout) {
              return;
            }

            const fieldOrders = view.get(YjsDatabaseKey.field_orders);

            if (layout === DatabaseViewLayout.Board) {
              const groups = view.get(YjsDatabaseKey.groups);

              if (!hasBoardCompatibleGroup(database, groups)) {
                view.set(YjsDatabaseKey.groups, generateBoardGroup(database, fieldOrders));
              }

              initializeBoardLayoutSetting(view);
            }

            if (layout === DatabaseViewLayout.Calendar) {
              const calendarSetting = view.get(YjsDatabaseKey.layout_settings)?.get('2');
              const configuredFieldId = calendarSetting?.get(YjsDatabaseKey.field_id);
              const configuredField = getValidCalendarField(database, fieldOrders, configuredFieldId);
              const dateField: YDatabaseField | undefined =
                configuredField ?? enhanceCalendarLayoutByFieldExists(fieldOrders);
              const fieldId = dateField?.get(YjsDatabaseKey.id);

              if (!fieldId) {
                throw new Error(`Date field not found`);
              }

              initializeCalendarLayoutSetting(view, fieldId);
            }

            if (layout === DatabaseViewLayout.List) {
              const groups = view.get(YjsDatabaseKey.groups);

              if (groups?.length) groups.delete(0, groups.length);
              initializeListLayoutSetting(view);
            }

            if (layout === DatabaseViewLayout.Gallery) {
              initializeGalleryLayoutSetting(view);
            }

            if (currentLayout === DatabaseViewLayout.Board && layout === DatabaseViewLayout.Grid) {
              const groups = view.get(YjsDatabaseKey.groups);

              if (groups?.length) groups.delete(0, groups.length);
            }

            if (
              currentLayout === DatabaseViewLayout.List &&
              layout !== DatabaseViewLayout.List &&
              layout !== DatabaseViewLayout.Board
            ) {
              const groups = view.get(YjsDatabaseKey.groups);

              if (groups?.length) groups.delete(0, groups.length);
            }

            view.set(YjsDatabaseKey.layout, layout);
          },
        ],
        'updateDatabaseLayout'
      );
    },
    [database, enhanceCalendarLayoutByFieldExists, sharedRoot, viewId]
  );
}

export function useUpdateGalleryLayoutSettings() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (changes: Partial<GalleryLayoutSettings> & { coverFieldId?: string | null }) => {
      if (!view) return;

      executeOperations(
        sharedRoot,
        [
          () => {
            const gallery = initializeGalleryLayoutSetting(view);

            if (changes.showCover !== undefined) gallery.set(YjsDatabaseKey.show_cover, changes.showCover);
            if (changes.fitImage !== undefined) gallery.set(YjsDatabaseKey.fit_image, changes.fitImage);
            if (changes.cardSize !== undefined) gallery.set(YjsDatabaseKey.card_size, changes.cardSize);
            if (changes.cardWidth !== undefined) gallery.set(YjsDatabaseKey.card_width, changes.cardWidth);
            if (changes.cardPreview !== undefined) gallery.set(YjsDatabaseKey.card_preview, changes.cardPreview);
            if (changes.coverFieldId !== undefined) {
              if (changes.coverFieldId) gallery.set(YjsDatabaseKey.cover_field_id, changes.coverFieldId);
              else gallery.delete(YjsDatabaseKey.cover_field_id);
            }
          },
        ],
        'updateGalleryLayoutSettings'
      );
    },
    [sharedRoot, view]
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
      // Attempt to remove the view from the folder (move to trash).
      // This is a secondary cleanup — the primary operation is the Yjs deletion below.
      // Database views may not exist in the folder (created via collab sync without a
      // corresponding folder entry), or the folder's space ancestry may be broken.
      // In either case we log the failure and proceed with the Yjs deletion so the
      // user is never stuck with an undeletable view tab.
      try {
        await deletePage?.(viewId);
      } catch (e) {
        Log.warn('[useDeleteView] Failed to move view to trash, proceeding with Yjs deletion:', e);
      }

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

const FIELD_SWITCH_ROW_LOAD_CONCURRENCY = 8;
const fieldSwitchRequestVersions = new WeakMap<YDatabase, Map<FieldId, number>>();

function beginFieldSwitchRequest(database: YDatabase, fieldId: FieldId): number {
  let versions = fieldSwitchRequestVersions.get(database);

  if (!versions) {
    versions = new Map();
    fieldSwitchRequestVersions.set(database, versions);
  }

  const version = (versions.get(fieldId) ?? 0) + 1;

  versions.set(fieldId, version);
  return version;
}

function isCurrentFieldSwitchRequest(database: YDatabase, fieldId: FieldId, version: number): boolean {
  return fieldSwitchRequestVersions.get(database)?.get(fieldId) === version;
}

function getFieldSwitchDatabaseRow(rowDoc?: YDoc): YDatabaseRow | undefined {
  return rowDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
}

function getFieldSwitchCellData(rowDoc: YDoc, fieldId: FieldId, field: YDatabaseField): unknown {
  const row = getFieldSwitchDatabaseRow(rowDoc);
  const cell = row?.get(YjsDatabaseKey.cells)?.get(fieldId);

  return cell ? parseYDatabaseCellToCell(cell, field).data : undefined;
}

function collectDatabaseRowIds(database: YDatabase, loadedRows: Record<RowId, YDoc>): RowId[] {
  const rowIds = new Set<RowId>(Object.keys(loadedRows));
  const views = database.get(YjsDatabaseKey.views);

  views?.forEach((view) => {
    const rowOrders = view.get(YjsDatabaseKey.row_orders)?.toArray() as Array<{ id?: RowId }> | undefined;

    rowOrders?.forEach(({ id }) => {
      if (id) rowIds.add(id);
    });
  });

  return Array.from(rowIds);
}

function fieldSwitchRequiresEveryRow(sourceType: FieldType, targetType: FieldType): boolean {
  if (sourceType === targetType) return false;

  if (sourceType === FieldType.CreatedTime || sourceType === FieldType.LastEditedTime) {
    return true;
  }

  if (
    [FieldType.CreatedBy, FieldType.LastEditedBy].includes(sourceType) ||
    [FieldType.CreatedBy, FieldType.LastEditedBy].includes(targetType)
  ) {
    return true;
  }

  return (
    (targetType === FieldType.SingleSelect || targetType === FieldType.MultiSelect) &&
    (sourceType === FieldType.RichText || sourceType === FieldType.Checklist)
  );
}

async function loadFieldSwitchRowDocs({
  rowMap,
  rowIds,
  ensureRow,
}: {
  rowMap: Record<RowId, YDoc>;
  rowIds: RowId[];
  ensureRow?: (rowId: RowId) => Promise<YDoc | undefined> | void;
}): Promise<Record<RowId, YDoc>> {
  const rowDocs = { ...rowMap };
  const missingRowIds = rowIds.filter((rowId) => !getFieldSwitchDatabaseRow(rowDocs[rowId]));

  if (missingRowIds.length === 0) return rowDocs;
  if (!ensureRow) throw new Error('Cannot switch field type before every database row is available');

  for (let index = 0; index < missingRowIds.length; index += FIELD_SWITCH_ROW_LOAD_CONCURRENCY) {
    const batch = missingRowIds.slice(index, index + FIELD_SWITCH_ROW_LOAD_CONCURRENCY);
    const loaded = await Promise.all(
      batch.map(async (rowId) => {
        const openedRowDoc = await ensureRow(rowId);

        if (!openedRowDoc) {
          throw new Error(`Database row ${rowId} could not be opened for the field-type switch`);
        }

        const rowDoc = await waitForDatabaseRowHydration(openedRowDoc);

        if (!rowDoc) {
          throw new Error(`Database row ${rowId} did not hydrate before the field-type switch`);
        }

        return [rowId, rowDoc] as const;
      })
    );

    loaded.forEach(([rowId, rowDoc]) => {
      rowDocs[rowId] = rowDoc;
    });
  }

  return rowDocs;
}

export function useSwitchPropertyType() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowMap();
  const { databaseDoc, loadView, getViewIdFromDatabaseId, bindViewSync, ensureRow } = useDatabaseContext();

  return useCallback(
    (fieldId: string, fieldType: FieldType) => {
      if (!rowMap) {
        throw new Error(`Row docs not found`);
      }

      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      const sourceType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
      const requestVersion = beginFieldSwitchRequest(database, fieldId);

      if (sourceType === fieldType) return Promise.resolve();

      const rowIds = collectDatabaseRowIds(database, rowMap);

      const performSwitch = (resolvedRowMap: Record<RowId, YDoc>) => {
        const rows = Object.keys(resolvedRowMap);

        // Capture the relation option before the switch so we can clean up the
        // reciprocal field in the related database when leaving Relation. After
        // the switch, the type_option for Relation may be cleared/replaced and
        // the reciprocal pointer is no longer reachable from this field.
        const fieldBefore = database.get(YjsDatabaseKey.fields)?.get(fieldId);
        const oldFieldTypeBefore = fieldBefore ? Number(fieldBefore.get(YjsDatabaseKey.type)) : null;
        const relationOptionToCleanUp =
          fieldBefore && oldFieldTypeBefore === FieldType.Relation && fieldType !== FieldType.Relation
            ? parseRelationTypeOption(fieldBefore)
            : null;

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
                  FieldType.CreatedBy,
                  FieldType.LastEditedBy,
                  FieldType.Media,
                  FieldType.Translate,
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
                    newTypeOption.set(YjsDatabaseKey.content, JSON.stringify({ disable_color: false, options: [] }));
                  } else if (fieldType === FieldType.URL) {
                    newTypeOption.set(YjsDatabaseKey.content, '');
                  } else if (fieldType === FieldType.Translate) {
                    newTypeOption.set(YjsDatabaseKey.language, AITranslateLanguage.English);
                  } else if (fieldType === FieldType.Media) {
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

                // Desktop transforms the target type option on every switch,
                // including when an older target entry already exists.
                if ([FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
                  const targetTypeOption = typeOptionMap.get(String(fieldType));
                  const target = parseSelectOptionTypeOptions(field, fieldType);
                  let options = [...(target.options ?? [])];

                  switch (oldFieldType) {
                    case FieldType.SingleSelect:
                    case FieldType.MultiSelect:
                      options = [...(parseSelectOptionTypeOptions(field, oldFieldType).options ?? [])];
                      break;

                    case FieldType.Checkbox:
                      if (!options.some((option) => option.name === 'Yes')) {
                        options.push({
                          id: nanoid(6),
                          name: 'Yes',
                          color: SelectOptionColor.OptionColor7,
                        });
                      }

                      if (!options.some((option) => option.name === 'No')) {
                        options.push({
                          id: nanoid(6),
                          name: 'No',
                          color: SelectOptionColor.OptionColor5,
                        });
                      }

                      break;

                    case FieldType.RichText:
                      {
                        const names = new Set(options.map((option) => option.name));

                        Object.keys(resolvedRowMap).forEach((rowId) => {
                          const rowDoc = resolvedRowMap[rowId];

                          if (!rowDoc) return;
                          const data = getFieldSwitchCellData(rowDoc, fieldId, field);

                          if (typeof data !== 'string') return;
                          data.split(',').forEach((item) => {
                            const name = item.trim();

                            if (!name || names.has(name)) return;
                            names.add(name);
                            options.push({
                              id: nanoid(6),
                              name,
                              color: Object.values(SelectOptionColor)[options.length % 10],
                            });
                          });
                        });
                      }

                      break;

                    case FieldType.Checklist: {
                      const generated = new Map<string, SelectOption>();

                      Object.keys(resolvedRowMap).forEach((rowId) => {
                        const rowDoc = resolvedRowMap[rowId];

                        if (!rowDoc) return;
                        const data = getFieldSwitchCellData(rowDoc, fieldId, field);
                        const checklist = typeof data === 'string' ? parseChecklistData(data) : null;

                        checklist?.options?.forEach((option) => {
                          if (option.name && !generated.has(option.name)) {
                            generated.set(option.name, option);
                          }
                        });
                      });

                      const names = new Set(options.map((option) => option.name));

                      generated.forEach((option, name) => {
                        if (names.has(name)) return;
                        names.add(name);
                        options.push(option);
                      });
                      break;
                    }
                  }

                  targetTypeOption?.set(
                    YjsDatabaseKey.content,
                    JSON.stringify({
                      ...target,
                      disable_color: 'disable_color' in target ? target.disable_color : false,
                      options,
                    })
                  );
                }
              }

              // When leaving Relation, drop reciprocal metadata from the preserved
              // Relation type_option entry. The reciprocal field in the related
              // database is being deleted in the post-switch cleanup; without
              // clearing this, a later switch back to Relation would skip
              // reciprocal recreation (because reciprocal_field_id is already set)
              // and silently break two-way sync.
              if (oldFieldType === FieldType.Relation && fieldType !== FieldType.Relation) {
                const relationTypeOption = typeOptionMap?.get(String(FieldType.Relation));

                if (relationTypeOption) {
                  relationTypeOption.delete(YjsDatabaseKey.reciprocal_field_id);
                  relationTypeOption.delete(YjsDatabaseKey.reciprocal_field_name);
                  relationTypeOption.set(YjsDatabaseKey.is_two_way, false);
                }
              }

              field.set(YjsDatabaseKey.type, fieldType);

              const lastModified = field.get(YjsDatabaseKey.last_modified);
              const createdAt = field.get(YjsDatabaseKey.created_at);
              const currentName = field.get(YjsDatabaseKey.name);
              const oldDefaultName = getFieldName(oldFieldType);
              const isNewField =
                createdAt !== undefined && lastModified !== undefined && String(createdAt) === String(lastModified);

              // Only auto-rename for untouched default fields (desktop parity).
              if (isNewField && (!currentName || currentName === oldDefaultName)) {
                field.set(YjsDatabaseKey.name, getFieldName(fieldType));
              }

              field.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

              rows.forEach((row) => {
                const rowDoc = resolvedRowMap[row];

                if (!rowDoc) {
                  return;
                }

                rowDoc.transact(() => {
                  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
                  const row = rowSharedRoot.get(YjsEditorKey.database_row);

                  if (!row) return;

                  const cells = row.get(YjsDatabaseKey.cells);
                  const cell = cells.get(fieldId);

                  // Attribution values live only on the row map. Never retain an
                  // editable cell when entering the type or materialize the actor
                  // into a normal cell when leaving it.
                  if (
                    [FieldType.CreatedBy, FieldType.LastEditedBy].includes(oldFieldType) ||
                    [FieldType.CreatedBy, FieldType.LastEditedBy].includes(fieldType)
                  ) {
                    cells.delete(fieldId);
                    return;
                  }

                  // Created/LastEditedTime fields have no cell data of their own —
                  // the timestamp lives on the row meta. Materialize it into the
                  // cell so the value survives the switch (desktop parity:
                  // switch_to_field_type writes row.created_at / row.modified_at
                  // into the cell before transforming).
                  if (oldFieldType === FieldType.CreatedTime || oldFieldType === FieldType.LastEditedTime) {
                    const timestamp =
                      oldFieldType === FieldType.CreatedTime
                        ? row.get(YjsDatabaseKey.created_at)
                        : row.get(YjsDatabaseKey.last_modified);
                    const materialized = cell ?? (new Y.Map() as YDatabaseCell);

                    if (!cell) {
                      cells.set(fieldId, materialized);
                    }

                    // Desktop keeps the cell type aligned with the raw payload's
                    // encoding. The field carries the new presentation type.
                    materialized.set(YjsDatabaseKey.field_type, oldFieldType);
                    materialized.delete(YjsDatabaseKey.source_field_type);
                    materialized.set(
                      YjsDatabaseKey.data,
                      timestamp !== undefined && timestamp !== null ? String(timestamp) : ''
                    );
                    materialized.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

                    return;
                  }

                  // New switches follow Desktop's model and leave ordinary cells
                  // untouched. Older Web cells stored the true data format in
                  // source_field_type; normalize only that legacy metadata so
                  // Desktop can decode it through cell.field_type as well.
                  if (cell) {
                    normalizeLegacyCellFieldType(cell);
                  }
                });
              });
            },
          ],
          'switchPropertyType'
        );

        if (relationOptionToCleanUp) {
          void deleteReciprocalRelationField({
            sourceDatabase: database,
            sourceDatabaseDoc: databaseDoc,
            relationOption: relationOptionToCleanUp,
            loadView,
            getViewIdFromDatabaseId,
            bindViewSync,
          });
        }
      };

      const requiresEveryRow = fieldSwitchRequiresEveryRow(sourceType, fieldType);
      const everyRowIsLoaded = rowIds.every((rowId) => Boolean(getFieldSwitchDatabaseRow(rowMap[rowId])));

      if (!requiresEveryRow || everyRowIsLoaded) {
        performSwitch(rowMap);
        return Promise.resolve();
      }

      // These conversions derive schema/cell data from every row. Change the
      // field only after off-screen row collabs hydrate, so a partial rowMap
      // cannot make Desktop and Web persist different results.
      const loadRowsAndSwitch = async () => {
        let resolvedRowMap = rowMap;
        let rowSetIsStable = false;

        while (!rowSetIsStable) {
          const latestRowIds = collectDatabaseRowIds(database, resolvedRowMap);

          resolvedRowMap = await loadFieldSwitchRowDocs({
            rowMap: resolvedRowMap,
            rowIds: latestRowIds,
            ensureRow,
          });

          if (!isCurrentFieldSwitchRequest(database, fieldId, requestVersion)) {
            throw new Error('Field-type switch was superseded by a newer request');
          }

          // No await occurs between this stability check and performSwitch, so
          // another Yjs event cannot insert an unprocessed row before commit.
          const stableRowIds = collectDatabaseRowIds(database, resolvedRowMap);

          rowSetIsStable = stableRowIds.every((rowId) => Boolean(getFieldSwitchDatabaseRow(resolvedRowMap[rowId])));
        }

        performSwitch(resolvedRowMap);
      };

      return loadRowsAndSwitch().catch((error: unknown) => {
        Log.warn('[useSwitchPropertyType] Field type was not changed', {
          fieldId,
          fieldType,
          error,
        });
        throw error;
      });
    },
    [bindViewSync, database, databaseDoc, ensureRow, getViewIdFromDatabaseId, loadView, sharedRoot, rowMap]
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

            const typeOption = typeOptionMap.get(String(FieldType.Translate));

            if (!typeOption) {
              const newTypeOption = new Y.Map() as YMapFieldTypeOption;

              newTypeOption.set(YjsDatabaseKey.language, language);

              typeOptionMap.set(String(FieldType.Translate), newTypeOption);
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

            const column = columns.toArray().find((candidate) => getDatabaseGroupColumnId(candidate) === optionId);

            if (!column) {
              columns.push([createYDatabaseGroupColumn({ id: optionId })]);
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
            const columnIndex = columns
              .toArray()
              .findIndex((candidate) => getDatabaseGroupColumnId(candidate) === optionId);

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
      visualization_type?: RollupShowAsType;
      visualization_color?: string;
      visualization_divisor?: number;
      visualization_show_number?: boolean;
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

            if (updates.visualization_type !== undefined) {
              typeOption.set(YjsDatabaseKey.rollup_show_as_type, updates.visualization_type);
            }

            if (updates.visualization_color !== undefined) {
              typeOption.set(YjsDatabaseKey.rollup_show_as_color, updates.visualization_color);
            }

            if (updates.visualization_divisor !== undefined) {
              typeOption.set(YjsDatabaseKey.rollup_show_as_divisor, updates.visualization_divisor);
            }

            if (updates.visualization_show_number !== undefined) {
              typeOption.set(YjsDatabaseKey.rollup_show_as_show_number, updates.visualization_show_number);
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
            const conditionData = getDefaultFilterCondition(fieldType, field);

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
            const rollupTargetFieldType = resolveRollupFilterTargetFieldType(fieldType, field);

            if (rollupTargetFieldType !== undefined) {
              filter.set(YjsDatabaseKey.rollup_target_type, rollupTargetFieldType);
            }

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

            // fieldId identifies the filter target; field changes use a separate
            // rebuild path. Ignore delayed updates aimed at a previous field.
            if (filter.get(YjsDatabaseKey.field_id) !== fieldId) {
              Log.debug('[useUpdateFilter] Skipping stale filter update', { filterId, fieldId });
              return;
            }

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

            const typeOption = typeOptionMap.get(String(FieldType.Media));

            if (!typeOption) {
              const newTypeOption = new Y.Map() as YMapFieldTypeOption;

              newTypeOption.set(
                YjsDatabaseKey.content,
                JSON.stringify({
                  hide_file_names: hideFileNames,
                })
              );
              typeOptionMap.set(String(FieldType.Media), newTypeOption);
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

// Re-export advanced filter hooks from modular dispatch
export {
  useEnterAdvancedMode,
  useUpdateRootFilterType,
  useAddAdvancedFilter,
  useRemoveAdvancedFilter,
  useUpdateAdvancedFilter,
  useExitAdvancedMode,
  useClearAllFilters,
  useRebuildFilterTree,
  useAddAdvancedFilterAndRebuild,
  useRemoveAdvancedFilterAndRebuild,
  useUpdateAdvancedFilterAndRebuild,
} from './dispatch/sort-filter';

export interface ChartLayoutSetting {
  chartType?: number;
  xFieldId?: string;
  showEmptyValues?: boolean;
  aggregationType?: number;
  yFieldId?: string;
  cumulative?: boolean;
  dateCondition?: number;
}

export function useUpdateChartSetting() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (settings: Partial<ChartLayoutSetting>) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error(`Unable to update chart settings`);
            }

            let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

            if (!layoutSettings) {
              layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
              view.set(YjsDatabaseKey.layout_settings, layoutSettings);
            }

            let layoutSetting = layoutSettings.get('3') as Y.Map<unknown> | undefined;

            if (!layoutSetting) {
              layoutSetting = new Y.Map();
              layoutSettings.set('3', layoutSetting as unknown as YDatabaseChartLayoutSetting);
            }

            if (settings.chartType !== undefined) {
              layoutSetting.set('chartType', settings.chartType);
            }

            if (settings.xFieldId !== undefined) {
              layoutSetting.set('xFieldId', settings.xFieldId);
            }

            if (settings.showEmptyValues !== undefined) {
              layoutSetting.set('showEmptyValues', settings.showEmptyValues);
            }

            if (settings.aggregationType !== undefined) {
              layoutSetting.set('aggregationType', settings.aggregationType);
            }

            if (settings.yFieldId !== undefined) {
              layoutSetting.set('yFieldId', settings.yFieldId);
            }

            if (settings.cumulative !== undefined) {
              layoutSetting.set('cumulative', settings.cumulative);
            }

            if (settings.dateCondition !== undefined) {
              layoutSetting.set('dateCondition', settings.dateCondition);
            }
          },
        ],
        'updateChartSetting'
      );
    },
    [sharedRoot, view]
  );
}
