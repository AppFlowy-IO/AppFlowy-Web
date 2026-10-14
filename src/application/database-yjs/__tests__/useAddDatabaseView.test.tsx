import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { atomicRead } from '@/application/atomic-creation';
import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FieldVisibility,
  useAddDatabaseView,
  useDuplicateDatabaseView,
  useUpdateDatabaseLayout,
} from '@/application/database-yjs';
import { createDefaultDatabaseView } from '@/application/database-yjs/creation/create-default-view';
import { getView } from '@/application/services/js-services/http/view-api';
import {
  DatabaseViewLayout,
  View,
  ViewLayout,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AppOutlineContext } from '@/components/app/contexts/AppOutlineContext';
import { updateServerInfo } from '@/utils/server-info';

jest.mock('@/application/services/js-services/http/view-api', () => ({ getView: jest.fn() }));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseDoc(databaseId: string): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();

  database.set(YjsDatabaseKey.id, databaseId);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function addExistingGridView(databaseDoc: YDoc, viewId: string): void {
  const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
  const existingFields = database?.get(YjsDatabaseKey.fields);
  const fields = existingFields ?? new Y.Map();
  const field = new Y.Map();
  const existingViews = database?.get(YjsDatabaseKey.views);
  const views = existingViews ?? new Y.Map();
  const view = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();
  const fieldSettings = new Y.Map();
  const fieldSetting = new Y.Map();

  field.set(YjsDatabaseKey.id, 'primary-field');
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  field.set(YjsDatabaseKey.is_primary, true);
  fields.set('primary-field', field);
  fieldOrders.push([{ id: 'primary-field' }]);
  fieldSetting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysHidden);
  fieldSettings.set('primary-field', fieldSetting);
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.name, 'Grid');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  view.set(YjsDatabaseKey.groups, new Y.Array());
  view.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, view);
  if (!existingFields) database?.set(YjsDatabaseKey.fields, fields);
  if (!existingViews) database?.set(YjsDatabaseKey.views, views);
}


jest.mock('@/application/atomic-creation', () => ({
  atomicRead: jest.fn(),
  captureAtomicCreationOwner: (_workspace: string, check: () => void) => ({ assertCurrent: check }),
}));
jest.mock('@/application/database-yjs/creation/create-default-view', () => ({ createDefaultDatabaseView: jest.fn() }));

function getDatabase(databaseDoc: YDoc): Y.Map<unknown> {
  return databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
}

function folder(view_id: string, parent_view_id?: string, extra = {}): View {
  return { view_id, parent_view_id, name: view_id, icon: null, layout: ViewLayout.Grid,
    extra, children: [], is_published: false, is_private: false };
}

