import * as Y from 'yjs';

import {
  createDatabaseGalleryPageViaGrid,
  createLinkedDatabaseGalleryView,
  normalizeCreatedDatabaseGalleryView,
} from '@/application/database-yjs/gallery-layout';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  DatabaseViewLayout,
  GalleryCardPreview,
  GalleryCardSize,
  ViewLayout,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createGridDatabaseDoc(): YDoc {
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
  primaryField.set(YjsDatabaseKey.type, 0);
  secondaryField.set(YjsDatabaseKey.id, 'secondary-field');
  secondaryField.set(YjsDatabaseKey.is_primary, false);
  secondaryField.set(YjsDatabaseKey.type, 3);
  fields.set('primary-field', primaryField);
  fields.set('secondary-field', secondaryField);
  fieldOrders.push([{ id: 'primary-field' }, { id: 'secondary-field' }]);
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

function createGalleryUpdate(databaseDoc: YDoc, viewId = 'gallery-view-id'): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const views = database.get(YjsDatabaseKey.views);
  const gridView = views.get('grid-view-id');
  const galleryView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push(gridView.get(YjsDatabaseKey.field_orders).toArray());
  galleryView.set(YjsDatabaseKey.id, viewId);
  galleryView.set(YjsDatabaseKey.name, 'Gallery');
  galleryView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  galleryView.set(YjsDatabaseKey.field_orders, fieldOrders);
  galleryView.set(YjsDatabaseKey.field_settings, new Y.Map());
  galleryView.set(YjsDatabaseKey.groups, new Y.Array());
  galleryView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, galleryView);
  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

function createUpdateWithoutGalleryView(databaseDoc: YDoc): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  database.get(YjsDatabaseKey.views).get('grid-view-id')?.set(YjsDatabaseKey.name, 'Updated Grid');
  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

describe('Gallery view normalization', () => {
  it('writes Flutter-compatible settings and shows only the primary field by default', () => {
    const doc = createGridDatabaseDoc();

    expect(normalizeCreatedDatabaseGalleryView(doc, 'grid-view-id', { name: 'Gallery' })).toBe('grid-view-id');

    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const view = database.get(YjsDatabaseKey.views).get('grid-view-id');
    const fieldSettings = view.get(YjsDatabaseKey.field_settings);
    const gallery = view.get(YjsDatabaseKey.layout_settings).get('5');

    expect(view.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Gallery);
    expect(view.get(YjsDatabaseKey.name)).toBe('Gallery');
    expect(view.get(YjsDatabaseKey.groups)).toHaveLength(0);
    expect(fieldSettings.get('primary-field').get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
    expect(fieldSettings.get('secondary-field').get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysHidden);
    expect(gallery.get(YjsDatabaseKey.show_cover)).toBe(true);
    expect(gallery.get(YjsDatabaseKey.fit_image)).toBe(false);
    expect(gallery.get(YjsDatabaseKey.card_size)).toBe(GalleryCardSize.Medium);
    expect(gallery.get(YjsDatabaseKey.card_preview)).toBe(GalleryCardPreview.PageCover);
    expect(gallery.get(YjsDatabaseKey.card_width)).toBe(0);
  });
});

describe('createLinkedDatabaseGalleryView lifecycle', () => {
  const scheduleDeferredCleanup = jest.fn();
  const payload = {
    parent_view_id: 'document-id',
    database_id: 'database-id',
    name: 'Linked Gallery',
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
      createLinkedDatabaseGalleryView({
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
    ).rejects.toThrow('Linked Gallery creation is not available right now');

    expect(createDatabaseView).not.toHaveBeenCalled();
  });

  it('normalizes and flushes the exact server-created Gallery', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const response = {
      view_id: 'gallery-view-id',
      database_id: 'database-id',
      database_update: createGalleryUpdate(databaseDoc),
    };
    const createDatabaseView = jest.fn().mockResolvedValue(response);
    const loadView = jest.fn().mockResolvedValue(databaseDoc);
    const flush = jest.fn().mockResolvedValue(true);
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseGalleryView({
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

    expect(createDatabaseView).toHaveBeenCalledWith('document-id', { ...payload, layout: ViewLayout.Gallery });
    expect(loadView).toHaveBeenCalledWith('grid-view-id', false, false, {
      databaseId: 'database-id',
      forceFetch: true,
    });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
    expect(deletePage).not.toHaveBeenCalled();

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(database.get(YjsDatabaseKey.views).get('gallery-view-id').get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Gallery
    );
  });

  it('rolls back the returned child when its update is missing', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseGalleryView({
        requestViewId: 'document-id',
        sourceViewId: 'grid-view-id',
        payload,
        createDatabaseView: jest.fn().mockResolvedValue({
          view_id: 'gallery-view-id',
          database_id: 'database-id',
        }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush: jest.fn() } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup: jest.fn(),
      })
    ).rejects.toThrow('The server did not return the linked Gallery database update');
    expect(deletePage).toHaveBeenCalledWith('gallery-view-id');
  });

  it('does not normalize an existing Grid when the update lacks the returned Gallery child', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createLinkedDatabaseGalleryView({
        requestViewId: 'document-id',
        sourceViewId: 'grid-view-id',
        payload,
        createDatabaseView: jest.fn().mockResolvedValue({
          view_id: 'gallery-view-id',
          database_id: 'database-id',
          database_update: createUpdateWithoutGalleryView(databaseDoc),
        }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush: jest.fn() } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup,
      })
    ).rejects.toThrow('The server did not return the linked Gallery database view');

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(database.get(YjsDatabaseKey.views).get('grid-view-id')?.get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Grid
    );
    expect(deletePage).toHaveBeenCalledWith('gallery-view-id');
  });

  it('removes the exact linked child when Gallery normalization cannot be flushed', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const deletePage = jest.fn().mockResolvedValue(undefined);
    const flush = jest.fn().mockResolvedValue(false);

    await expect(
      createLinkedDatabaseGalleryView({
        requestViewId: 'document-id',
        sourceViewId: 'grid-view-id',
        payload,
        createDatabaseView: jest.fn().mockResolvedValue({
          view_id: 'gallery-view-id',
          database_id: 'database-id',
          database_update: createGalleryUpdate(databaseDoc),
        }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup,
      })
    ).rejects.toThrow('The linked Gallery could not be persisted');

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(database.get(YjsDatabaseKey.views).has('gallery-view-id')).toBe(false);
    expect(database.get(YjsDatabaseKey.views).has('grid-view-id')).toBe(true);
    expect(deletePage).toHaveBeenCalledWith('gallery-view-id');
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
  });
});

