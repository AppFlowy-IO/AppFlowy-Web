import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  useCalendarEventsSelector,
  useFieldCellsSelector,
  useRowPrimaryContentSelector,
} from '@/application/database-yjs';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRowOrders,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const fieldId = 'field-id';

function createFixture() {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const field = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map();
  const multiSelectOption = new Y.Map();

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Measurements');
  field.set(YjsDatabaseKey.type, FieldType.MultiSelect);
  field.set(YjsDatabaseKey.is_primary, true);
  multiSelectOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      options: [
        { id: 'option-a', name: 'Alpha', color: 'Purple' },
        { id: 'option-b', name: 'Beta', color: 'Pink' },
      ],
    })
  );
  typeOptions.set(String(FieldType.MultiSelect), multiSelectOption);
  field.set(YjsDatabaseKey.type_option, typeOptions);

  rowOrders.push([{ id: rowId, height: 44 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array() as YDatabaseSorts);
  fields.set(fieldId, field);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  const rowDoc = createRowDoc(rowId, databaseId, {
    [fieldId]: { fieldType: FieldType.MultiSelect, data: 'option-a,option-b' },
  });
  const contextValue = {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return { field, rowDoc, wrapper };
}

function createCalendarFixture() {
  const calendarFieldId = 'calendar-field-id';
  const primaryFieldId = 'primary-field-id';
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const layoutSettings = new Y.Map();
  const calendarSettings = new Y.Map();
  const calendarField = new Y.Map() as YDatabaseField;
  const primaryField = new Y.Map() as YDatabaseField;
  const primaryTypeOptions = new Y.Map();
  const primaryMultiSelectOption = new Y.Map();

  calendarField.set(YjsDatabaseKey.id, calendarFieldId);
  calendarField.set(YjsDatabaseKey.name, 'Date');
  calendarField.set(YjsDatabaseKey.type, FieldType.DateTime);

  primaryField.set(YjsDatabaseKey.id, primaryFieldId);
  primaryField.set(YjsDatabaseKey.name, 'Name');
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  primaryField.set(YjsDatabaseKey.is_primary, true);
  primaryMultiSelectOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({ options: [{ id: 'title-option', name: 'Experiment Alpha', color: 'Purple' }] })
  );
  primaryTypeOptions.set(String(FieldType.MultiSelect), primaryMultiSelectOption);
  primaryField.set(YjsDatabaseKey.type_option, primaryTypeOptions);

  calendarSettings.set(YjsDatabaseKey.field_id, calendarFieldId);
  layoutSettings.set('2', calendarSettings);
  rowOrders.push([{ id: rowId, height: 44 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array() as YDatabaseSorts);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  fields.set(calendarFieldId, calendarField);
  fields.set(primaryFieldId, primaryField);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  const rowDoc = createRowDoc(rowId, databaseId, {
    [calendarFieldId]: { fieldType: FieldType.RichText, data: '2025-01-02' },
    [primaryFieldId]: { fieldType: FieldType.MultiSelect, data: 'title-option' },
  });
  const contextValue = {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AFConfigContext.Provider
      value={{
        isAuthenticated: false,
        updateCurrentUser: async () => undefined,
        openLoginModal: () => undefined,
      }}
    >
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );

  return { calendarField, wrapper };
}

describe('field-schema-aware selectors', () => {
  it('recomputes aggregate and primary content without rewriting the stored cell', async () => {
    const { field, rowDoc, wrapper } = createFixture();
    const { result } = renderHook(
      () => ({
        cells: useFieldCellsSelector(fieldId).cells,
        primaryContent: useRowPrimaryContentSelector(rowDoc, fieldId),
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.cells?.get(rowId)).toBe('option-a,option-b');
      expect(result.current.primaryContent).toBe('Alpha,Beta');
    });

    act(() => {
      field.set(YjsDatabaseKey.type, FieldType.RichText);
    });

    await waitFor(() => {
      expect(result.current.cells?.get(rowId)).toBe('Alpha,Beta');
      expect(result.current.primaryContent).toBe('Alpha,Beta');
    });
  });

  it('recomputes lazy calendar values and clears stale events for an incompatible target type', async () => {
    const { calendarField, wrapper } = createCalendarFixture();
    const { result } = renderHook(() => useCalendarEventsSelector(), { wrapper });

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0]?.title).toBe('Experiment Alpha');
      expect(result.current.events[0]?.start?.getFullYear()).toBe(2025);
      expect(result.current.events[0]?.start?.getMonth()).toBe(0);
      expect(result.current.events[0]?.start?.getDate()).toBe(2);
    });

    act(() => {
      calendarField.set(YjsDatabaseKey.type, FieldType.RichText);
    });

    await waitFor(() => {
      expect(result.current.events).toEqual([]);
      expect(result.current.emptyEvents).toEqual([]);
    });
  });
});