describe('database layout conversion admission', () => {
  beforeEach(() => {
    updateServerInfo('https://test.appflowy.cloud', {
      status: 'available', info: { enable_page_history: true, self_hosted: false },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(getView).mockReset();
  });

  function setup() {
    const databaseDoc = createDatabaseDoc('database-id');

    addExistingGridView(databaseDoc, 'base-view-id');
    const before = Y.encodeStateAsUpdate(databaseDoc);
    const onUpdate = jest.fn();

    databaseDoc.on('update', onUpdate);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      canWrite: true,
      databaseDoc,
      databasePageId: 'base-view-id',
      rowMap: {},
      workspaceId: 'workspace-id',
    };
    const hook = renderHook(() => useUpdateDatabaseLayout('base-view-id'), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    return { ...hook, databaseDoc, before, onUpdate };
  }

  it('does not mutate or enqueue a Chart conversion while offline', async () => {
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fixture = setup();

    await expect(fixture.result.current(DatabaseViewLayout.Chart)).rejects.toThrow(
      'Use Add view to create Form or Chart views.'
    );
    expect(getView).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(fixture.databaseDoc)).toEqual(fixture.before);
    expect(fixture.onUpdate).not.toHaveBeenCalled();
  });

  it.each([DatabaseViewLayout.Form, DatabaseViewLayout.Chart])('allows self-hosted layout %s conversion offline without a billing reachability read', (layout) => {
    updateServerInfo('https://test.appflowy.cloud', {
      status: 'available', info: { enable_page_history: true, self_hosted: true },
    });
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fixture = setup();

    act(() => { void fixture.result.current(layout); });

    const views = getDatabase(fixture.databaseDoc).get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;

    expect(views.get('base-view-id')?.get(YjsDatabaseKey.layout)).toBe(layout);
    expect(getView).not.toHaveBeenCalled();
    expect(fixture.onUpdate).toHaveBeenCalled();
  });

  it.each([DatabaseViewLayout.Form, DatabaseViewLayout.Chart])(
    'requires atomic server creation for hosted layout %s even while online', async (layout) => {
      jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      const fixture = setup();

      await expect(fixture.result.current(layout)).rejects.toThrow('Use Add view to create Form or Chart views.');
      expect(getView).not.toHaveBeenCalled();
      expect(Y.encodeStateAsUpdate(fixture.databaseDoc)).toEqual(fixture.before);
      expect(fixture.onUpdate).not.toHaveBeenCalled();
    }
  );

  it.each([DatabaseViewLayout.Form, DatabaseViewLayout.Chart])('keeps existing hosted layout %s usable', (layout) => {
    const fixture = setup();
    const views = getDatabase(fixture.databaseDoc).get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;

    act(() => { views.get('base-view-id')?.set(YjsDatabaseKey.layout, layout); });
    fixture.onUpdate.mockClear();
    act(() => { void fixture.result.current(layout); });
    expect(fixture.onUpdate).not.toHaveBeenCalled();
  });

});

describe('compact Database view callers', () => {
  beforeEach(() => {
    jest.mocked(createDefaultDatabaseView).mockReset().mockResolvedValue('new-view');
    jest.mocked(atomicRead).mockReset();
  });

  function setup(options: Partial<DatabaseContextState> = {}) {
    const databaseDoc = createDatabaseDoc('database-id');

    addExistingGridView(databaseDoc, 'source');
    const source = folder('source', 'container');
    const container = folder('container', 'space', { is_database_container: true });

    container.children = [source];
    jest.mocked(atomicRead).mockImplementation(async (_owner, url) =>
      (url.endsWith('/source') ? source : container) as never);
    const ensure = jest.fn(async (): Promise<string[]> => []);
    const context = { databaseDoc, databasePageId: 'container', activeViewId: 'source', workspaceId: 'workspace',
      rowMap: {}, readOnly: false, canWrite: true, ...options };
    const hook = renderHook(() => ({ add: useAddDatabaseView(), duplicate: useDuplicateDatabaseView() }), {
      wrapper: ({ children }) => <AppOutlineContext.Provider value={{ outline: [container], ensureViewVisibleInOutline: ensure }}>
        <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
      </AppOutlineContext.Provider>,
    });

    return { ...hook, databaseDoc, container, source, ensure };
  }

  it.each([DatabaseViewLayout.Grid, DatabaseViewLayout.Board, DatabaseViewLayout.Calendar,
    DatabaseViewLayout.Chart, DatabaseViewLayout.List, DatabaseViewLayout.Gallery, DatabaseViewLayout.Feed,
    DatabaseViewLayout.Form, DatabaseViewLayout.Timeline])('routes layout %s as a compact server recipe without local mutation', async (layout) => {
    const f = setup();
    const before = Y.encodeStateAsUpdate(f.databaseDoc);

    await expect(f.result.current.add(layout)).resolves.toBe('new-view');
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({
      databaseId: 'database-id', parentViewId: 'container', layout, sourceViewId: undefined, embedded: false,
    }));
    expect(Y.encodeStateAsUpdate(f.databaseDoc)).toEqual(before);
  });

  it.each([
    ['inline database', { is_database_container: true, embedded: true }, {}, true, 'container'],
    ['linked document block', {}, { embedded: true }, true, 'container'],
    ['legacy standalone view', {}, {}, false, 'container'],
  ])('preserves the Folder parent and embedding of a %s', async (_label, parentExtra, sourceExtra, embedded, parentViewId) => {
    const f = setup();

    f.container.extra = parentExtra;
    f.source.extra = sourceExtra;
    await f.result.current.add(DatabaseViewLayout.List);
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({ parentViewId, embedded }));
  });

  it('uses the authoritative navigation result before the sidebar context rerenders', async () => {
    const f = setup();

    jest.mocked(createDefaultDatabaseView).mockImplementation(async (intent) => {
      await intent.activate?.('created');
      return 'created';
    });
    await expect(f.result.current.add(DatabaseViewLayout.Grid)).rejects.toThrow('missing from the sidebar');
    // React may batch the outline state update until after this promise resolves.
    // The current navigation path proves membership without consulting stale rendered state.
    f.ensure.mockResolvedValue(['space', 'container']);
    await expect(f.result.current.add(DatabaseViewLayout.Grid)).resolves.toBe('created');
    expect(f.container.children?.some((view) => view.view_id === 'created')).toBe(false);
    expect(f.ensure).toHaveBeenCalledTimes(2);
  });

  it('creates directly in a known container without waiting for its parent metadata', async () => {
    const f = setup({ activeViewId: 'container' });

    jest.mocked(atomicRead).mockImplementation(async (_owner, url) => {
      if (url.endsWith('/container')) return f.container as never;
      throw new Error('Parent metadata is unavailable');
    });

    await expect(f.result.current.add(DatabaseViewLayout.Grid)).resolves.toBe('new-view');
    expect(atomicRead).toHaveBeenCalledTimes(1);
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({
      parentViewId: 'container', embedded: false,
    }));
  });

  it('duplicates current source settings through the recipe rather than copying Yjs maps', async () => {
    const f = setup();

    await expect(f.result.current.duplicate('source', 'Copied')).resolves.toBe('new-view');
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({ sourceViewId: 'source',
      name: 'Copied', position: { kind: 'index', index: 0 } }));
  });

  it('refuses read-only creation before metadata or mutation', async () => {
    const f = setup({ readOnly: true });

    await expect(f.result.current.add(DatabaseViewLayout.Grid)).rejects.toThrow('Edit access');
    expect(atomicRead).not.toHaveBeenCalled();
    expect(createDefaultDatabaseView).not.toHaveBeenCalled();
  });

  it('does not activate a late result after the owning component unmounts', async () => {
    const f = setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    jest.mocked(createDefaultDatabaseView).mockImplementation(async (intent) => {
      await held;
      intent.assertCurrent?.();
      return 'new-view';
    });
    const pending = f.result.current.add(DatabaseViewLayout.Grid);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    f.unmount();
    release();
    await expect(pending).rejects.toThrow('owner changed');
  });
});
