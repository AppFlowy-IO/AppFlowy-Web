import * as Y from 'yjs';

import { FieldType, FieldVisibility, SortCondition } from '@/application/database-yjs/database.type';
import {
  createDatabaseFeedPageViaGrid,
  createLinkedDatabaseFeedView,
  ensureFeedDefaultSort,
  findCreatedTimeFieldId,
  normalizeCreatedDatabaseFeedView,
} from '@/application/database-yjs/feed-layout';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  DatabaseViewLayout,
  ViewLayout,
  YDatabase,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createGridDatabaseDoc({ withCreatedTimeField = false }: { withCreatedTimeField?: boolean } = {}): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const fields = new Y.Map();
  const primaryField = new Y.Map();
  const secondaryField = new Y.Map();
  const views = new Y.Map();
  const gridView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();
  const groups = new Y.Array();
  const metas = new Y.Map();

  primaryField.set(YjsDatabaseKey.id, 'primary-field');
  primaryField.set(YjsDatabaseKey.is_primary, true);
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  secondaryField.set(YjsDatabaseKey.id, 'secondary-field');
  secondaryField.set(YjsDatabaseKey.is_primary, false);
  secondaryField.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  fields.set('primary-field', primaryField);
  fields.set('secondary-field', secondaryField);
  fieldOrders.push([{ id: 'primary-field' }, { id: 'secondary-field' }]);

  if (withCreatedTimeField) {
    const createdTimeField = new Y.Map();

    createdTimeField.set(YjsDatabaseKey.id, 'created-time-field');
    createdTimeField.set(YjsDatabaseKey.is_primary, false);
    createdTimeField.set(YjsDatabaseKey.type, FieldType.CreatedTime);
    fields.set('created-time-field', createdTimeField);
    fieldOrders.push([{ id: 'created-time-field' }]);
  }

  groups.push([{ id: 'legacy-group' }]);
  gridView.set(YjsDatabaseKey.id, 'grid-view-id');
  gridView.set(YjsDatabaseKey.name, 'Grid');
  gridView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  gridView.set(YjsDatabaseKey.field_orders, fieldOrders);
  gridView.set(YjsDatabaseKey.field_settings, new Y.Map());
  gridView.set(YjsDatabaseKey.groups, groups);
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

function getDatabase(doc: YDoc): YDatabase {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
}

function createFeedUpdate(databaseDoc: YDoc, viewId = 'feed-view-id'): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const views = database.get(YjsDatabaseKey.views);
  const gridView = views.get('grid-view-id');
  const feedView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push(gridView.get(YjsDatabaseKey.field_orders).toArray());
  feedView.set(YjsDatabaseKey.id, viewId);
  feedView.set(YjsDatabaseKey.name, 'Feed');
  feedView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  feedView.set(YjsDatabaseKey.field_orders, fieldOrders);
  feedView.set(YjsDatabaseKey.field_settings, new Y.Map());
  feedView.set(YjsDatabaseKey.groups, new Y.Array());
  feedView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, feedView);
  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

function createUpdateWithoutFeedView(databaseDoc: YDoc): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  database.get(YjsDatabaseKey.views).get('grid-view-id')?.set(YjsDatabaseKey.name, 'Updated Grid');
  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

