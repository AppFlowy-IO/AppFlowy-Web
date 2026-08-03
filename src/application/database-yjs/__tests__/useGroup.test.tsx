import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  useBoardLayoutSettings,
  useGroup,
} from '@/application/database-yjs';
import { useToggleHideEmptyGroups } from '@/application/database-yjs/dispatch';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
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
});
