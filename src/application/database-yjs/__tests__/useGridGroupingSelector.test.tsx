import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  DateGroupCondition,
  FieldType,
  FilterType,
  SortCondition,
  TextFilterCondition,
  useGroupByFieldDispatch,
  useGridGroupingSelector,
  useUpdateCellDispatch,
  useUpdateDateGroupConditionDispatch,
  useUpdateGroupContentDispatch,
} from '@/application/database-yjs';
import { createYDatabaseGroupColumn } from '@/application/database-yjs/group-column';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseGroup,
  YDatabaseGroupColumns,
  YDatabaseGroups,
  YDatabaseLayoutSettings,
  YDatabaseRow,
  YDatabaseRowOrders,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { useSyncGridGroupingMetadata } from '@/components/database/grid/GridGroupingContext';

import { createCell, createRowDoc } from './test-helpers';

import { StrictMode, type ReactNode, useLayoutEffect, useState } from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createGridGroupingFixture({
  fieldType = FieldType.RichText,
  rowAValue = 'A',
  rowBValue = 'B',
}: {
  fieldType?: FieldType;
  rowAValue?: string;
  rowBValue?: string;
} = {}) {
  const databaseId = 'grid-grouping-database';
  const viewId = 'grid-view';
  const fieldId = 'name';
  const otherFieldId = 'notes';
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;
  const otherField = new Y.Map() as YDatabaseField;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const groups = new Y.Array<YDatabaseGroup>() as YDatabaseGroups;
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
  const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;
  const group = new Y.Map() as YDatabaseGroup;
  const columns = new Y.Array() as YDatabaseGroupColumns;
  const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
  const gridLayoutSetting = new Y.Map();

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Name');
  field.set(YjsDatabaseKey.type, fieldType);
  otherField.set(YjsDatabaseKey.id, otherFieldId);
  otherField.set(YjsDatabaseKey.name, 'Notes');
  otherField.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set(fieldId, field);
  fields.set(otherFieldId, otherField);

  columns.push([createYDatabaseGroupColumn({ id: fieldId })]);
  group.set(YjsDatabaseKey.id, 'group-config');
  group.set(YjsDatabaseKey.field_id, fieldId);
  group.set(YjsDatabaseKey.type, fieldType);
  group.set(YjsDatabaseKey.content, '');
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);

  rowOrders.push([
    { id: 'row-a', height: 36 },
    { id: 'row-b', height: 36 },
  ]);
  gridLayoutSetting.set(YjsDatabaseKey.hide_empty_groups, true);
  layoutSettings.set('0', gridLayoutSetting);
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  view.set(YjsDatabaseKey.groups, groups);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  views.set(viewId, view);

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowA = createRowDoc('row-a', databaseId, {
    [fieldId]: createCell(fieldType, rowAValue),
    [otherFieldId]: createCell(FieldType.RichText, 'before'),
  });
  const rowB = createRowDoc('row-b', databaseId, {
    [fieldId]: createCell(fieldType, rowBValue),
    [otherFieldId]: createCell(FieldType.RichText, 'before'),
  });
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    blobPrefetchComplete: true,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: { 'row-a': rowA, 'row-b': rowB },
    seedsReady: true,
    workspaceId: 'workspace-id',
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
  const updateCell = (rowDoc: YDoc, targetFieldId: string, value: string) => {
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    row.get(YjsDatabaseKey.cells).get(targetFieldId)?.set(YjsDatabaseKey.data, value);
  };

  const setCell = (rowDoc: YDoc, targetFieldId: string, value: string) => {
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = new Y.Map() as YDatabaseCell;

    cell.set(YjsDatabaseKey.field_type, targetFieldId === fieldId ? fieldType : FieldType.RichText);
    cell.set(YjsDatabaseKey.data, value);
    row.get(YjsDatabaseKey.cells).set(targetFieldId, cell);
  };

  const deleteCell = (rowDoc: YDoc, targetFieldId: string) => {
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    row.get(YjsDatabaseKey.cells).delete(targetFieldId);
  };

  return {
    columns,
    contextValue,
    databaseDoc,
    fieldId,
    filters,
    group,
    groups,
    gridLayoutSetting,
    otherField,
    otherFieldId,
    rowA,
    rowB,
    rowOrders,
    sorts,
    setCell,
    deleteCell,
    updateCell,
    view,
    wrapper,
  };
}