describe('Feed view normalization', () => {
  it('shows only the primary field, clears groups, and marks the view as Feed', () => {
    const doc = createGridDatabaseDoc();

    expect(normalizeCreatedDatabaseFeedView(doc, 'grid-view-id', { name: 'Feed' })).toBe('grid-view-id');

    const view = getDatabase(doc).get(YjsDatabaseKey.views).get('grid-view-id');
    const fieldSettings = view.get(YjsDatabaseKey.field_settings);

    expect(view.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Feed);
    expect(view.get(YjsDatabaseKey.name)).toBe('Feed');
    expect(view.get(YjsDatabaseKey.groups)).toHaveLength(0);
    expect(fieldSettings.get('primary-field').get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
    expect(fieldSettings.get('secondary-field').get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysHidden);
    expect(view.get(YjsDatabaseKey.sorts) ?? []).toHaveLength(0);
  });

  it('adds a CreatedTime descending sort when the database has a CreatedTime field (Desktop layout_deps)', () => {
    const doc = createGridDatabaseDoc({ withCreatedTimeField: true });

    expect(normalizeCreatedDatabaseFeedView(doc, 'grid-view-id')).toBe('grid-view-id');

    const view = getDatabase(doc).get(YjsDatabaseKey.views).get('grid-view-id');
    const sorts = view.get(YjsDatabaseKey.sorts);

    expect(sorts).toHaveLength(1);
    expect(sorts.get(0).get(YjsDatabaseKey.field_id)).toBe('created-time-field');
    expect(Number(sorts.get(0).get(YjsDatabaseKey.condition))).toBe(SortCondition.Descending);
    expect(sorts.get(0).get(YjsDatabaseKey.id)).toBeTruthy();
  });

  it('keeps an existing sort instead of adding the CreatedTime default', () => {
    const doc = createGridDatabaseDoc({ withCreatedTimeField: true });
    const database = getDatabase(doc);
    const view = database.get(YjsDatabaseKey.views).get('grid-view-id') as YDatabaseView;
    const sorts = new Y.Array();
    const existing = new Y.Map();

    existing.set(YjsDatabaseKey.id, 'existing');
    existing.set(YjsDatabaseKey.field_id, 'primary-field');
    existing.set(YjsDatabaseKey.condition, SortCondition.Ascending);
    sorts.push([existing]);
    view.set(YjsDatabaseKey.sorts, sorts);

    expect(ensureFeedDefaultSort(database, view)).toBe(false);
    expect(view.get(YjsDatabaseKey.sorts)).toHaveLength(1);
    expect(view.get(YjsDatabaseKey.sorts).get(0).get(YjsDatabaseKey.id)).toBe('existing');
  });

  it('finds the CreatedTime field following the view order', () => {
    const doc = createGridDatabaseDoc({ withCreatedTimeField: true });
    const database = getDatabase(doc);
    const view = database.get(YjsDatabaseKey.views).get('grid-view-id');

    expect(findCreatedTimeFieldId(database, view.get(YjsDatabaseKey.field_orders))).toBe('created-time-field');
    expect(findCreatedTimeFieldId(getDatabase(createGridDatabaseDoc()))).toBeUndefined();
  });

  it('falls back to the inline view when the preferred view has no field orders', () => {
    const doc = createGridDatabaseDoc();

    expect(normalizeCreatedDatabaseFeedView(doc, 'missing-view-id')).toBe('grid-view-id');
    expect(getDatabase(doc).get(YjsDatabaseKey.views).get('grid-view-id').get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Feed
    );
  });
});

describe('createLinkedDatabaseFeedView lifecycle', () => {
  const scheduleDeferredCleanup = jest.fn();
  const payload = {
    parent_view_id: 'document-id',
    database_id: 'database-id',
    name: 'Linked Feed',
    embedded: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['database loader', { loadView: undefined }],
    ['sync binder', { bindViewSync: undefined }],
    ['rollback operation', { deletePage: undefined }],
    ['sync cleanup scheduler', { scheduleDeferredCleanup: undefined }],
  ])('prevalidates the %s before creating a linked child', async (_name, missingCapability) => {
    const createDatabaseView = jest.fn();

    await expect(
      createLinkedDatabaseFeedView({
        requestViewId: 'document-id',
        sourceViewId: 'grid-view-id',
        payload,
        createDatabaseView,
        loadView: jest.fn(async () => createGridDatabaseDoc()),
        bindViewSync: jest.fn(() => null),
        deletePage: jest.fn(async () => undefined),
        scheduleDeferredCleanup,
        ...missingCapability,
      })
    ).rejects.toThrow('Linked Feed creation is not available right now');

    expect(createDatabaseView).not.toHaveBeenCalled();
  });

  it('normalizes and flushes the exact server-created Feed', async () => {
    const databaseDoc = createGridDatabaseDoc({ withCreatedTimeField: true });
    const response = {
      view_id: 'feed-view-id',
      database_id: 'database-id',
      database_update: createFeedUpdate(databaseDoc),
    };
    const createDatabaseView = jest.fn().mockResolvedValue(response);
    const loadView = jest.fn().mockResolvedValue(databaseDoc);
    const flush = jest.fn().mockResolvedValue(true);
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseFeedView({
        requestViewId: 'document-id',
        sourceViewId: 'grid-view-id',
        payload,
        createDatabaseView,
        loadView,
        bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup,
      })
    ).resolves.toEqual(response);

    expect(createDatabaseView).toHaveBeenCalledWith('document-id', { ...payload, layout: ViewLayout.Feed });
    expect(loadView).toHaveBeenCalledWith('grid-view-id', false, false, {
      databaseId: 'database-id',
      forceFetch: true,
    });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
    expect(deletePage).not.toHaveBeenCalled();

    const view = getDatabase(databaseDoc).get(YjsDatabaseKey.views).get('feed-view-id');

    expect(view.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Feed);
    expect(view.get(YjsDatabaseKey.sorts)).toHaveLength(1);
    expect(getDatabase(databaseDoc).get(YjsDatabaseKey.views).get('grid-view-id').get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Grid
    );
  });

  it('rolls back the returned child when its update is missing', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseFeedView({
        requestViewId: 'document-id',
        sourceViewId: 'grid-view-id',
        payload,
        createDatabaseView: jest.fn().mockResolvedValue({ view_id: 'feed-view-id', database_id: 'database-id' }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush: jest.fn() } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup: jest.fn(),
      })
    ).rejects.toThrow('The server did not return the linked Feed database update');
    expect(deletePage).toHaveBeenCalledWith('feed-view-id');
  });

  it('does not normalize an existing Grid when the update lacks the returned Feed child', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseFeedView({
        requestViewId: 'document-id',
        sourceViewId: 'grid-view-id',
        payload,
        createDatabaseView: jest.fn().mockResolvedValue({
          view_id: 'feed-view-id',
          database_id: 'database-id',
          database_update: createUpdateWithoutFeedView(databaseDoc),
        }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush: jest.fn() } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup,
      })
    ).rejects.toThrow('The server did not return the linked Feed database view');

    expect(getDatabase(databaseDoc).get(YjsDatabaseKey.views).get('grid-view-id')?.get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Grid
    );
    expect(deletePage).toHaveBeenCalledWith('feed-view-id');
  });

  it('removes the exact linked child when Feed normalization cannot be flushed', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const deletePage = jest.fn().mockResolvedValue(undefined);
    const flush = jest.fn().mockResolvedValue(false);

    await expect(
      createLinkedDatabaseFeedView({
        requestViewId: 'document-id',
        sourceViewId: 'grid-view-id',
        payload,
        createDatabaseView: jest.fn().mockResolvedValue({
          view_id: 'feed-view-id',
          database_id: 'database-id',
          database_update: createFeedUpdate(databaseDoc),
        }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup,
      })
    ).rejects.toThrow('The linked Feed could not be persisted');

    const views = getDatabase(databaseDoc).get(YjsDatabaseKey.views);

    expect(views.has('feed-view-id')).toBe(false);
    expect(views.has('grid-view-id')).toBe(true);
    expect(deletePage).toHaveBeenCalledWith('feed-view-id');
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
  });
});

