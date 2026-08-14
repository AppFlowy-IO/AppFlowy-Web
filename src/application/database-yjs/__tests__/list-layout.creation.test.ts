import * as Y from 'yjs';

import { createDatabaseListPageViaGrid, createLinkedDatabaseListView } from '@/application/database-yjs/list-layout';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { DatabaseViewLayout, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey, ViewLayout } from '@/application/types';

function createGridDatabaseDoc(): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const fields = new Y.Map();
  const primaryField = new Y.Map();
  const views = new Y.Map();
  const gridView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();
  const metas = new Y.Map();

  primaryField.set(YjsDatabaseKey.id, 'primary-field');
  primaryField.set(YjsDatabaseKey.is_primary, true);
  fields.set('primary-field', primaryField);
  fieldOrders.push([{ id: 'primary-field' }]);
  gridView.set(YjsDatabaseKey.id, 'grid-view-id');
  gridView.set(YjsDatabaseKey.name, 'Grid');
  gridView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  gridView.set(YjsDatabaseKey.field_orders, fieldOrders);
  gridView.set(YjsDatabaseKey.field_settings, new Y.Map());
  gridView.set(YjsDatabaseKey.groups, new Y.Array());
  gridView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set('grid-view-id', gridView);
  metas.set(YjsDatabaseKey.iid, 'grid-view-id');
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, metas);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function createLinkedListUpdate(databaseDoc: YDoc, viewId = 'linked-list-id'): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const views = database.get(YjsDatabaseKey.views);
  const gridView = views.get('grid-view-id');
  const listView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push(gridView?.get(YjsDatabaseKey.field_orders)?.toArray() ?? []);
  listView.set(YjsDatabaseKey.id, viewId);
  listView.set(YjsDatabaseKey.name, 'View of Grid');
  listView.set(YjsDatabaseKey.layout, DatabaseViewLayout.List);
  listView.set(YjsDatabaseKey.field_orders, fieldOrders);
  listView.set(YjsDatabaseKey.field_settings, new Y.Map());
  listView.set(YjsDatabaseKey.groups, new Y.Array());
  listView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, listView);

  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

function createUpdateWithoutLinkedView(databaseDoc: YDoc): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  database.get(YjsDatabaseKey.views).get('grid-view-id')?.set(YjsDatabaseKey.name, 'Updated Grid');
  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

