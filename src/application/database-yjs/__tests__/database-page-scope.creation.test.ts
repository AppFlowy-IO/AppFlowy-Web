import * as Y from 'yjs';

import { createDatabaseFeedPageViaGrid } from '@/application/database-yjs/feed-layout';
import { createDatabaseGalleryPageViaGrid } from '@/application/database-yjs/gallery-layout';
import { createDatabaseListPageViaGrid } from '@/application/database-yjs/list-layout';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  DatabaseViewLayout,
  ViewLayout,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

const pageCreators = [
  {
    name: 'List',
    create: createDatabaseListPageViaGrid,
    layout: ViewLayout.List,
    databaseLayout: DatabaseViewLayout.List,
  },
  {
    name: 'Gallery',
    create: createDatabaseGalleryPageViaGrid,
    layout: ViewLayout.Gallery,
    databaseLayout: DatabaseViewLayout.Gallery,
  },
  {
    name: 'Feed',
    create: createDatabaseFeedPageViaGrid,
    layout: ViewLayout.Feed,
    databaseLayout: DatabaseViewLayout.Feed,
  },
];

function createGridDatabase(embedded: boolean): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map();
  const primary = new Y.Map();
  const views = new Y.Map();
  const metas = new Y.Map();
  const grid = new Y.Map();
  const fieldOrders = new Y.Array();

  primary.set(YjsDatabaseKey.id, 'primary-field');
  primary.set(YjsDatabaseKey.is_primary, true);
  primary.set(YjsDatabaseKey.type, 0);
  fields.set('primary-field', primary);
  fieldOrders.push([{ id: 'primary-field' }]);
  grid.set(YjsDatabaseKey.id, 'grid-view');
  grid.set(YjsDatabaseKey.name, 'Grid');
  grid.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  grid.set(YjsDatabaseKey.embedded, embedded);
  grid.set(YjsDatabaseKey.field_orders, fieldOrders);
  grid.set(YjsDatabaseKey.field_settings, new Y.Map());
  grid.set(YjsDatabaseKey.layout_settings, new Y.Map());
  grid.set(YjsDatabaseKey.groups, new Y.Array());
  views.set('grid-view', grid);
  metas.set(YjsDatabaseKey.iid, 'grid-view');
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, metas);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return doc;
}

function getDatabase(doc: YDoc): YDatabase {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
}

