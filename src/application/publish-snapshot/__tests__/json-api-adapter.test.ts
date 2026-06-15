import { ViewLayout } from '@/application/types';
import { createJsonPublishSnapshotDataSource } from '@/application/publish-snapshot/json-api-adapter';
import type {
  PublishedDatabaseSnapshotPayload,
  PublishedDocumentSnapshotPayload,
} from '@/application/publish-snapshot/types';

describe('JsonPublishSnapshotDataSource', () => {
  it('normalizes optional view and document collections from the fetched snapshot', async () => {
    const snapshot: PublishedDocumentSnapshotPayload = {
      schemaVersion: 1,
      kind: 'document',
      namespace: 'namespace',
      publishName: 'publish-name',
      view: {
        viewId: 'view-id',
        name: 'Published document',
        icon: null,
        extra: null,
        layout: ViewLayout.Document,
      },
      document: {},
    };
    const dataSource = createJsonPublishSnapshotDataSource(async () => snapshot);

    await expect(dataSource.getPage('namespace', 'publish-name')).resolves.toMatchObject({
      view: {
        childViews: [],
        ancestorViews: [],
        visibleViewIds: [],
        databaseRelations: {},
      },
      document: {
        children: [],
      },
    });
  });

  it('normalizes optional database collections from the fetched snapshot', async () => {
    const snapshot: PublishedDatabaseSnapshotPayload = {
      schemaVersion: 1,
      kind: 'database',
      namespace: 'namespace',
      publishName: 'publish-name',
      view: {
        viewId: 'view-id',
        name: 'Published database',
        icon: null,
        extra: null,
        layout: ViewLayout.Grid,
      },
      database: {
        databaseId: 'database-id',
        activeViewId: 'view-id',
      },
    };
    const dataSource = createJsonPublishSnapshotDataSource(async () => snapshot);

    await expect(dataSource.getPage('namespace', 'publish-name')).resolves.toMatchObject({
      view: {
        childViews: [],
        ancestorViews: [],
        visibleViewIds: [],
        databaseRelations: {},
      },
      database: {
        visibleViewIds: [],
        fields: [],
        views: [],
        rows: [],
        raw: {
          database: {},
          rows: {},
          row_documents: {},
        },
      },
    });
  });
});
