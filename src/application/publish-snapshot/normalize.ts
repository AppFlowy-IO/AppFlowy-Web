import type {
  PublishedDatabaseSnapshot,
  PublishedDatabaseSnapshotPayload,
  PublishedDocumentSnapshot,
  PublishedDocumentSnapshotPayload,
  PublishedJsonObject,
  PublishedPageSnapshot,
  PublishedPageSnapshotPayload,
  PublishedView,
  PublishedViewPayload,
} from './types';

function normalizeView(view: PublishedViewPayload): PublishedView {
  return {
    ...view,
    childViews: view.childViews ?? [],
    ancestorViews: view.ancestorViews ?? [],
    visibleViewIds: view.visibleViewIds ?? [],
    databaseRelations: view.databaseRelations ?? {},
  };
}

function normalizeDocumentSnapshot(snapshot: PublishedDocumentSnapshotPayload): PublishedDocumentSnapshot {
  const document = snapshot.document ?? {};

  return {
    ...snapshot,
    view: normalizeView(snapshot.view),
    document: {
      ...document,
      children: document.children ?? [],
    },
  };
}

function normalizeDatabaseSnapshot(snapshot: PublishedDatabaseSnapshotPayload): PublishedDatabaseSnapshot {
  const raw = snapshot.database.raw ?? {
    database: {} as PublishedJsonObject,
    rows: {},
    row_documents: {},
  };

  return {
    ...snapshot,
    view: normalizeView(snapshot.view),
    database: {
      ...snapshot.database,
      visibleViewIds: snapshot.database.visibleViewIds ?? [],
      fields: snapshot.database.fields ?? [],
      views: snapshot.database.views ?? [],
      rows: snapshot.database.rows ?? [],
      raw: {
        database: raw.database ?? {},
        rows: raw.rows ?? {},
        row_documents: raw.row_documents ?? {},
      },
    },
  };
}

export function normalizePublishedPageSnapshot(snapshot: PublishedPageSnapshotPayload): PublishedPageSnapshot {
  if (snapshot.kind === 'document') {
    return normalizeDocumentSnapshot(snapshot);
  }

  return normalizeDatabaseSnapshot(snapshot);
}
