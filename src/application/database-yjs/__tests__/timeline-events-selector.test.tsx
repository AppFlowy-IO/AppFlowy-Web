import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, useTimelineEventsSelector } from '@/application/database-yjs';
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
const START = 'start-field';
const END = 'end-field';
const PRIMARY = 'primary-field';
const DAY = 86_400;
const jan2 = Math.floor(new Date(2025, 0, 2).getTime() / 1000);

function dateField(id: string, name: string) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, FieldType.DateTime);
  return field;
}

/** Three rows: a proper range, an end before its start, and no end at all. */
function createFixture() {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const layoutSettings = new Y.Map();
  const timelineSettings = new Y.Map();
  const primaryField = new Y.Map() as YDatabaseField;

  primaryField.set(YjsDatabaseKey.id, PRIMARY);
  primaryField.set(YjsDatabaseKey.name, 'Name');
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  primaryField.set(YjsDatabaseKey.is_primary, true);

  timelineSettings.set(YjsDatabaseKey.field_id, START);
  timelineSettings.set(YjsDatabaseKey.end_field_id, END);
  layoutSettings.set('8', timelineSettings);
  rowOrders.push([
    { id: 'range', height: 36 },
    { id: 'backwards', height: 36 },
    { id: 'open', height: 36 },
  ]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array() as YDatabaseSorts);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  fields.set(START, dateField(START, 'Start'));
  fields.set(END, dateField(END, 'End'));
  fields.set(PRIMARY, primaryField);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  const rowMap = {
    range: createRowDoc('range', databaseId, {
      [START]: { fieldType: FieldType.DateTime, data: String(jan2) },
      [END]: { fieldType: FieldType.DateTime, data: String(jan2 + 3 * DAY) },
      [PRIMARY]: { fieldType: FieldType.RichText, data: 'Range' },
    }),
    backwards: createRowDoc('backwards', databaseId, {
      [START]: { fieldType: FieldType.DateTime, data: String(jan2) },
      [END]: { fieldType: FieldType.DateTime, data: String(jan2 - DAY) },
      [PRIMARY]: { fieldType: FieldType.RichText, data: 'Backwards' },
    }),
    open: createRowDoc('open', databaseId, {
      [START]: { fieldType: FieldType.DateTime, data: String(jan2) },
      [PRIMARY]: { fieldType: FieldType.RichText, data: 'Open' },
    }),
  };
  const contextValue = {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap,
    workspaceId: 'workspace-id',
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AFConfigContext.Provider
      value={{ isAuthenticated: false, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}
    >
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );

  return { wrapper, timelineSettings, databaseDoc };
}

describe('useTimelineEventsSelector with separate start and end fields', () => {
  it('ends each bar at the end field, ignoring ends before the start or missing', async () => {
    const { wrapper } = createFixture();
    const { result } = renderHook(() => useTimelineEventsSelector(), { wrapper });

    await waitFor(() => expect(result.current.events).toHaveLength(3));
    expect(result.current.hasEndField).toBe(true);
    const byId = new Map(result.current.events.map((event) => [event.rowId, event]));

    expect(byId.get('range')).toMatchObject({ isRange: true });
    expect(byId.get('range')?.end?.getTime()).toBe((jan2 + 3 * DAY) * 1000);
    expect(byId.get('backwards')).toMatchObject({ isRange: false, end: undefined });
    expect(byId.get('open')).toMatchObject({ isRange: false, end: undefined });
  });

  it('falls back to the start field alone once the end field is unbound', async () => {
    const { wrapper, timelineSettings, databaseDoc } = createFixture();
    const { result } = renderHook(() => useTimelineEventsSelector(), { wrapper });

    await waitFor(() => expect(result.current.hasEndField).toBe(true));
    act(() => {
      databaseDoc.transact(() => timelineSettings.delete(YjsDatabaseKey.end_field_id));
    });
    await waitFor(() => expect(result.current.hasEndField).toBe(false));
    const range = result.current.events.find((event) => event.rowId === 'range');

    // Without an end field a single-date cell is the synthetic 30-minute event.
    expect(range?.isRange).toBe(false);
    expect(range?.end?.getTime()).toBe(jan2 * 1000 + 30 * 60_000);
  });
});