describe.each(pageCreators)(
  '$name page creation respects server database scope',
  ({ name, create, layout, databaseLayout }) => {
    it('converts the concrete embedded Grid returned for a full-page request under a document', async () => {
      const doc = createGridDatabase(true);
      const flush = jest.fn().mockResolvedValue(true);
      const createDatabaseView = jest.fn();
      const deletePage = jest.fn();
      const deleteTrash = jest.fn();
      const scheduleDeferredCleanup = jest.fn();
      const updatePage = jest.fn().mockResolvedValue(undefined);

      await expect(
        create({
          parentViewId: 'document-id',
          standalone: true,
          addPage: jest.fn().mockResolvedValue({ view_id: 'grid-view', database_id: 'database-id' }),
          loadViewMeta: jest.fn().mockResolvedValue({
            view_id: 'grid-view',
            parent_view_id: 'container-id',
            layout: ViewLayout.Grid,
            extra: { embedded: true, database_id: 'database-id' },
            children: [],
          }),
          loadView: jest.fn().mockResolvedValue(doc),
          bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
          createDatabaseView,
          deletePage,
          deleteTrash,
          scheduleDeferredCleanup,
          updatePage,
        })
      ).resolves.toMatchObject({ view_id: 'grid-view', database_id: 'database-id' });

      const view = getDatabase(doc).get(YjsDatabaseKey.views).get('grid-view');

      expect(view.get(YjsDatabaseKey.layout)).toBe(databaseLayout);
      expect(view.get(YjsDatabaseKey.embedded)).toBe(true);
      expect(updatePage).toHaveBeenCalledWith('grid-view', { name });
      expect(createDatabaseView).not.toHaveBeenCalled();
      expect(deletePage).not.toHaveBeenCalled();
      expect(deleteTrash).not.toHaveBeenCalled();
      expect(flush).toHaveBeenCalledTimes(1);
      expect(scheduleDeferredCleanup).toHaveBeenCalledWith(doc.guid);
    });

    it('only soft-deletes the returned embedded child when full-page conversion fails', async () => {
      const doc = createGridDatabase(true);
      const deletePage = jest.fn().mockResolvedValue(undefined);
      const deleteTrash = jest.fn().mockResolvedValue(undefined);

      await expect(
        create({
          parentViewId: 'document-id',
          standalone: true,
          addPage: jest.fn().mockResolvedValue({ view_id: 'grid-view', database_id: 'database-id' }),
          loadViewMeta: jest.fn().mockResolvedValue({
            view_id: 'grid-view',
            parent_view_id: 'container-id',
            layout: ViewLayout.Grid,
            extra: { embedded: true },
            children: [],
          }),
          loadView: jest.fn().mockResolvedValue(doc),
          bindViewSync: jest.fn(() => null),
          createDatabaseView: jest.fn(),
          deletePage,
          deleteTrash,
          scheduleDeferredCleanup: jest.fn(),
        })
      ).rejects.toThrow(`The new embedded ${name} could not be connected for persistence`);

      expect(deletePage).toHaveBeenCalledTimes(1);
      expect(deletePage).toHaveBeenCalledWith('grid-view');
      expect(deleteTrash).not.toHaveBeenCalled();
      expect(getDatabase(doc).get(YjsDatabaseKey.views).get('grid-view').get(YjsDatabaseKey.embedded)).toBe(true);
    });

    it('keeps cleanup recoverable when returned-view metadata is unavailable', async () => {
      const deletePage = jest.fn().mockResolvedValue(undefined);
      const deleteTrash = jest.fn().mockResolvedValue(undefined);
      const createDatabaseView = jest.fn();
      const loadView = jest.fn();

      await expect(
        create({
          parentViewId: 'document-id',
          standalone: true,
          addPage: jest.fn().mockResolvedValue({ view_id: 'returned-view', database_id: 'database-id' }),
          loadViewMeta: jest.fn().mockRejectedValue(new Error('metadata unavailable')),
          loadView,
          bindViewSync: jest.fn(),
          createDatabaseView,
          deletePage,
          deleteTrash,
          scheduleDeferredCleanup: jest.fn(),
        })
      ).rejects.toThrow('The new database container did not contain exactly one Grid view');

      expect(deletePage).toHaveBeenCalledTimes(1);
      expect(deletePage).toHaveBeenCalledWith('returned-view');
      expect(deleteTrash).not.toHaveBeenCalled();
      expect(loadView).not.toHaveBeenCalled();
      expect(createDatabaseView).not.toHaveBeenCalled();
    });

    it.each([
      { embedded: true, containerMarker: true },
      { embedded: false, containerMarker: true },
      { embedded: undefined, containerMarker: true },
      { embedded: undefined, containerMarker: undefined },
    ])(
      'inherits embedded=$embedded from a returned container with marker=$containerMarker',
      async ({ embedded, containerMarker }) => {
        const doc = createGridDatabase(embedded === true);
        const flush = jest.fn().mockResolvedValue(true);
        const deletePage = jest.fn().mockResolvedValue(undefined);
        const deleteTrash = jest.fn().mockResolvedValue(undefined);
        const scheduleDeferredCleanup = jest.fn();
        const createDatabaseView = jest.fn(async (_viewId: string, payload: CreateDatabaseViewPayload) => {
          if (payload.embedded !== (embedded === true)) {
            throw new Error('linked database view embedded state must match its container');
          }

          const serverDoc = new Y.Doc() as unknown as YDoc;

          Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(doc));
          const serverViews = getDatabase(serverDoc).get(YjsDatabaseKey.views);
          const copiedView = serverViews.get('grid-view').clone();

          copiedView.set(YjsDatabaseKey.id, 'replacement-view');
          copiedView.set(YjsDatabaseKey.embedded, payload.embedded);
          serverViews.set('replacement-view', copiedView);
          return {
            view_id: 'replacement-view',
            database_id: 'database-id',
            database_update: Array.from(Y.encodeStateAsUpdate(serverDoc, Y.encodeStateVector(doc))),
          };
        });

        await expect(
          create({
            parentViewId: embedded ? 'document-id' : 'space-id',
            standalone: true,
            addPage: jest.fn().mockResolvedValue({ view_id: 'container-id', database_id: 'database-id' }),
            loadViewMeta: jest.fn().mockResolvedValue({
              view_id: 'container-id',
              layout: ViewLayout.Grid,
              extra: { is_database_container: containerMarker, embedded },
              children: [{ view_id: 'grid-view', layout: ViewLayout.Grid }],
            }),
            loadView: jest.fn().mockResolvedValue(doc),
            bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
            createDatabaseView,
            deletePage,
            deleteTrash,
            scheduleDeferredCleanup,
          })
        ).resolves.toMatchObject({ view_id: 'replacement-view', database_id: 'database-id' });

        const database = getDatabase(doc);
        const views = database.get(YjsDatabaseKey.views);

        expect(createDatabaseView).toHaveBeenCalledWith(
          'grid-view',
          expect.objectContaining({
            parent_view_id: 'container-id',
            embedded: embedded === true,
            layout,
          })
        );
        expect(views.get('replacement-view').get(YjsDatabaseKey.embedded)).toBe(embedded === true);
        expect(views.get('replacement-view').get(YjsDatabaseKey.layout)).toBe(databaseLayout);
        expect(views.has('grid-view')).toBe(false);
        expect(database.get(YjsDatabaseKey.metas).get(YjsDatabaseKey.iid)).toBe('replacement-view');
        expect(deletePage).toHaveBeenCalledTimes(1);
        expect(deletePage).toHaveBeenCalledWith('grid-view');
        expect(deleteTrash).toHaveBeenCalledTimes(1);
        expect(deleteTrash).toHaveBeenCalledWith('grid-view');
        expect(flush).toHaveBeenCalledTimes(2);
        expect(scheduleDeferredCleanup).toHaveBeenCalledWith(doc.guid);
      }
    );
  }
);
