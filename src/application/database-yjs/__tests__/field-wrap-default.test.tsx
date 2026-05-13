import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  useFieldsSelector,
  useFieldWrap,
  useTogglePropertyWrapDispatch,
} from '@/application/database-yjs';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFieldSetting,
  YDatabaseFieldSettings,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const fieldId = 'field-id';
const viewId = 'view-id';

function createDatabaseDoc(wrap?: boolean): {
  databaseDoc: YDoc;
  fieldSettings: YDatabaseFieldSettings;
} {
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const field = new Y.Map() as YDatabaseField;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const fieldOrders = new Y.Array<{ id: string }>();
  const fieldSettings = new Y.Map() as YDatabaseFieldSettings;
  const fieldSetting = new Y.Map() as YDatabaseFieldSetting;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.is_primary, true);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set(fieldId, field);

  if (wrap !== undefined) {
    fieldSetting.set(YjsDatabaseKey.wrap, wrap);
  }

  fieldSettings.set(fieldId, fieldSetting);
  fieldOrders.push([{ id: fieldId }]);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  views.set(viewId, view);

  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return {
    databaseDoc,
    fieldSettings,
  };
}

function createContextValue(databaseDoc: YDoc): DatabaseContextState {
  return {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: null,
    workspaceId: 'workspace-id',
  };
}

describe('field wrap default', () => {
  it('defaults selector columns to nowrap when wrap is missing', async () => {
    const { databaseDoc } = createDatabaseDoc();
    const contextValue = createContextValue(databaseDoc);

    const { result } = renderHook(() => useFieldsSelector(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].wrap).toBe(false);
  });

  it('defaults field wrap state to false when wrap is missing', () => {
    const { databaseDoc } = createDatabaseDoc();
    const contextValue = createContextValue(databaseDoc);

    const { result } = renderHook(() => useFieldWrap(fieldId), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    expect(result.current).toBe(false);
  });

  it('toggles a missing wrap setting from false to true', () => {
    const { databaseDoc, fieldSettings } = createDatabaseDoc();
    const contextValue = createContextValue(databaseDoc);

    const { result } = renderHook(() => useTogglePropertyWrapDispatch(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    act(() => {
      result.current(fieldId);
    });

    expect(fieldSettings.get(fieldId)?.get(YjsDatabaseKey.wrap)).toBe(true);
  });

  it('preserves an explicit wrap setting', async () => {
    const { databaseDoc } = createDatabaseDoc(true);
    const contextValue = createContextValue(databaseDoc);

    const { result } = renderHook(() => useFieldsSelector(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].wrap).toBe(true);
  });
});