describe('createLinkedDatabaseListView lifecycle', () => {
  const payload = {
    parent_view_id: 'document-id',
    database_id: 'database-id',
    name: 'View of Grid',
    embedded: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['database loader', { loadView: undefined }],
    ['sync binder', { bindViewSync: undefined }],
    ['rollback operation', { deletePage: undefined }],
  ])('prevalidates the %s before creating a linked child', async (_, missingCapability) => {
    const createDatabaseView = jest.fn();
    const loadView = jest.fn(async () => createGridDatabaseDoc());
    const bindViewSync = jest.fn(() => null);
    const deletePage = jest.fn(async () => undefined);

    await expect(
      createLinkedDatabaseListView({
        requestViewId: 'document-id',
        payload,
        createDatabaseView,
        loadView,
        bindViewSync,
        deletePage,
        ...missingCapability,
      })
    ).rejects.toThrow('Linked List creation is not available right now');

    expect(createDatabaseView).not.toHaveBeenCalled();
  });

  it('normalizes and flushes the exact linked List before returning success', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const response = {
      view_id: 'linked-list-id',
      database_id: 'database-id',
      database_update: createLinkedListUpdate(databaseDoc),
    };
    const createDatabaseView = jest.fn().mockResolvedValue(response);
    const loadView = jest.fn().mockResolvedValue(databaseDoc);
    const flush = jest.fn().mockResolvedValue(true);
    const bindViewSync = jest.fn(() => ({ flush } as unknown as SyncContext));
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseListView({
        requestViewId: 'document-id',
        payload,
        createDatabaseView,
        loadView,
        bindViewSync,
        deletePage,
      })
    ).resolves.toEqual(response);

    expect(createDatabaseView).toHaveBeenCalledWith('document-id', {
      ...payload,
      layout: ViewLayout.List,
    });
    expect(loadView).toHaveBeenCalledWith('linked-list-id', false, false, {
      databaseId: 'database-id',
    });
    expect(bindViewSync).toHaveBeenCalledWith(databaseDoc);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(deletePage).not.toHaveBeenCalled();

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const linkedList = database.get(YjsDatabaseKey.views).get('linked-list-id');

    expect(linkedList?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.List);
    expect(linkedList?.get(YjsDatabaseKey.field_settings)?.size).toBe(1);
  });

  it('rolls back the exact linked child when the response omits its database update', async () => {
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'linked-list-id',
      database_id: 'database-id',
    });
    const loadView = jest.fn();
    const bindViewSync = jest.fn();
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseListView({
        requestViewId: 'document-id',
        payload,
        createDatabaseView,
        loadView,
        bindViewSync,
        deletePage,
      })
    ).rejects.toThrow('The server did not return the linked List database update');

    expect(loadView).not.toHaveBeenCalled();
    expect(bindViewSync).not.toHaveBeenCalled();
    expect(deletePage).toHaveBeenCalledTimes(1);
    expect(deletePage).toHaveBeenCalledWith('linked-list-id');
  });

  it('does not normalize an existing Grid when the update lacks the returned linked child', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'linked-list-id',
      database_id: 'database-id',
      database_update: createUpdateWithoutLinkedView(databaseDoc),
    });
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseListView({
        requestViewId: 'document-id',
        payload,
        createDatabaseView,
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(),
        deletePage,
      })
    ).rejects.toThrow('The server did not return the linked List database view');

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(database.get(YjsDatabaseKey.views).get('grid-view-id')?.get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Grid
    );
    expect(deletePage).toHaveBeenCalledWith('linked-list-id');
  });

  it('rolls back the exact linked child when sync binding returns null', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'linked-list-id',
      database_id: 'database-id',
      database_update: createLinkedListUpdate(databaseDoc),
    });
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseListView({
        requestViewId: 'document-id',
        payload,
        createDatabaseView,
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => null),
        deletePage,
      })
    ).rejects.toThrow('The linked List could not be connected for persistence');

    expect(deletePage).toHaveBeenCalledTimes(1);
    expect(deletePage).toHaveBeenCalledWith('linked-list-id');
  });

  it('rolls back the exact linked child when normalization cannot be durably flushed', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'linked-list-id',
      database_id: 'database-id',
      database_update: createLinkedListUpdate(databaseDoc),
    });
    const flush = jest.fn().mockResolvedValue(false);
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseListView({
        requestViewId: 'document-id',
        payload,
        createDatabaseView,
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
        deletePage,
      })
    ).rejects.toThrow('The linked List could not be persisted');

    expect(flush).toHaveBeenCalledTimes(1);
    expect(deletePage).toHaveBeenCalledTimes(1);
    expect(deletePage).toHaveBeenCalledWith('linked-list-id');
  });
});

describe('createDatabaseListPageViaGrid lifecycle', () => {
  const loadView = jest.fn(async () => new Y.Doc() as unknown as YDoc);
  const bindViewSync = jest.fn(() => null);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prevalidates standalone compensation capabilities before creating a Grid container', async () => {
    const addPage = jest.fn();

    await expect(
      createDatabaseListPageViaGrid({
        parentViewId: 'parent-id',
        standalone: true,
        addPage,
        loadViewMeta: jest.fn(),
        loadView,
        bindViewSync,
        createDatabaseView: jest.fn(),
        deletePage: jest.fn(),
        // Deliberately omit deleteTrash: standalone creation cannot guarantee
        // exact-container compensation without it.
      })
    ).rejects.toThrow('Standalone List creation is not available right now');

    expect(addPage).not.toHaveBeenCalled();
  });

  it('prevalidates embedded soft-delete compensation before creating a Grid child', async () => {
    const addPage = jest.fn();

    await expect(
      createDatabaseListPageViaGrid({
        parentViewId: 'document-id',
        addPage,
        loadView,
        bindViewSync,
      })
    ).rejects.toThrow('List creation is not available right now');

    expect(addPage).not.toHaveBeenCalled();
  });

  it('soft-deletes only the just-created embedded database when sync binding fails', async () => {
    const addPage = jest.fn().mockResolvedValue({
      view_id: 'embedded-grid-id',
      database_id: 'database-id',
    });
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createDatabaseListPageViaGrid({
        parentViewId: 'document-id',
        name: 'New Database',
        addPage,
        loadView,
        bindViewSync,
        deletePage,
      })
    ).rejects.toThrow('The new embedded List could not be connected for persistence');

    expect(addPage).toHaveBeenCalledWith('document-id', {
      layout: ViewLayout.Grid,
      name: 'New Database',
      prev_view_id: undefined,
    });
    expect(loadView).toHaveBeenCalledWith('embedded-grid-id', false, false, {
      databaseId: 'database-id',
      forceFetch: true,
    });
    expect(deletePage).toHaveBeenCalledTimes(1);
    expect(deletePage).toHaveBeenCalledWith('embedded-grid-id');
  });
});
