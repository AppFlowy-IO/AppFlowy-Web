import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldVisibility,
  FieldType,
  useBoardLayoutSettings,
  useGroup,
} from '@/application/database-yjs';
import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useReorderGroupColumnDispatch,
  useSetAllGridGroupsVisibilityDispatch,
  useSetAllListGroupsVisibilityDispatch,
  useSetBoardColumnRenderedDispatch,
  useSetGridGroupVisibilityDispatch,
  useSetListGroupVisibilityDispatch,
  useSyncGridGroupColumnsDispatch,
  useToggleGridGroupCollapsedDispatch,
  useToggleGridHideEmptyGroups,
  useToggleListGroupCollapsedDispatch,
  useToggleListHideEmptyGroups,
  useToggleHiddenGroupColumnDispatch,
  useToggleHideEmptyGroups,
  useToggleHideUnGrouped,
  useUpdateDatabaseLayout,
} from '@/application/database-yjs/dispatch';
import { useGroupByFieldDispatch as useGroupByFieldDispatchCompatibility } from '@/application/database-yjs/dispatch/group';
import { DatabaseViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import type { ReactNode } from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => undefined,
}));

function createDatabaseDoc({
  fieldId,
  groupId,
  groupColumns,
  includeLayoutSettings = true,
  viewId,
}: {
  fieldId: string;
  groupId: string;
  groupColumns: unknown[];
  includeLayoutSettings?: boolean;
  viewId: string;
}): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const fields = new Y.Map();
  const field = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const groups = new Y.Array();
  const group = new Y.Map();
  const columns = new Y.Array();

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  fields.set(fieldId, field);

  columns.push(groupColumns);
  group.set(YjsDatabaseKey.id, groupId);
  group.set(YjsDatabaseKey.field_id, fieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);

  view.set(YjsDatabaseKey.groups, groups);
  if (includeLayoutSettings) {
    const layoutSettings = new Y.Map();
    const boardLayoutSetting = new Y.Map();

    boardLayoutSetting.set(YjsDatabaseKey.hide_empty_groups, false);
    layoutSettings.set('1', boardLayoutSetting);
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  views.set(viewId, view);

  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function createWrapper(databaseDoc: YDoc, activeViewId: string) {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: activeViewId,
    activeViewId,
    rowMap: null,
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useGroup', () => {
  it('uses one canonical grouping dispatch through the compatibility module', () => {
    expect(useGroupByFieldDispatchCompatibility).toBe(useGroupByFieldDispatch);
  });

  it.each<[FieldType, string[]]>([
    [FieldType.RichText, ['field-id']],
    [FieldType.Number, ['field-id']],
    [FieldType.URL, ['field-id']],
    [FieldType.Checkbox, ['Yes', 'No']],
    [FieldType.SingleSelect, ['field-id']],
    [FieldType.MultiSelect, ['field-id']],
    [FieldType.DateTime, ['field-id']],
  ])('creates desktop-compatible Grid group settings for field type %s', (fieldType, expectedColumnIds) => {
    const fieldId = 'field-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId: 'old-group', groupColumns: [], viewId });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);

    view?.set(YjsDatabaseKey.layout, 0);
    view?.get(YjsDatabaseKey.groups)?.delete(0, 1);
    field?.set(YjsDatabaseKey.type, fieldType);
    const { result } = renderHook(useGroupByFieldDispatch, { wrapper: createWrapper(databaseDoc, viewId) });

    act(() => result.current(fieldId));

    const group = view?.get(YjsDatabaseKey.groups)?.get(0);

    expect(group?.get(YjsDatabaseKey.type)).toBe(fieldType);
    expect(group?.get(YjsDatabaseKey.groups)?.toJSON()).toEqual(expectedColumnIds.map((id) => ({ id, visible: true })));
    expect(
      group
        ?.get(YjsDatabaseKey.groups)
        ?.toArray()
        .every((column) => column instanceof Y.Map)
    ).toBe(true);
    expect(group?.get(YjsDatabaseKey.collapsed_group_ids)?.toArray()).toEqual([]);
    expect(group?.get(YjsDatabaseKey.content)).toBe(
      fieldType === FieldType.DateTime ? JSON.stringify({ hide_empty: false, condition: 0 }) : ''
    );
    expect(view?.get(YjsDatabaseKey.layout_settings)?.get('0')?.get(YjsDatabaseKey.hide_empty_groups)).toBe(true);
  });

  it('can clear and immediately regroup by the same field with a fresh desktop-compatible setting', () => {
    const fieldId = 'field-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId: 'old-group', groupColumns: [], viewId });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const { result } = renderHook(
      () => ({
        clear: useClearGroupByFieldDispatch(),
        groupBy: useGroupByFieldDispatch(),
      }),
      { wrapper: createWrapper(databaseDoc, viewId) }
    );

    act(() => {
      result.current.clear();
      result.current.groupBy(fieldId);
    });

    const group = view?.get(YjsDatabaseKey.groups)?.get(0);

    expect(view?.get(YjsDatabaseKey.groups)?.length).toBe(1);
    expect(group?.get(YjsDatabaseKey.id)).not.toBe('old-group');
    expect(group?.get(YjsDatabaseKey.field_id)).toBe(fieldId);
    expect(
      group
        ?.get(YjsDatabaseKey.groups)
        ?.toArray()
        .every((column) => column instanceof Y.Map)
    ).toBe(true);
  });

  it('preserves an existing Grid filter on the grouping field', () => {
    const fieldId = 'field-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId: 'old-group', groupColumns: [], viewId });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const filters = new Y.Array<Y.Map<unknown>>();
    const filter = new Y.Map<unknown>();

    filter.set(YjsDatabaseKey.id, 'priority-vip-filter');
    filter.set(YjsDatabaseKey.field_id, fieldId);
    filter.set(YjsDatabaseKey.content, 'VIP');
    filters.push([filter]);
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
    view?.set(YjsDatabaseKey.filters, filters);
    view?.get(YjsDatabaseKey.groups)?.delete(0, 1);
    const { result } = renderHook(useGroupByFieldDispatch, { wrapper: createWrapper(databaseDoc, viewId) });

    act(() => result.current(fieldId));

    expect(view?.get(YjsDatabaseKey.groups)?.get(0)?.get(YjsDatabaseKey.field_id)).toBe(fieldId);
    expect(view?.get(YjsDatabaseKey.filters)?.length).toBe(1);
    expect(view?.get(YjsDatabaseKey.filters)?.get(0)).toBe(filter);
    expect(filter.get(YjsDatabaseKey.content)).toBe('VIP');
  });

  it('preserves a List filter and initializes List hide-empty metadata when grouping', () => {
    const fieldId = 'field-id';
    const viewId = 'list-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId: 'old-group', groupColumns: [], viewId });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const filters = new Y.Array<Y.Map<unknown>>();
    const filter = new Y.Map<unknown>();

    filter.set(YjsDatabaseKey.id, 'list-filter');
    filter.set(YjsDatabaseKey.field_id, fieldId);
    filter.set(YjsDatabaseKey.content, 'VIP');
    filters.push([filter]);
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.List);
    view?.set(YjsDatabaseKey.filters, filters);
    view?.get(YjsDatabaseKey.groups)?.delete(0, 1);
    const { result } = renderHook(useGroupByFieldDispatch, { wrapper: createWrapper(databaseDoc, viewId) });

    act(() => result.current(fieldId));

    expect(view?.get(YjsDatabaseKey.groups)?.get(0)?.get(YjsDatabaseKey.field_id)).toBe(fieldId);
    expect(view?.get(YjsDatabaseKey.filters)?.toArray()).toEqual([filter]);
    expect(view?.get(YjsDatabaseKey.layout_settings)?.get('4')?.get(YjsDatabaseKey.hide_empty_groups)).toBe(true);
    expect(view?.get(YjsDatabaseKey.layout_settings)?.has('0')).toBe(false);
  });

  it('retains the existing Board behavior of removing a filter on the grouping field', () => {
    const fieldId = 'field-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId: 'old-group', groupColumns: [], viewId });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const filters = new Y.Array<Y.Map<unknown>>();
    const filter = new Y.Map<unknown>();

    filter.set(YjsDatabaseKey.id, 'priority-vip-filter');
    filter.set(YjsDatabaseKey.field_id, fieldId);
    filter.set(YjsDatabaseKey.content, 'VIP');
    filters.push([filter]);
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    view?.set(YjsDatabaseKey.filters, filters);
    view?.get(YjsDatabaseKey.groups)?.delete(0, 1);
    const { result } = renderHook(useGroupByFieldDispatch, { wrapper: createWrapper(databaseDoc, viewId) });

    act(() => result.current(fieldId));

    expect(view?.get(YjsDatabaseKey.groups)?.get(0)?.get(YjsDatabaseKey.field_id)).toBe(fieldId);
    expect(view?.get(YjsDatabaseKey.filters)?.length).toBe(0);
  });

  it('migrates legacy group objects and preserves desktop group metadata while syncing dynamic IDs', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [
        { id: fieldId, visible: true },
        { group_color: 'appflowy_tint5', id: 'A', visible: false },
        { id: 'stale', visible: true },
      ],
      viewId,
    });
    const { result } = renderHook(() => useSyncGridGroupColumnsDispatch(groupId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current([fieldId, 'A', 'B']));

    const columns = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId)
      ?.get(YjsDatabaseKey.groups)
      ?.get(0)
      ?.get(YjsDatabaseKey.groups);

    expect(columns?.toJSON()).toEqual([
      { id: fieldId, visible: true },
      { group_color: 'appflowy_tint5', id: 'A', visible: false },
      { id: 'stale', visible: true },
      { id: 'B', visible: true },
    ]);
    expect(columns?.toArray().every((column) => column instanceof Y.Map)).toBe(true);
  });

  it('deduplicates concurrently appended group maps while preserving the first map metadata', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const firstA = new Y.Map();
    const duplicateA = new Y.Map();

    firstA.set(YjsDatabaseKey.id, 'A');
    firstA.set(YjsDatabaseKey.visible, false);
    firstA.set(YjsDatabaseKey.group_color, 'appflowy_tint5');
    duplicateA.set(YjsDatabaseKey.id, 'A');
    duplicateA.set(YjsDatabaseKey.visible, true);
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [{ id: fieldId, visible: true }, firstA, duplicateA, {}],
      viewId,
    });
    const { result } = renderHook(() => useSyncGridGroupColumnsDispatch(groupId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current([fieldId, 'A']));

    const columns = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId)
      ?.get(YjsDatabaseKey.groups)
      ?.get(0)
      ?.get(YjsDatabaseKey.groups);

    expect(columns?.toJSON()).toEqual([
      { id: fieldId, visible: true },
      { group_color: 'appflowy_tint5', id: 'A', visible: false },
    ]);
    expect(columns?.get(1)).toBe(firstA);
  });

  it('reorders nested group maps without losing visibility or group color', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const groupA = new Y.Map();
    const groupB = new Y.Map();

    groupA.set(YjsDatabaseKey.id, 'A');
    groupA.set(YjsDatabaseKey.visible, false);
    groupA.set(YjsDatabaseKey.group_color, 'appflowy_tint5');
    groupB.set(YjsDatabaseKey.id, 'B');
    groupB.set(YjsDatabaseKey.visible, true);
    const databaseDoc = createDatabaseDoc({ fieldId, groupId, groupColumns: [groupA, groupB], viewId });
    const { result } = renderHook(() => useReorderGroupColumnDispatch(groupId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current('B'));

    const columns = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId)
      ?.get(YjsDatabaseKey.groups)
      ?.get(0)
      ?.get(YjsDatabaseKey.groups);

    expect(columns?.toJSON()).toEqual([
      { id: 'B', visible: true },
      { group_color: 'appflowy_tint5', id: 'A', visible: false },
    ]);
    expect(columns?.toArray().every((column) => column instanceof Y.Map)).toBe(true);
  });

  it('falls back to default group columns when persisted board columns are empty', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [],
      viewId,
    });

    const { result } = renderHook(() => useGroup(groupId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    await waitFor(() => {
      expect(result.current.fieldId).toBe(fieldId);
    });

    expect(result.current.columns).toEqual([{ id: fieldId, visible: true, visibleExplicit: false }]);
  });

  it('persists dynamic Grid group visibility even when the group was generated from cell data', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId, groupColumns: [{ id: fieldId, visible: true }], viewId });
    const { result } = renderHook(() => useSetGridGroupVisibilityDispatch(groupId, fieldId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current('dynamic-text-value', false));

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const columns = database
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId)
      ?.get(YjsDatabaseKey.groups)
      ?.get(0)
      ?.get(YjsDatabaseKey.groups);

    expect(columns?.toJSON()).toEqual([
      { id: fieldId, visible: true },
      { id: 'dynamic-text-value', visible: false },
    ]);
  });

  it('can hide and restore every non-default Grid group in one transaction', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [
        { id: fieldId, visible: true },
        { id: 'A', visible: true },
        { id: 'B', visible: true },
      ],
      viewId,
    });
    const { result } = renderHook(() => useSetAllGridGroupsVisibilityDispatch(groupId, fieldId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });
    const getColumns = () =>
      databaseDoc
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database)
        ?.get(YjsDatabaseKey.views)
        ?.get(viewId)
        ?.get(YjsDatabaseKey.groups)
        ?.get(0)
        ?.get(YjsDatabaseKey.groups)
        ?.toJSON();

    act(() => result.current(['A', 'B'], false));
    expect(getColumns()).toEqual([
      { id: fieldId, visible: true },
      { id: 'A', visible: false },
      { id: 'B', visible: false },
    ]);

    act(() => result.current(['A', 'B'], true));
    expect(getColumns()).toEqual([
      { id: fieldId, visible: true },
      { id: 'A', visible: true },
      { id: 'B', visible: true },
    ]);
  });

  it('scans Grid group columns once when changing bulk visibility', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const dynamicGroupIds = Array.from({ length: 250 }, (_, index) => `group-${index}`);
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [{ id: fieldId, visible: true }, ...dynamicGroupIds.map((id) => ({ id, visible: true }))],
      viewId,
    });
    const columns = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId)
      ?.get(YjsDatabaseKey.groups)
      ?.get(0)
      ?.get(YjsDatabaseKey.groups);
    const columnsToArray = jest.spyOn(columns, 'toArray');
    const { result } = renderHook(() => useSetAllGridGroupsVisibilityDispatch(groupId, fieldId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    columnsToArray.mockClear();
    act(() => result.current(dynamicGroupIds, false));

    expect(columnsToArray).toHaveBeenCalledTimes(1);
    expect(
      columns
        ?.toJSON()
        .slice(1)
        .every(({ visible }: { visible?: boolean }) => visible === false)
    ).toBe(true);
    columnsToArray.mockRestore();
  });

  it('persists Grid hide-empty and per-group collapse settings without changing Board settings', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId, groupColumns: [{ id: fieldId, visible: true }], viewId });
    const { result } = renderHook(
      () => ({
        toggleCollapse: useToggleGridGroupCollapsedDispatch(groupId),
        toggleHideEmpty: useToggleGridHideEmptyGroups(),
      }),
      { wrapper: createWrapper(databaseDoc, viewId) }
    );

    act(() => {
      result.current.toggleHideEmpty(true);
      result.current.toggleCollapse('A', true);
    });

    const view = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId);

    expect(view?.get(YjsDatabaseKey.layout_settings)?.get('0')?.get(YjsDatabaseKey.hide_empty_groups)).toBe(true);
    expect(view?.get(YjsDatabaseKey.layout_settings)?.get('1')?.get(YjsDatabaseKey.hide_empty_groups)).toBe(false);
    expect(view?.get(YjsDatabaseKey.groups)?.get(0)?.get(YjsDatabaseKey.collapsed_group_ids)?.toArray()).toEqual(['A']);

    act(() => result.current.toggleCollapse('A', false));
    expect(view?.get(YjsDatabaseKey.groups)?.get(0)?.get(YjsDatabaseKey.collapsed_group_ids)?.toArray()).toEqual([]);
  });

  it('persists List grouping visibility, hide-empty, and collapse through List dispatch aliases', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'list-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [
        { id: fieldId, visible: true },
        { id: 'A', visible: true },
        { id: 'B', visible: true },
      ],
      viewId,
    });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);

    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.List);
    const { result } = renderHook(
      () => ({
        setAllVisibility: useSetAllListGroupsVisibilityDispatch(groupId, fieldId),
        setVisibility: useSetListGroupVisibilityDispatch(groupId, fieldId),
        toggleCollapse: useToggleListGroupCollapsedDispatch(groupId),
        toggleHideEmpty: useToggleListHideEmptyGroups(),
      }),
      { wrapper: createWrapper(databaseDoc, viewId) }
    );

    act(() => {
      result.current.setVisibility('A', false);
      result.current.setAllVisibility(['B'], false);
      result.current.toggleCollapse('A', true);
      result.current.toggleHideEmpty(false);
    });

    expect(view?.get(YjsDatabaseKey.groups)?.get(0)?.get(YjsDatabaseKey.groups)?.toJSON()).toEqual([
      { id: fieldId, visible: true },
      { id: 'A', visible: false },
      { id: 'B', visible: false },
    ]);
    expect(view?.get(YjsDatabaseKey.groups)?.get(0)?.get(YjsDatabaseKey.collapsed_group_ids)?.toArray()).toEqual(['A']);
    expect(view?.get(YjsDatabaseKey.layout_settings)?.get('4')?.get(YjsDatabaseKey.hide_empty_groups)).toBe(false);
    expect(view?.get(YjsDatabaseKey.layout_settings)?.get('1')?.get(YjsDatabaseKey.hide_empty_groups)).toBe(false);
    expect(view?.get(YjsDatabaseKey.layout_settings)?.has('0')).toBe(false);
  });

  it('removes optional Grid grouping without affecting rows or fields', () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId, groupColumns: [{ id: fieldId, visible: true }], viewId });
    const { result } = renderHook(useClearGroupByFieldDispatch, {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current());

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);

    expect(view?.get(YjsDatabaseKey.groups)?.length).toBe(0);
    expect(database?.get(YjsDatabaseKey.fields)?.has(fieldId)).toBe(true);
  });

  it('clears observed group layout state when the active setting is removed', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'grid-view-id';
    const databaseDoc = createDatabaseDoc({ fieldId, groupId, groupColumns: [{ id: fieldId, visible: false }], viewId });
    const { result } = renderHook(
      () => ({
        clear: useClearGroupByFieldDispatch(),
        layoutSettings: useBoardLayoutSettings(),
      }),
      { wrapper: createWrapper(databaseDoc, viewId) }
    );

    await waitFor(() => {
      expect(result.current.layoutSettings.fieldId).toBe(fieldId);
      expect(result.current.layoutSettings.ungroupedColumnHidden).toBe(true);
    });

    act(() => result.current.clear());

    await waitFor(() => {
      expect(result.current.layoutSettings.fieldId).toBeNull();
      expect(result.current.layoutSettings.ungroupedColumnHidden).toBe(false);
    });
  });

  it('clears the persisted Board grouping when switching to Grid', () => {
    const fieldId = 'field-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId: 'board-group-id',
      groupColumns: [{ id: fieldId, visible: true }],
      viewId,
    });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);

    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    const { result } = renderHook(() => useUpdateDatabaseLayout(viewId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current(DatabaseViewLayout.Grid));

    expect(view?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    expect(view?.get(YjsDatabaseKey.groups)?.length).toBe(0);
  });

  it("converts to an ungrouped List with Desktop's first-three-field visibility default", () => {
    const primaryFieldId = 'field-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId: primaryFieldId,
      groupId: 'board-group-id',
      groupColumns: [{ id: primaryFieldId, visible: true }],
      viewId,
    });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const fields = database?.get(YjsDatabaseKey.fields);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const fieldOrders = new Y.Array<{ id: string }>();
    const nonPrimaryFieldIds = ['field-1', 'field-2', 'field-3', 'field-4', 'field-5'];

    fields?.get(primaryFieldId)?.set(YjsDatabaseKey.is_primary, true);
    nonPrimaryFieldIds.forEach((fieldId) => {
      const field = new Y.Map<unknown>();

      field.set(YjsDatabaseKey.id, fieldId);
      field.set(YjsDatabaseKey.type, FieldType.RichText);
      fields?.set(fieldId, field);
    });
    fieldOrders.push([primaryFieldId, ...nonPrimaryFieldIds].map((id) => ({ id })));
    view?.set(YjsDatabaseKey.field_orders, fieldOrders);
    view?.set(YjsDatabaseKey.field_settings, new Y.Map());
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    const { result } = renderHook(() => useUpdateDatabaseLayout(viewId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current(DatabaseViewLayout.List));

    const listSetting = view?.get(YjsDatabaseKey.layout_settings)?.get('4');
    const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

    expect(view?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.List);
    expect(view?.get(YjsDatabaseKey.groups)?.length).toBe(0);
    expect(view?.get(YjsDatabaseKey.layout_settings)?.get('1')?.get(YjsDatabaseKey.hide_empty_groups)).toBe(false);
    expect(listSetting?.toJSON()).toEqual({
      card_width: 0,
      display_mode: 1,
      show_cover: true,
      show_field_names: true,
      show_icon: true,
      visible_field_ids: [],
    });
    expect(fieldSettings?.get(primaryFieldId)?.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
    nonPrimaryFieldIds.forEach((fieldId, index) => {
      expect(fieldSettings?.get(fieldId)?.get(YjsDatabaseKey.visibility)).toBe(
        index < 2 ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden
      );
    });
  });

  it("keeps List's primary field visible when it is ordered after Desktop's three-field cutoff", () => {
    const primaryFieldId = 'field-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId: primaryFieldId,
      groupId: 'board-group-id',
      groupColumns: [{ id: primaryFieldId, visible: true }],
      viewId,
    });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const fields = database?.get(YjsDatabaseKey.fields);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const fieldOrders = new Y.Array<{ id: string }>();
    const nonPrimaryFieldIds = ['field-1', 'field-2', 'field-3', 'field-4', 'field-5'];

    fields?.get(primaryFieldId)?.set(YjsDatabaseKey.is_primary, true);
    nonPrimaryFieldIds.forEach((fieldId) => {
      const field = new Y.Map<unknown>();

      field.set(YjsDatabaseKey.id, fieldId);
      field.set(YjsDatabaseKey.type, FieldType.RichText);
      fields?.set(fieldId, field);
    });
    fieldOrders.push(
      [
        nonPrimaryFieldIds[0],
        nonPrimaryFieldIds[1],
        nonPrimaryFieldIds[2],
        nonPrimaryFieldIds[3],
        primaryFieldId,
        nonPrimaryFieldIds[4],
      ].map((id) => ({ id }))
    );
    view?.set(YjsDatabaseKey.field_orders, fieldOrders);
    view?.set(YjsDatabaseKey.field_settings, new Y.Map());
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    const { result } = renderHook(() => useUpdateDatabaseLayout(viewId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current(DatabaseViewLayout.List));

    const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

    expect(fieldSettings?.get(primaryFieldId)?.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
    nonPrimaryFieldIds.forEach((fieldId, index) => {
      expect(fieldSettings?.get(fieldId)?.get(YjsDatabaseKey.visibility)).toBe(
        index < 3 ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden
      );
    });
  });

  it("ignores missing and duplicate field orders before applying List's three-field cutoff", () => {
    const primaryFieldId = 'field-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId: primaryFieldId,
      groupId: 'board-group-id',
      groupColumns: [{ id: primaryFieldId, visible: true }],
      viewId,
    });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const fields = database?.get(YjsDatabaseKey.fields);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const fieldOrders = new Y.Array<{ id: string }>();
    const nonPrimaryFieldIds = ['field-1', 'field-2', 'field-3', 'field-4'];

    fields?.get(primaryFieldId)?.set(YjsDatabaseKey.is_primary, true);
    nonPrimaryFieldIds.forEach((fieldId) => {
      const field = new Y.Map<unknown>();

      field.set(YjsDatabaseKey.id, fieldId);
      field.set(YjsDatabaseKey.type, FieldType.RichText);
      fields?.set(fieldId, field);
    });
    fieldOrders.push(
      [
        'missing-field',
        primaryFieldId,
        primaryFieldId,
        nonPrimaryFieldIds[0],
        nonPrimaryFieldIds[0],
        nonPrimaryFieldIds[1],
        nonPrimaryFieldIds[2],
        nonPrimaryFieldIds[3],
      ].map((id) => ({ id }))
    );
    view?.set(YjsDatabaseKey.field_orders, fieldOrders);
    view?.set(YjsDatabaseKey.field_settings, new Y.Map());
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    const { result } = renderHook(() => useUpdateDatabaseLayout(viewId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => result.current(DatabaseViewLayout.List));

    const fieldSettings = view?.get(YjsDatabaseKey.field_settings);

    expect(fieldSettings?.get(primaryFieldId)?.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
    nonPrimaryFieldIds.forEach((fieldId, index) => {
      expect(fieldSettings?.get(fieldId)?.get(YjsDatabaseKey.visibility)).toBe(
        index < 2 ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden
      );
    });
  });

  it('materializes fallback columns before persisting their visibility', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const optionId = 'option-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [],
      viewId,
    });
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
    const fields = database.get(YjsDatabaseKey.fields) as Y.Map<Y.Map<unknown>>;
    const field = fields.get(fieldId)!;
    const typeOptions = new Y.Map();
    const selectOptions = new Y.Map();

    field.set(YjsDatabaseKey.type_option, typeOptions);
    typeOptions.set(String(FieldType.SingleSelect), selectOptions);
    selectOptions.set(
      YjsDatabaseKey.content,
      JSON.stringify({
        disable_color: false,
        options: [{ id: optionId, name: 'Option', color: 0 }],
      })
    );

    const fallbackColumns = [
      { id: fieldId, visible: true, visibleExplicit: false },
      { id: optionId, visible: true, visibleExplicit: false },
    ];
    const materializedColumns = [
      { id: fieldId, visible: true, visibleExplicit: true },
      { id: optionId, visible: true, visibleExplicit: true },
    ];
    const { result } = renderHook(
      () => ({
        group: useGroup(groupId),
        toggleHidden: useToggleHiddenGroupColumnDispatch(groupId, fieldId),
      }),
      {
        wrapper: createWrapper(databaseDoc, viewId),
      }
    );

    await waitFor(() => {
      expect(result.current.group.columns).toEqual(fallbackColumns);
    });

    expect(() => {
      act(() => {
        result.current.toggleHidden(optionId, false);
      });
    }).not.toThrow();

    await waitFor(() => {
      expect(result.current.group.columns).toEqual(materializedColumns);
    });

    const views = database.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;
    const view = views.get(viewId);
    const groups = view?.get(YjsDatabaseKey.groups) as Y.Array<Y.Map<unknown>>;
    const persistedColumns = groups.get(0).get(YjsDatabaseKey.groups) as Y.Array<unknown>;

    expect(persistedColumns.toJSON()).toEqual([
      { id: fieldId, visible: true },
      { id: optionId, visible: true },
    ]);
  });

  it('normalizes Y.Map group columns from persisted collab data', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const optionId = 'option-id';
    const viewId = 'board-view-id';
    const column = new Y.Map();

    column.set(YjsDatabaseKey.id, optionId);
    column.set(YjsDatabaseKey.visible, false);
    column.set(YjsDatabaseKey.group_color, 'appflowy_tint5');

    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [column],
      viewId,
    });

    const { result } = renderHook(() => useGroup(groupId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    await waitFor(() => {
      expect(result.current.fieldId).toBe(fieldId);
    });

    expect(result.current.columns).toEqual([
      { groupColor: 'appflowy_tint5', id: optionId, visible: false, visibleExplicit: true },
    ]);
  });

  it('derives the ungrouped hidden state from the persisted visible flag written by desktop', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [{ id: fieldId, visible: false }],
      viewId,
    });

    const { result } = renderHook(() => useBoardLayoutSettings(), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    await waitFor(() => {
      expect(result.current.ungroupedColumnHidden).toBe(true);
    });

    expect(result.current.hideUnGroup).toBe(false);
  });

  it('lets an explicit visible flag override a stale legacy hide_ungrouped_column key', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [{ id: fieldId, visible: true }],
      viewId,
    });
    const view = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId);

    view?.get(YjsDatabaseKey.layout_settings)?.get('1')?.set(YjsDatabaseKey.hide_ungrouped_column, true);

    const { result } = renderHook(() => useBoardLayoutSettings(), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    await waitFor(() => {
      expect(result.current.hideUnGroup).toBe(true);
    });

    expect(result.current.ungroupedColumnHidden).toBe(false);
  });

  it('writes the canonical visible flag and mirrors the legacy key when toggling Show ungrouped', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [{ id: fieldId, visible: true }],
      viewId,
    });

    const { result } = renderHook(
      () => ({
        layoutSettings: useBoardLayoutSettings(),
        toggleHideUnGrouped: useToggleHideUnGrouped(),
      }),
      {
        wrapper: createWrapper(databaseDoc, viewId),
      }
    );

    act(() => {
      result.current.toggleHideUnGrouped(true);
    });

    await waitFor(() => {
      expect(result.current.layoutSettings.ungroupedColumnHidden).toBe(true);
    });

    expect(result.current.layoutSettings.hideUnGroup).toBe(true);

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
    const views = database.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;
    const groups = views.get(viewId)?.get(YjsDatabaseKey.groups) as Y.Array<Y.Map<unknown>>;
    const persistedColumns = groups.get(0).get(YjsDatabaseKey.groups) as Y.Array<unknown>;

    expect(persistedColumns.toJSON()).toEqual([{ id: fieldId, visible: false }]);
  });

  it('keeps Hidden Groups collapsed when the collapse setting is absent', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [{ id: fieldId, visible: true }],
      viewId,
    });
    const view = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(viewId);

    view?.get(YjsDatabaseKey.layout_settings)?.get('1')?.set(YjsDatabaseKey.hide_ungrouped_column, true);

    const { result } = renderHook(() => useBoardLayoutSettings(), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    await waitFor(() => {
      expect(result.current.hideUnGroup).toBe(true);
    });

    expect(result.current.isCollapsed).toBe(true);
  });

  it('persists and observes the shared hide empty groups Board setting', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [{ id: fieldId, visible: true }],
      includeLayoutSettings: false,
      viewId,
    });

    const { result } = renderHook(
      () => ({
        layoutSettings: useBoardLayoutSettings(),
        toggleHideEmptyGroups: useToggleHideEmptyGroups(),
      }),
      {
        wrapper: createWrapper(databaseDoc, viewId),
      }
    );

    expect(result.current.layoutSettings.hideEmptyGroups).toBe(false);

    act(() => {
      result.current.toggleHideEmptyGroups(true);
    });

    await waitFor(() => {
      expect(result.current.layoutSettings.hideEmptyGroups).toBe(true);
    });
  });

  it('persists and observes explicitly shown empty Board groups', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const emptyGroupId = 'empty-group-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [{ id: emptyGroupId, visible: true }],
      viewId,
    });

    const { result } = renderHook(
      () => ({
        layoutSettings: useBoardLayoutSettings(),
        setColumnRendered: useSetBoardColumnRenderedDispatch(groupId, fieldId),
        toggleHideEmptyGroups: useToggleHideEmptyGroups(),
      }),
      {
        wrapper: createWrapper(databaseDoc, viewId),
      }
    );

    act(() => {
      result.current.toggleHideEmptyGroups(true);
      result.current.setColumnRendered(emptyGroupId, true, true);
    });

    await waitFor(() => {
      expect(result.current.layoutSettings.shownEmptyGroupIds).toEqual(new Set([emptyGroupId]));
    });

    act(() => {
      result.current.setColumnRendered(emptyGroupId, false, true);
    });

    await waitFor(() => {
      expect(result.current.layoutSettings.shownEmptyGroupIds).toEqual(new Set());
    });

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
    const groups = view?.get(YjsDatabaseKey.groups) as Y.Array<Y.Map<unknown>>;
    const columns = groups.get(0).get(YjsDatabaseKey.groups) as Y.Array<{ id: string; visible: boolean }>;

    expect(columns.toJSON()).toEqual([{ id: emptyGroupId, visible: false }]);
  });
});
