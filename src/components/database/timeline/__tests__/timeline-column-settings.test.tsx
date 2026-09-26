import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { useResizeColumnWidthDispatch } from '@/application/database-yjs/dispatch';
import { useDatabaseHistory } from '@/application/database-yjs/history';
import {
  DatabaseViewLayout,
  type YDatabase,
  type YDatabaseField,
  type YDatabaseFields,
  type YDatabaseFieldSetting,
  type YDatabaseFieldSettings,
  type YDatabaseView,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { useTimelineSavedColumnWidths } from '../hooks/useTimelineSavedColumnWidths';
import { useTimelineTableFieldIds } from '../hooks/useTimelineTableFieldIds';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const documents: Y.Doc[] = [];
const requestedIds = ['title', 'owner', 'missing'];

afterEach(() => {
  documents.splice(0).forEach((doc) => doc.destroy());
  jest.restoreAllMocks();
});

function createField(id: string, primary = false) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, id);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  field.set(YjsDatabaseKey.is_primary, primary);
  return field;
}

function settingsWithWidth(width: string) {
  const settings = new Y.Map() as YDatabaseFieldSettings;
  const owner = new Y.Map() as YDatabaseFieldSetting;

  owner.set(YjsDatabaseKey.width, width);
  settings.set('owner', owner);
  return settings;
}

function fixture(includeSettings = true) {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>();
  const first = new Y.Map() as YDatabaseView;
  const second = new Y.Map() as YDatabaseView;
  const firstSettings = settingsWithWidth('180');
  const secondSettings = settingsWithWidth('280');

  documents.push(doc);
  fields.set('title', createField('title', true));
  fields.set('owner', createField('owner'));
  for (const [id, view] of [
    ['first', first],
    ['second', second],
  ] as const) {
    const orders = new Y.Array<{ id: string }>();

    orders.push([{ id: 'title' }, { id: 'owner' }]);
    view.set(YjsDatabaseKey.id, id);
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Timeline);
    view.set(YjsDatabaseKey.field_orders, orders);
  }

  if (includeSettings) first.set(YjsDatabaseKey.field_settings, firstSettings);
  second.set(YjsDatabaseKey.field_settings, secondSettings);
  views.set('first', first);
  views.set('second', second);
  database.set(YjsDatabaseKey.id, doc.guid);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  let activeViewId = 'first';
  const wrapper = ({ children }: { children: ReactNode }) => {
    const value: DatabaseContextState = {
      databaseDoc: doc,
      databasePageId: 'first',
      activeViewId,
      readOnly: false,
      rowMap: {},
      workspaceId: 'workspace',
    };

    return (
      <AFConfigContext.Provider
        value={{
          isAuthenticated: false,
          openLoginModal: () => undefined,
          updateCurrentUser: async () => undefined,
        }}
      >
        <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
      </AFConfigContext.Provider>
    );
  };

  return {
    doc,
    fields,
    first,
    second,
    firstSettings,
    secondSettings,
    wrapper,
    selectView: (id: string) => {
      activeViewId = id;
    },
  };
}

function clonePeer(doc: Y.Doc) {
  const peer = new Y.Doc();

  documents.push(peer);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const database = peer.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  return { peer, database };
}

test('table membership drops primary and nonexistent fields', () => {
  const f = fixture();
  const { result } = renderHook(() => useTimelineTableFieldIds(requestedIds, 'title'), { wrapper: f.wrapper });

  expect(result.current).toEqual(['owner']);
});

test('table membership follows deletion, undo, and redo with the same fields map and requested IDs', () => {
  const f = fixture();
  const undo = new Y.UndoManager(f.fields, { captureTimeout: 0 });
  const { result } = renderHook(() => useTimelineTableFieldIds(requestedIds, 'title'), { wrapper: f.wrapper });

  expect(result.current).toEqual(['owner']);
  act(() => {
    f.fields.delete('owner');
  });
  expect(result.current).toEqual([]);
  act(() => {
    undo.undo();
  });
  expect(result.current).toEqual(['owner']);
  act(() => {
    undo.redo();
  });
  expect(result.current).toEqual([]);
  undo.destroy();
});

test('table membership receives remote field deletion and insertion without remounting', () => {
  const f = fixture();
  const { peer, database } = clonePeer(f.doc);
  const peerFields = database.get(YjsDatabaseKey.fields);
  const { result } = renderHook(() => useTimelineTableFieldIds(requestedIds, 'title'), { wrapper: f.wrapper });

  peerFields.delete('owner');
  act(() => {
    Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(peer), 'remote');
  });
  expect(result.current).toEqual([]);
  peerFields.set('missing', createField('missing'));
  act(() => {
    Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(peer), 'remote');
  });
  expect(result.current).toEqual(['missing']);
});

test('an explicitly selected table column remains visible when hidden on bars', () => {
  const f = fixture();

  f.firstSettings.get('owner').set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysHidden);
  const { result } = renderHook(() => useTimelineTableFieldIds(requestedIds, 'title'), { wrapper: f.wrapper });

  expect(result.current).toEqual(['owner']);
});

