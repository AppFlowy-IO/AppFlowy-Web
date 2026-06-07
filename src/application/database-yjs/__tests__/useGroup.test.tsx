import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, GroupColorOption, useGroup } from '@/application/database-yjs';
import { useUpdateGroupColumnColorDispatch } from '@/application/database-yjs/dispatch';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseDoc({
  fieldId,
  groupId,
  groupColumns,
  viewId,
  fieldType = FieldType.SingleSelect,
}: {
  fieldId: string;
  groupId: string;
  groupColumns: unknown[];
  viewId: string;
  fieldType?: FieldType;
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
  field.set(YjsDatabaseKey.type, fieldType);
  fields.set(fieldId, field);

  columns.push(groupColumns);
  group.set(YjsDatabaseKey.id, groupId);
  group.set(YjsDatabaseKey.field_id, fieldId);
  group.set(YjsDatabaseKey.type, fieldType);
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);

  view.set(YjsDatabaseKey.groups, groups);
  views.set(viewId, view);

  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function getPersistedColumns(databaseDoc: YDoc, viewId: string, groupId: string) {
  const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
  const group = view
    ?.get(YjsDatabaseKey.groups)
    ?.toArray()
    .find((group) => group.get(YjsDatabaseKey.id) === groupId);

  return group?.get(YjsDatabaseKey.groups)?.toArray() ?? [];
}

function toColumnData(column: unknown) {
  if (column && typeof column === 'object' && 'get' in column && typeof column.get === 'function') {
    const mapColumn = column as { get: (key: YjsDatabaseKey) => unknown };

    return {
      id: mapColumn.get(YjsDatabaseKey.id),
      visible: mapColumn.get(YjsDatabaseKey.visible),
      group_color: mapColumn.get(YjsDatabaseKey.group_color),
    };
  }

  return column;
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

  return ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useGroup', () => {
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

    expect(result.current.columns).toEqual([{ id: fieldId, visible: true }]);
  });

  it('normalizes Y.Map group columns from persisted collab data', async () => {
    const fieldId = 'field-id';
    const groupId = 'group-id';
    const optionId = 'option-id';
    const viewId = 'board-view-id';
    const column = new Y.Map();

    column.set(YjsDatabaseKey.id, optionId);
    column.set(YjsDatabaseKey.visible, false);

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

    expect(result.current.columns).toEqual([{ id: optionId, visible: false }]);
  });

  it('persists fallback columns before updating a column color', async () => {
    const fieldId = 'checkbox-field-id';
    const groupId = 'group-id';
    const viewId = 'board-view-id';
    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [],
      viewId,
      fieldType: FieldType.Checkbox,
    });

    const { result } = renderHook(() => useUpdateGroupColumnColorDispatch(groupId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => {
      result.current('Yes', GroupColorOption.Camellia);
    });

    expect(getPersistedColumns(databaseDoc, viewId, groupId)).toEqual([
      { id: 'Yes', visible: true, group_color: GroupColorOption.Camellia },
      { id: 'No', visible: true },
    ]);
  });

  it('updates color on persisted Y.Map group columns', async () => {
    const fieldId = 'checkbox-field-id';
    const groupId = 'group-id';
    const viewId = 'board-view-id';
    const yesColumn = new Y.Map();
    const noColumn = new Y.Map();

    yesColumn.set(YjsDatabaseKey.id, 'Yes');
    yesColumn.set(YjsDatabaseKey.visible, true);
    noColumn.set(YjsDatabaseKey.id, 'No');
    noColumn.set(YjsDatabaseKey.visible, true);

    const databaseDoc = createDatabaseDoc({
      fieldId,
      groupId,
      groupColumns: [yesColumn, noColumn],
      viewId,
      fieldType: FieldType.Checkbox,
    });

    const { result } = renderHook(() => useUpdateGroupColumnColorDispatch(groupId), {
      wrapper: createWrapper(databaseDoc, viewId),
    });

    act(() => {
      result.current('Yes', GroupColorOption.Olive);
    });

    expect(getPersistedColumns(databaseDoc, viewId, groupId).map(toColumnData)).toEqual([
      { id: 'Yes', visible: true, group_color: GroupColorOption.Olive },
      { id: 'No', visible: true, group_color: undefined },
    ]);
  });
});