describe('createDatabaseFeedPageViaGrid lifecycle', () => {
  it('converts an embedded Grid page to Feed and aligns its folder name', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const flush = jest.fn().mockResolvedValue(true);
    const updatePage = jest.fn().mockResolvedValue(undefined);
    const scheduleDeferredCleanup = jest.fn();

    await expect(
      createDatabaseFeedPageViaGrid({
        parentViewId: 'document-id',
        name: 'New Database',
        addPage: jest.fn().mockResolvedValue({ view_id: 'grid-view-id', database_id: 'database-id' }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
        deletePage: jest.fn().mockResolvedValue(undefined),
        scheduleDeferredCleanup,
        updatePage,
      })
    ).resolves.toEqual({ view_id: 'grid-view-id', database_id: 'database-id' });

    expect(updatePage).toHaveBeenCalledWith('grid-view-id', { name: 'Feed' });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);

    const view = getDatabase(databaseDoc).get(YjsDatabaseKey.views).get('grid-view-id');

    expect(view.get(YjsDatabaseKey.name)).toBe('Feed');
    expect(view.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Feed);
  });

  it('replaces the temporary standalone Grid child, selects Feed, and flushes cleanup', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const flush = jest.fn().mockResolvedValue(true);
    const deletePage = jest.fn().mockResolvedValue(undefined);
    const deleteTrash = jest.fn().mockResolvedValue(undefined);
    const scheduleDeferredCleanup = jest.fn();
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'feed-view-id',
      database_id: 'database-id',
      database_update: createFeedUpdate(databaseDoc),
    });

    await expect(
      createDatabaseFeedPageViaGrid({
        parentViewId: 'parent-id',
        name: 'New Database',
        standalone: true,
        addPage: jest.fn().mockResolvedValue({ view_id: 'container-id', database_id: 'database-id' }),
        loadViewMeta: jest.fn().mockResolvedValue({
          view_id: 'container-id',
          children: [{ view_id: 'grid-view-id', layout: ViewLayout.Grid }],
        }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
        createDatabaseView,
        deletePage,
        deleteTrash,
        scheduleDeferredCleanup,
      })
    ).resolves.toMatchObject({ view_id: 'feed-view-id', database_id: 'database-id' });

    expect(createDatabaseView).toHaveBeenCalledWith('grid-view-id', {
      parent_view_id: 'container-id',
      prev_view_id: 'grid-view-id',
      database_id: 'database-id',
      layout: ViewLayout.Feed,
      name: 'Feed',
      embedded: false,
    });
    expect(deletePage).toHaveBeenCalledWith('grid-view-id');
    expect(deleteTrash).toHaveBeenCalledWith('grid-view-id');
    expect(flush).toHaveBeenCalledTimes(2);

    const database = getDatabase(databaseDoc);

    expect(database.get(YjsDatabaseKey.views).has('grid-view-id')).toBe(false);
    expect(database.get(YjsDatabaseKey.metas).get(YjsDatabaseKey.iid)).toBe('feed-view-id');
    expect(database.get(YjsDatabaseKey.views).get('feed-view-id').get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Feed
    );
  });

  it('prevalidates standalone rollback capabilities before creating anything', async () => {
    const addPage = jest.fn();

    await expect(
      createDatabaseFeedPageViaGrid({
        parentViewId: 'parent-id',
        standalone: true,
        addPage,
        loadView: jest.fn(),
        bindViewSync: jest.fn(),
        loadViewMeta: jest.fn(),
        createDatabaseView: jest.fn(),
        deletePage: jest.fn(),
        scheduleDeferredCleanup: jest.fn(),
      })
    ).rejects.toThrow('Standalone Feed creation is not available right now');
    expect(addPage).not.toHaveBeenCalled();
  });

  it('does not normalize another view when the returned embedded Feed child is missing', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createDatabaseFeedPageViaGrid({
        parentViewId: 'document-id',
        addPage: jest.fn().mockResolvedValue({ view_id: 'missing-feed-view', database_id: 'database-id' }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush: jest.fn() } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup: jest.fn(),
      })
    ).rejects.toThrow('The server did not return the embedded Feed database view');

    expect(getDatabase(databaseDoc).get(YjsDatabaseKey.views).get('grid-view-id')?.get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Grid
    );
    expect(deletePage).toHaveBeenCalledWith('missing-feed-view');
  });
});