describe('useGridGroupingSelector refresh behavior', () => {
  const useGroupingWithMetadataSync = () => {
    const grouping = useGridGroupingSelector();

    useSyncGridGroupingMetadata(grouping);
    return grouping;
  };

  it('refreshes group membership immediately after the grouping cell changes', async () => {
    const fixture = createGridGroupingFixture();
    const { result, unmount } = renderHook(useGridGroupingSelector, { wrapper: fixture.wrapper });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));

    act(() => fixture.updateCell(fixture.rowA, fixture.fieldId, 'B'));

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['B']);
      expect(result.current.visibleGroups[0].rows.map(({ id }) => id)).toEqual(['row-a', 'row-b']);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('observes grouping changes in seed-only row documents', async () => {
    const fixture = createGridGroupingFixture();
    const contextValue: DatabaseContextState = {
      ...fixture.contextValue,
      blobPrefetchComplete: false,
      peekRowDocFromSeed: (rowId) => (rowId === 'row-a' ? fixture.rowA : rowId === 'row-b' ? fixture.rowB : null),
      rowMap: {},
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(useGridGroupingSelector, { wrapper });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));

    act(() => fixture.updateCell(fixture.rowA, fixture.fieldId, 'B'));

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['B']);
      expect(result.current.visibleGroups[0].rows.map(({ id }) => id)).toEqual(['row-a', 'row-b']);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('keeps grouping row observers active across StrictMode effect replay', async () => {
    const fixture = createGridGroupingFixture();
    const FixtureWrapper = fixture.wrapper;
    const StrictWrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <FixtureWrapper>{children}</FixtureWrapper>
      </StrictMode>
    );
    const { result, unmount } = renderHook(useGridGroupingSelector, { wrapper: StrictWrapper });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));

    act(() => fixture.updateCell(fixture.rowA, fixture.fieldId, 'B'));

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['B']);
      expect(result.current.visibleGroups[0].rows.map(({ id }) => id)).toEqual(['row-a', 'row-b']);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('does not serialize row orders for unrelated view or field updates', async () => {
    const fixture = createGridGroupingFixture();
    const rowOrdersToJSON = jest.spyOn(fixture.rowOrders, 'toJSON');
    const { result, unmount } = renderHook(useGridGroupingSelector, { wrapper: fixture.wrapper });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));
    rowOrdersToJSON.mockClear();

    act(() => {
      fixture.view.set(YjsDatabaseKey.name, 'Renamed view');
      fixture.otherField.set(YjsDatabaseKey.name, 'Renamed notes');
    });

    expect(rowOrdersToJSON).not.toHaveBeenCalled();

    unmount();
    rowOrdersToJSON.mockRestore();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('inserts a newly derived Number range in ascending selector and persisted metadata order', async () => {
    const fixture = createGridGroupingFixture({
      fieldType: FieldType.Number,
      rowAValue: '150',
      rowBValue: '175',
    });
    const { result, unmount } = renderHook(useGroupingWithMetadataSync, { wrapper: fixture.wrapper });

    await waitFor(() => {
      expect(result.current.activeGroupIds).toEqual(['name', 'number_range_100_200']);
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'number_range_100_200']);
    });

    act(() => fixture.updateCell(fixture.rowA, fixture.fieldId, '-50'));

    await waitFor(() => {
      expect(result.current.activeGroupIds).toEqual(['name', 'number_range_-100_0', 'number_range_100_200']);
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual([
        'name',
        'number_range_-100_0',
        'number_range_100_200',
      ]);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('rebuilds Date metadata when the grouping condition changes', async () => {
    const localTimestamp = (year: number, month: number, day: number) =>
      String(Math.floor(new Date(year, month - 1, day, 12).getTime() / 1000));
    const fixture = createGridGroupingFixture({
      fieldType: FieldType.DateTime,
      rowAValue: localTimestamp(2024, 1, 15),
      rowBValue: localTimestamp(2024, 1, 20),
    });
    const { result, unmount } = renderHook(
      () => {
        const grouping = useGroupingWithMetadataSync();
        const updateDateCondition = useUpdateDateGroupConditionDispatch();

        return { grouping, updateDateCondition };
      },
      { wrapper: fixture.wrapper }
    );

    act(() => result.current.updateDateCondition(DateGroupCondition.Day));

    await waitFor(() => {
      expect(result.current.grouping.activeGroupIds).toEqual(['name', '2024/01/15', '2024/01/20']);
      expect(
        fixture.groups
          .get(0)
          ?.get(YjsDatabaseKey.groups)
          .toJSON()
          .map(({ id }: { id: string }) => id)
      ).toEqual(['name', '2024/01/15', '2024/01/20']);
    });

    const dayGroupId = fixture.groups.get(0)?.get(YjsDatabaseKey.id);

    act(() => result.current.updateDateCondition(DateGroupCondition.Month));

    await waitFor(() => {
      const monthGroup = fixture.groups.get(0);
      const monthColumnIds = monthGroup
        ?.get(YjsDatabaseKey.groups)
        .toJSON()
        .map(({ id }: { id: string }) => id);

      expect(monthGroup?.get(YjsDatabaseKey.id)).not.toBe(dayGroupId);
      expect(result.current.grouping.activeGroupIds).toEqual(['name', '2024/01/01']);
      expect(monthColumnIds).toEqual(['name', '2024/01/01']);
      expect(monthColumnIds).not.toContain('2024/01/15');
      expect(monthColumnIds).not.toContain('2024/01/20');
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('does not miss a grouping-cell change during commit', async () => {
    const fixture = createGridGroupingFixture();
    const useGroupingWithCommitMutation = () => {
      const grouping = useGridGroupingSelector();

      useLayoutEffect(() => {
        fixture.updateCell(fixture.rowA, fixture.fieldId, 'B');
      }, []);
      return grouping;
    };

    const { result, unmount } = renderHook(useGroupingWithCommitMutation, { wrapper: fixture.wrapper });

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['B']);
      expect(result.current.visibleGroups[0].rows.map(({ id }) => id)).toEqual(['row-a', 'row-b']);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('refreshes membership when a grouping cell is inserted or deleted', async () => {
    const fixture = createGridGroupingFixture();
    const { result, unmount } = renderHook(useGridGroupingSelector, { wrapper: fixture.wrapper });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));

    act(() => fixture.deleteCell(fixture.rowA, fixture.fieldId));

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['name', 'B']);
      expect(result.current.groups.find(({ id }) => id === 'name')?.rows.map(({ id }) => id)).toEqual(['row-a']);
    });

    act(() => fixture.setCell(fixture.rowA, fixture.fieldId, 'C'));

    await waitFor(() => {
      expect(new Set(result.current.visibleGroups.map(({ id }) => id))).toEqual(new Set(['B', 'C']));
      expect(result.current.groups.find(({ id }) => id === 'C')?.rows.map(({ id }) => id)).toEqual(['row-a']);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('does not mutate persisted group metadata after an unrelated cell changes', async () => {
    const fixture = createGridGroupingFixture();
    let renderCount = 0;
    const useTrackedGrouping = () => {
      renderCount += 1;
      return useGroupingWithMetadataSync();
    };

    const { result, unmount } = renderHook(useTrackedGrouping, { wrapper: fixture.wrapper });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));
    await waitFor(() =>
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B'])
    );
    const originalColumns = fixture.columns.toArray();
    const originalGrouping = result.current;
    const settledRenderCount = renderCount;

    act(() => fixture.updateCell(fixture.rowA, fixture.otherFieldId, 'after'));

    expect(result.current.groups.find(({ id }) => id === 'A')?.rows.map(({ id }) => id)).toEqual(['row-a']);
    expect(fixture.columns.toArray()).toEqual(originalColumns);
    expect(result.current).toBe(originalGrouping);
    expect(renderCount).toBe(settledRenderCount);

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('refreshes persisted visibility and collapse state without reloading the view', async () => {
    const fixture = createGridGroupingFixture();
    const { result, unmount } = renderHook(useGridGroupingSelector, { wrapper: fixture.wrapper });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));

    act(() => {
      fixture.columns.push([
        createYDatabaseGroupColumn({ id: 'A', visible: false }),
        createYDatabaseGroupColumn({ id: 'A', visible: true }),
      ]);
      const collapsedIds = new Y.Array<string>();

      fixture.group.set(YjsDatabaseKey.collapsed_group_ids, collapsedIds);
      collapsedIds.push(['B']);
    });

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['B']);
      expect(result.current.groups.filter(({ id }) => id === 'A')).toHaveLength(1);
      expect(result.current.groups.find(({ id }) => id === 'A')?.hidden).toBe(true);
      expect(result.current.groups.find(({ id }) => id === 'B')?.collapsed).toBe(true);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('appends dynamic groups as desktop-compatible Y.Map entries without pruning persisted metadata', async () => {
    const fixture = createGridGroupingFixture();

    fixture.gridLayoutSetting.set(YjsDatabaseKey.hide_empty_groups, false);
    const { result, unmount } = renderHook(useGroupingWithMetadataSync, { wrapper: fixture.wrapper });

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);
      expect(fixture.columns.toArray().every((column) => column instanceof Y.Map)).toBe(true);
    });

    const groupB = fixture.columns.toArray().find((column) => column.get(YjsDatabaseKey.id) === 'B');

    act(() => {
      groupB?.set(YjsDatabaseKey.visible, false);
      groupB?.set(YjsDatabaseKey.group_color, 'appflowy_tint5');
      fixture.updateCell(fixture.rowA, fixture.fieldId, 'C');
    });

    await waitFor(() => {
      expect(fixture.columns.toJSON()).toEqual([
        { id: 'name', visible: true },
        { id: 'A', visible: true },
        { group_color: 'appflowy_tint5', id: 'B', visible: false },
        { id: 'C', visible: true },
      ]);
      // Desktop removes empty row-derived groups. Web retains the shared maps
      // conservatively for cross-client safety, but never renders stale empty
      // dynamic headers even when static empty groups are configured visible.
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['name', 'C']);
    });

    act(() => fixture.updateCell(fixture.rowB, fixture.fieldId, 'C'));

    await waitFor(() => {
      expect(fixture.columns.toJSON()).toEqual([
        { id: 'name', visible: true },
        { id: 'A', visible: true },
        { group_color: 'appflowy_tint5', id: 'B', visible: false },
        { id: 'C', visible: true },
      ]);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('does not prune persisted groups while a newly ordered row is still hydrating', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = createGridGroupingFixture();
    const { result, unmount } = renderHook(useGroupingWithMetadataSync, { wrapper: fixture.wrapper });

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);
    });

    act(() => {
      fixture.databaseDoc.transact(() => {
        fixture.rowOrders.push([{ height: 36, id: 'row-c' }]);
        fixture.columns.push([createYDatabaseGroupColumn({ id: 'C', visible: false })]);
      });
    });

    await waitFor(() => {
      expect(result.current.ready).toBe(false);
      expect(fixture.columns.toJSON()).toContainEqual({ id: 'C', visible: false });
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
    consoleWarn.mockRestore();
  });

  it('initializes dynamic metadata once when Web locally groups existing rows', async () => {
    const fixture = createGridGroupingFixture();

    fixture.groups.delete(0, fixture.groups.length);
    const contextValue: DatabaseContextState = {
      ...fixture.contextValue,
      getCellLocalMutationRevision: () => '0:0',
      hasCellLocalMutation: () => false,
      markCellLocalMutation: () => undefined,
      subscribeToCellLocalMutations: () => () => undefined,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(
      () => {
        const grouping = useGroupingWithMetadataSync();
        const groupByField = useGroupByFieldDispatch();
        const updateGroupContent = useUpdateGroupContentDispatch();

        return { groupByField, grouping, updateGroupContent };
      },
      { wrapper }
    );

    expect(result.current.grouping.isGrouped).toBe(false);

    act(() => result.current.groupByField(fixture.fieldId));

    await waitFor(() => {
      const localColumns = fixture.groups.get(0)?.get(YjsDatabaseKey.groups);

      expect(result.current.grouping.ready).toBe(true);
      expect(localColumns?.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);
      expect(localColumns?.toArray().every((column) => column instanceof Y.Map)).toBe(true);
    });

    const localColumns = fixture.groups.get(0)?.get(YjsDatabaseKey.groups);

    // The provenance is one-shot. A later unproven row-doc change may refresh
    // the UI, but cannot append seed-derived metadata.
    act(() => fixture.updateCell(fixture.rowA, fixture.fieldId, 'C'));

    await waitFor(() => expect(result.current.grouping.activeGroupIds).toContain('C'));
    expect(localColumns?.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);

    act(() => result.current.updateGroupContent('locally-updated-group-config'));

    await waitFor(() => {
      expect(localColumns?.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B', 'C']);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('syncs visible live edits without resurrecting a permanently offscreen seed value', async () => {
    const fixture = createGridGroupingFixture();
    const locallyMutatedCells = new Set<string>();
    const localMutationRevisions = new Map<string, number>();
    const localMutationSubscribersByFieldId = new Map<string, Set<() => void>>();
    const cellKey = (rowId: string, fieldId: string) => `${rowId}\u0000${fieldId}`;

    const markCellLocalMutation = (rowId: string, fieldId: string) => {
      const key = cellKey(rowId, fieldId);

      if (locallyMutatedCells.has(key)) return;

      locallyMutatedCells.add(key);
      localMutationRevisions.set(fieldId, (localMutationRevisions.get(fieldId) ?? 0) + 1);
      localMutationSubscribersByFieldId.get(fieldId)?.forEach((subscriber) => subscriber());
    };

    const contextValue: DatabaseContextState = {
      ...fixture.contextValue,
      getCellLocalMutationRevision: (fieldId) => `0:${localMutationRevisions.get(fieldId) ?? 0}`,
      hasCellLocalMutation: (rowId, fieldId) => locallyMutatedCells.has(cellKey(rowId, fieldId)),
      markCellLocalMutation,
      subscribeToCellLocalMutations: (fieldId, subscriber) => {
        let subscribers = localMutationSubscribersByFieldId.get(fieldId);

        if (!subscribers) {
          subscribers = new Set();
          localMutationSubscribersByFieldId.set(fieldId, subscribers);
        }

        subscribers.add(subscriber);
        return () => {
          subscribers.delete(subscriber);
          if (subscribers.size === 0) localMutationSubscribersByFieldId.delete(fieldId);
        };
      },
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(
      () => {
        const grouping = useGroupingWithMetadataSync();
        const updateRowA = useUpdateCellDispatch('row-a', fixture.fieldId);
        const updateRowAOtherField = useUpdateCellDispatch('row-a', fixture.otherFieldId);
        const updateRowB = useUpdateCellDispatch('row-b', fixture.fieldId);

        return { grouping, updateRowA, updateRowAOtherField, updateRowB };
      },
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.grouping.ready).toBe(true);
      expect(result.current.grouping.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']);
      // Seed values are renderable, but neither has local-write provenance.
      expect(fixture.columns.toJSON()).toEqual([{ id: 'name', visible: true }]);
    });

    const remoteColumns = [
      createYDatabaseGroupColumn({ id: 'name' }),
      createYDatabaseGroupColumn({ groupColor: 'appflowy_tint5', id: 'B', visible: false }),
      createYDatabaseGroupColumn({ id: 'C' }),
    ];

    act(() => {
      fixture.columns.delete(0, fixture.columns.length);
      fixture.columns.insert(0, remoteColumns);
    });

    await waitFor(() => {
      // The stale seed still says A. Keep it local to the conservative UI
      // union, but never append it to Desktop's shared group setting.
      expect(result.current.grouping.activeGroupIds).toEqual(['name', 'B', 'C', 'A']);
    });
    expect(fixture.columns.toArray()).toEqual(remoteColumns);
    const groupingBeforeUnrelatedEdit = result.current.grouping;

    act(() => result.current.updateRowAOtherField('after'));

    await waitFor(() => expect(locallyMutatedCells).toContain(cellKey('row-a', fixture.otherFieldId)));
    expect(result.current.grouping).toBe(groupingBeforeUnrelatedEdit);
    expect(fixture.columns.toArray()).toEqual(remoteColumns);
    expect(fixture.columns.toJSON().some(({ id }: { id: string }) => id === 'A')).toBe(false);

    act(() => result.current.updateRowB('D'));

    await waitFor(() => {
      expect(fixture.columns.toJSON()).toEqual([
        { id: 'name', visible: true },
        { group_color: 'appflowy_tint5', id: 'B', visible: false },
        { id: 'C', visible: true },
        { id: 'D', visible: true },
      ]);
    });
    expect(fixture.columns.toJSON().some(({ id }: { id: string }) => id === 'A')).toBe(false);
    expect(fixture.columns.get(2)).toBe(remoteColumns[2]);

    act(() => result.current.updateRowA('E'));

    await waitFor(() => {
      expect(locallyMutatedCells).toEqual(
        new Set([
          cellKey('row-a', fixture.otherFieldId),
          cellKey('row-b', fixture.fieldId),
          cellKey('row-a', fixture.fieldId),
        ])
      );
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'B', 'C', 'D', 'E']);
    });
    expect(fixture.columns.get(2)).toBe(remoteColumns[2]);
    expect(fixture.columns.toJSON().some(({ id }: { id: string }) => id === 'A')).toBe(false);

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('keeps existing grouping-row observers attached when the row map grows', async () => {
    const fixture = createGridGroupingFixture();
    const rowADataSection = fixture.rowA.getMap(YjsEditorKey.data_section);
    const rowBDataSection = fixture.rowB.getMap(YjsEditorKey.data_section);
    const observeRowA = jest.spyOn(rowADataSection, 'observeDeep');
    const observeRowB = jest.spyOn(rowBDataSection, 'observeDeep');
    const unobserveRowA = jest.spyOn(rowADataSection, 'unobserveDeep');
    const unobserveRowB = jest.spyOn(rowBDataSection, 'unobserveDeep');
    let appendRowToContext: ((rowId: string, rowDoc: YDoc) => void) | undefined;
    const ObserverWrapper = ({ children }: { children: ReactNode }) => {
      const [contextValue, setContextValue] = useState(fixture.contextValue);

      appendRowToContext = (rowId, rowDoc) => {
        setContextValue((current) => ({
          ...current,
          rowMap: { ...current.rowMap, [rowId]: rowDoc },
        }));
      };

      return <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>;
    };

    const { result, unmount } = renderHook(useGridGroupingSelector, { wrapper: ObserverWrapper });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));
    const rowAObserveCount = observeRowA.mock.calls.length;
    const rowBObserveCount = observeRowB.mock.calls.length;
    const rowC = createRowDoc('row-c', fixture.databaseDoc.guid, {
      [fixture.fieldId]: createCell(FieldType.RichText, 'C'),
    });

    act(() => {
      fixture.rowOrders.push([{ height: 36, id: 'row-c' }]);
      appendRowToContext?.('row-c', rowC);
    });

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B', 'C']));
    expect(observeRowA).toHaveBeenCalledTimes(rowAObserveCount);
    expect(observeRowB).toHaveBeenCalledTimes(rowBObserveCount);
    expect(unobserveRowA).not.toHaveBeenCalled();
    expect(unobserveRowB).not.toHaveBeenCalled();

    unmount();
    observeRowA.mockRestore();
    observeRowB.mockRestore();
    unobserveRowA.mockRestore();
    unobserveRowB.mockRestore();
    rowC.destroy();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('keeps metadata for groups temporarily excluded by a filter', async () => {
    const fixture = createGridGroupingFixture();
    const { result, unmount } = renderHook(useGroupingWithMetadataSync, { wrapper: fixture.wrapper });

    await waitFor(() => {
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);
    });

    const groupB = fixture.columns.toArray().find((column) => column.get(YjsDatabaseKey.id) === 'B');

    act(() => {
      groupB?.set(YjsDatabaseKey.visible, false);
      groupB?.set(YjsDatabaseKey.group_color, 'appflowy_tint5');
      fixture.updateCell(fixture.rowA, fixture.otherFieldId, 'Zulu');
      fixture.updateCell(fixture.rowB, fixture.otherFieldId, 'Alpha');
    });

    const filter = new Y.Map() as YDatabaseFilter;

    filter.set(YjsDatabaseKey.id, 'notes-filter');
    filter.set(YjsDatabaseKey.field_id, fixture.otherFieldId);
    filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
    filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextContains);
    filter.set(YjsDatabaseKey.content, 'Zulu');
    act(() => fixture.filters.push([filter]));

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A']);
      expect(result.current.activeGroupIds).toEqual(['name', 'A', 'B']);
      expect(fixture.columns.toJSON()).toContainEqual({
        group_color: 'appflowy_tint5',
        id: 'B',
        visible: false,
      });
    });

    act(() => fixture.filters.delete(0));

    await waitFor(() => {
      expect(result.current.groups.find(({ id }) => id === 'B')?.rows.map(({ id }) => id)).toEqual(['row-b']);
      expect(result.current.groups.find(({ id }) => id === 'B')?.hidden).toBe(true);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('sorts headers only for a primary sort on the grouped field without persisting that display order', async () => {
    const fixture = createGridGroupingFixture();
    const { result, unmount } = renderHook(useGroupingWithMetadataSync, { wrapper: fixture.wrapper });

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']);
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);
    });

    const sort = new Y.Map() as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, 'name-sort');
    sort.set(YjsDatabaseKey.field_id, fixture.fieldId);
    sort.set(YjsDatabaseKey.condition, SortCondition.Descending);
    act(() => fixture.sorts.push([sort]));

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['B', 'A']);
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);
    });

    act(() => fixture.sorts.delete(0));

    await waitFor(() => expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']));

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('keeps persisted header order when the primary sort targets another field', async () => {
    const fixture = createGridGroupingFixture();
    const { result, unmount } = renderHook(useGroupingWithMetadataSync, { wrapper: fixture.wrapper });

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']);
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);
    });

    act(() => {
      fixture.updateCell(fixture.rowA, fixture.otherFieldId, 'Zulu');
      fixture.updateCell(fixture.rowB, fixture.otherFieldId, 'Alpha');
    });

    const sort = new Y.Map() as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, 'notes-sort');
    sort.set(YjsDatabaseKey.field_id, fixture.otherFieldId);
    sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);
    act(() => fixture.sorts.push([sort]));

    await waitFor(() => {
      expect(result.current.rowOrders?.map(({ id }) => id)).toEqual(['row-b', 'row-a']);
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A', 'B']);
      expect(fixture.columns.toJSON().map(({ id }: { id: string }) => id)).toEqual(['name', 'A', 'B']);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });

  it('rebuilds grouped rows when filters and sorts change', async () => {
    const fixture = createGridGroupingFixture();
    const { result, unmount } = renderHook(useGroupingWithMetadataSync, { wrapper: fixture.wrapper });

    act(() => {
      fixture.updateCell(fixture.rowB, fixture.fieldId, 'A');
      fixture.updateCell(fixture.rowA, fixture.otherFieldId, 'Zulu');
      fixture.updateCell(fixture.rowB, fixture.otherFieldId, 'Alpha');
    });

    await waitFor(() => {
      expect(result.current.visibleGroups.map(({ id }) => id)).toEqual(['A']);
      expect(result.current.visibleGroups[0].rows.map(({ id }) => id)).toEqual(['row-a', 'row-b']);
    });

    const sort = new Y.Map() as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, 'notes-sort');
    sort.set(YjsDatabaseKey.field_id, fixture.otherFieldId);
    sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);
    act(() => fixture.sorts.push([sort]));

    await waitFor(() => {
      expect(result.current.visibleGroups[0].rows.map(({ id }) => id)).toEqual(['row-b', 'row-a']);
    });

    const filter = new Y.Map() as YDatabaseFilter;

    filter.set(YjsDatabaseKey.id, 'notes-filter');
    filter.set(YjsDatabaseKey.field_id, fixture.otherFieldId);
    filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
    filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextContains);
    filter.set(YjsDatabaseKey.content, 'Zulu');
    act(() => fixture.filters.push([filter]));

    await waitFor(() => {
      expect(result.current.visibleGroups[0].rows.map(({ id }) => id)).toEqual(['row-a']);
    });

    act(() => fixture.filters.delete(0));

    await waitFor(() => {
      expect(result.current.visibleGroups[0].rows.map(({ id }) => id)).toEqual(['row-b', 'row-a']);
    });

    unmount();
    fixture.rowA.destroy();
    fixture.rowB.destroy();
    fixture.databaseDoc.destroy();
  });
});