test('width changes preserve the selected field IDs reference', () => {
  const f = fixture();
  const { result } = renderHook(() => useTimelineTableFieldIds(requestedIds, 'title'), { wrapper: f.wrapper });
  const ids = result.current;

  act(() => {
    f.firstSettings.get('owner').set(YjsDatabaseKey.width, '360');
  });
  expect(result.current).toBe(ids);
});

test('reads stored widths without inventing widths for unset fields', () => {
  const f = fixture();
  const { result } = renderHook(useTimelineSavedColumnWidths, { wrapper: f.wrapper });

  expect([...result.current]).toEqual([['owner', 180]]);
  expect(result.current.has('title')).toBe(false);
});

test('persists a resized width through production dispatch and follows history undo and redo', () => {
  const f = fixture();
  const { result } = renderHook(
    () => ({
      widths: useTimelineSavedColumnWidths(),
      resize: useResizeColumnWidthDispatch(),
      history: useDatabaseHistory(),
    }),
    { wrapper: f.wrapper }
  );

  act(() => {
    result.current.resize('owner', 360);
  });
  expect(f.firstSettings.get('owner').get(YjsDatabaseKey.width)).toBe('360');
  expect(result.current.widths.get('owner')).toBe(360);
  act(() => {
    result.current.history.undo();
  });
  expect(f.firstSettings.get('owner').get(YjsDatabaseKey.width)).toBe('180');
  expect(result.current.widths.get('owner')).toBe(180);
  act(() => {
    result.current.history.redo();
  });
  expect(f.firstSettings.get('owner').get(YjsDatabaseKey.width)).toBe('360');
  expect(result.current.widths.get('owner')).toBe(360);
});

test('receives another document’s width edit without a manual rerender', () => {
  const f = fixture();
  const { peer, database } = clonePeer(f.doc);
  const peerSettings = database.get(YjsDatabaseKey.views).get('first').get(YjsDatabaseKey.field_settings);
  const { result } = renderHook(useTimelineSavedColumnWidths, { wrapper: f.wrapper });

  peerSettings.get('owner').set(YjsDatabaseKey.width, '425');
  act(() => {
    Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(peer), 'remote');
  });
  expect(result.current.get('owner')).toBe(425);
});

test('follows a replacement settings map and later edits to that map', () => {
  const f = fixture();
  const { result } = renderHook(useTimelineSavedColumnWidths, { wrapper: f.wrapper });
  const replacement = settingsWithWidth('260');

  act(() => {
    f.first.set(YjsDatabaseKey.field_settings, replacement);
  });
  expect(result.current.get('owner')).toBe(260);
  act(() => {
    replacement.get('owner').set(YjsDatabaseKey.width, '300');
  });
  expect(result.current.get('owner')).toBe(300);
});

test('observes settings inserted after the view has mounted', () => {
  const f = fixture(false);
  const { result } = renderHook(useTimelineSavedColumnWidths, { wrapper: f.wrapper });

  expect(result.current.size).toBe(0);
  act(() => {
    f.first.set(YjsDatabaseKey.field_settings, settingsWithWidth('210'));
  });
  expect(result.current.get('owner')).toBe(210);
});

test('switches views and ignores subsequent changes to the previous view', () => {
  const f = fixture();
  const { result, rerender } = renderHook(useTimelineSavedColumnWidths, { wrapper: f.wrapper });

  f.selectView('second');
  rerender();
  expect(result.current.get('owner')).toBe(280);
  const current = result.current;

  act(() => {
    f.firstSettings.get('owner').set(YjsDatabaseKey.width, '500');
  });
  expect(result.current).toBe(current);
  act(() => {
    f.secondSettings.get('owner').set(YjsDatabaseKey.width, '320');
  });
  expect(result.current.get('owner')).toBe(320);
});

test('retains its snapshot when unrelated field settings change', () => {
  const f = fixture();
  const { result } = renderHook(useTimelineSavedColumnWidths, { wrapper: f.wrapper });
  const widths = result.current;

  act(() => {
    f.firstSettings.get('owner').set(YjsDatabaseKey.wrap, true);
  });
  expect(result.current).toBe(widths);
});

test('balances subscriptions through StrictMode replay and unmount', () => {
  const f = fixture();
  const observe = jest.spyOn(f.first, 'observeDeep');
  const unobserve = jest.spyOn(f.first, 'unobserveDeep');
  const Wrapper = f.wrapper;
  const { unmount } = renderHook(useTimelineSavedColumnWidths, {
    wrapper: ({ children }) => (
      <StrictMode>
        <Wrapper>{children}</Wrapper>
      </StrictMode>
    ),
  });

  expect(observe).toHaveBeenCalled();
  unmount();
  expect(unobserve.mock.calls).toEqual(observe.mock.calls);
});