describe('createDatabaseGalleryPageViaGrid lifecycle', () => {
  it('converts an embedded Grid page to Gallery and aligns its folder name', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const flush = jest.fn().mockResolvedValue(true);
    const updatePage = jest.fn().mockResolvedValue(undefined);
    const scheduleDeferredCleanup = jest.fn();

    await expect(
      createDatabaseGalleryPageViaGrid({
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

    expect(updatePage).toHaveBeenCalledWith('grid-view-id', { name: 'Gallery' });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const view = database.get(YjsDatabaseKey.views).get('grid-view-id');

    expect(view.get(YjsDatabaseKey.name)).toBe('Gallery');
    expect(view.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Gallery);
  });

  it('replaces the temporary standalone Grid child, selects Gallery, and flushes cleanup', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const flush = jest.fn().mockResolvedValue(true);
    const deletePage = jest.fn().mockResolvedValue(undefined);
    const deleteTrash = jest.fn().mockResolvedValue(undefined);
    const scheduleDeferredCleanup = jest.fn();
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'gallery-view-id',
      database_id: 'database-id',
      database_update: createGalleryUpdate(databaseDoc),
    });

    await expect(
      createDatabaseGalleryPageViaGrid({
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
    ).resolves.toMatchObject({ view_id: 'gallery-view-id', database_id: 'database-id' });

    expect(createDatabaseView).toHaveBeenCalledWith('grid-view-id', {
      parent_view_id: 'container-id',
      prev_view_id: 'grid-view-id',
      database_id: 'database-id',
      layout: ViewLayout.Gallery,
      name: 'Gallery',
      embedded: false,
    });
    expect(deletePage).toHaveBeenCalledWith('grid-view-id');
    expect(deleteTrash).toHaveBeenCalledWith('grid-view-id');
    expect(flush).toHaveBeenCalledTimes(2);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(database.get(YjsDatabaseKey.views).has('grid-view-id')).toBe(false);
    expect(database.get(YjsDatabaseKey.metas).get(YjsDatabaseKey.iid)).toBe('gallery-view-id');
  });

  it('prevalidates standalone rollback capabilities before creating anything', async () => {
    const addPage = jest.fn();

    await expect(
      createDatabaseGalleryPageViaGrid({
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
    ).rejects.toThrow('Standalone Gallery creation is not available right now');
    expect(addPage).not.toHaveBeenCalled();
  });

  it('does not normalize another view when the returned embedded Gallery child is missing', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const deletePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      createDatabaseGalleryPageViaGrid({
        parentViewId: 'document-id',
        addPage: jest.fn().mockResolvedValue({ view_id: 'missing-gallery-view', database_id: 'database-id' }),
        loadView: jest.fn().mockResolvedValue(databaseDoc),
        bindViewSync: jest.fn(() => ({ flush: jest.fn() } as unknown as SyncContext)),
        deletePage,
        scheduleDeferredCleanup: jest.fn(),
      })
    ).rejects.toThrow('The server did not return the embedded Gallery database view');

    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(database.get(YjsDatabaseKey.views).get('grid-view-id')?.get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Grid
    );
    expect(deletePage).toHaveBeenCalledWith('missing-gallery-view');
  });
});
