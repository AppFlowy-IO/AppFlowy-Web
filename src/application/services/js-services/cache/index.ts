import * as Y from 'yjs';

import { migrateDatabaseFieldTypes } from '@/application/database-yjs/migrations/rollup_fieldtype';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { closeCollabDB, db, openCollabDB, openCollabDBWithProvider } from '@/application/db';
import { Fetcher, StrategyType } from '@/application/services/js-services/cache/types';
import {
  DatabaseId,
  PublishViewMetaData,
  RowId,
  Types,
  User,
  ViewId,
  ViewInfo,
  YDoc,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
import { Log } from '@/utils/log';

export function collabTypeToDBType(type: Types) {
  switch (type) {
    case Types.Folder:
      return 'folder';
    case Types.Document:
      return 'document';
    case Types.Database:
      return 'database';
    case Types.WorkspaceDatabase:
      return 'databases';
    case Types.DatabaseRow:
      return 'database_row';
    case Types.UserAwareness:
      return 'user_awareness';
    default:
      return '';
  }
}

const collabSharedRootKeyMap = {
  [Types.Folder]: YjsEditorKey.folder,
  [Types.Document]: YjsEditorKey.document,
  [Types.Database]: YjsEditorKey.database,
  [Types.WorkspaceDatabase]: YjsEditorKey.workspace_database,
  [Types.DatabaseRow]: YjsEditorKey.database_row,
  [Types.UserAwareness]: YjsEditorKey.user_awareness,
  [Types.Empty]: YjsEditorKey.empty,
};

export function hasCollabCache(doc: YDoc) {
  const data = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;

  return Object.values(collabSharedRootKeyMap).some((key) => {
    return data.has(key);
  });
}

export async function hasViewMetaCache(name: string) {
  const data = await db.view_metas.get(name);

  return !!data;
}

export async function hasUserCache(userId: string) {
  const data = await db.users.get(userId);

  return !!data;
}

export async function getPublishViewMeta<
  T extends {
    view: ViewInfo;
    child_views: ViewInfo[];
    ancestor_views: ViewInfo[];
  }
>(
  fetcher: Fetcher<T>,
  {
    namespace,
    publishName,
  }: {
    namespace: string;
    publishName: string;
  },
  strategy: StrategyType = StrategyType.CACHE_AND_NETWORK
) {
  const name = `${namespace}_${publishName}`;
  const exist = await hasViewMetaCache(name);
  const meta = await db.view_metas.get(name);

  switch (strategy) {
    case StrategyType.CACHE_ONLY: {
      if (!exist) {
        throw new Error('No cache found');
      }

      return meta;
    }

    case StrategyType.CACHE_FIRST: {
      if (!exist) {
        return revalidatePublishViewMeta(name, fetcher);
      }

      return meta;
    }

    case StrategyType.CACHE_AND_NETWORK: {
      if (!exist) {
        return revalidatePublishViewMeta(name, fetcher);
      } else {
        void revalidatePublishViewMeta(name, fetcher);
      }

      return meta;
    }

    default: {
      return revalidatePublishViewMeta(name, fetcher);
    }
  }
}

export async function getUser<T extends User>(
  fetcher: Fetcher<T>,
  userId?: string,
  strategy: StrategyType = StrategyType.CACHE_AND_NETWORK
) {
  const exist = userId && (await hasUserCache(userId));

  switch (strategy) {
    case StrategyType.CACHE_ONLY: {
      if (!exist) {
        throw new Error('No cache found');
      }

      const data = await db.users.get(userId);

      return data;
    }

    case StrategyType.CACHE_FIRST: {
      if (!exist) {
        return revalidateUser(fetcher);
      }

      const data = await db.users.get(userId);

      return data;
    }

    case StrategyType.CACHE_AND_NETWORK: {
      if (!exist) {
        return revalidateUser(fetcher);
      } else {
        void revalidateUser(fetcher);
      }

      const data = await db.users.get(userId);

      return data;
    }

    default: {
      return revalidateUser(fetcher);
    }
  }
}

export async function getPublishView<
  T extends {
    data: Uint8Array;
    rows?: Record<RowId, number[]>;
    visibleViewIds?: ViewId[];
    relations?: Record<DatabaseId, ViewId>;
    subDocuments?: Record<string, number[]>;
    meta: {
      view: ViewInfo;
      child_views: ViewInfo[];
      ancestor_views: ViewInfo[];
    };
  }
>(
  fetcher: Fetcher<T>,
  {
    namespace,
    publishName,
  }: {
    namespace: string;
    publishName: string;
  },
  strategy: StrategyType = StrategyType.CACHE_AND_NETWORK
) {
  const name = `${namespace}_${publishName}`;

  const doc = await openCollabDB(name);

  const exist = (await hasViewMetaCache(name)) && hasCollabCache(doc);
  let didRevalidate = false;

  switch (strategy) {
    case StrategyType.CACHE_ONLY: {
      if (!exist) {
        throw new Error('No cache found');
      }

      break;
    }

    case StrategyType.CACHE_FIRST: {
      if (!exist) {
        await revalidatePublishView(name, fetcher, doc);
        didRevalidate = true;
      }

      break;
    }

    case StrategyType.CACHE_AND_NETWORK: {
      if (!exist) {
        await revalidatePublishView(name, fetcher, doc);
        didRevalidate = true;
      } else {
        void revalidatePublishView(name, fetcher, doc);
      }

      break;
    }

    default: {
      await revalidatePublishView(name, fetcher, doc);
      didRevalidate = true;
      break;
    }
  }

  if (!didRevalidate && exist) {
    await migrateDatabaseFieldTypes(doc, {
      loadRow: createRow,
      commitVersion: strategy !== StrategyType.CACHE_AND_NETWORK,
    });
  }

  return { doc };
}

export async function getPageDoc<
  T extends {
    data: Uint8Array;
    rows?: Record<RowId, number[]>;
  }
>(fetcher: Fetcher<T>, name: string, strategy: StrategyType = StrategyType.CACHE_AND_NETWORK) {
  const doc = await openCollabDB(name);

  const exist = hasCollabCache(doc);
  let didRevalidate = false;

  switch (strategy) {
    case StrategyType.CACHE_ONLY: {
      break;
    }

    case StrategyType.CACHE_FIRST: {
      if (!exist) {
        await revalidateView(fetcher, doc);
        didRevalidate = true;
      }

      break;
    }

    case StrategyType.CACHE_AND_NETWORK: {
      if (!exist) {
        await revalidateView(fetcher, doc);
        didRevalidate = true;
      } else {
        void revalidateView(fetcher, doc);
      }

      break;
    }

    default: {
      await revalidateView(fetcher, doc);
      didRevalidate = true;
      break;
    }
  }

  if (!didRevalidate && exist) {
    await migrateDatabaseFieldTypes(doc, {
      loadRow: createRow,
      commitVersion: strategy !== StrategyType.CACHE_AND_NETWORK,
    });
  }

  return { doc };
}

async function updateRows(collab: YDoc, rows: Record<RowId, number[]>) {
  const bulkData = [];

  for (const [key, value] of Object.entries(rows)) {
    const rowKey = getRowKey(collab.guid, key);
    const doc = await createRow(rowKey);

    const dbRow = await db.rows.get(key);

    applyYDoc(doc, new Uint8Array(value));

    bulkData.push({
      row_id: key,
      version: (dbRow?.version || 0) + 1,
      row_key: rowKey,
    });
  }

  await db.rows.bulkPut(bulkData);
}

export async function revalidateView<
  T extends {
    data: Uint8Array;
    rows?: Record<RowId, number[]>;
  }
>(fetcher: Fetcher<T>, collab: YDoc) {
  try {
    const { data, rows } = await fetcher();

    if (rows) {
      await updateRows(collab, rows);
    }

    applyYDoc(collab, data);

    await migrateDatabaseFieldTypes(collab, {
      loadRow: createRow,
      rowIds: rows ? Object.keys(rows) : undefined,
    });
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function revalidatePublishViewMeta<
  T extends {
    view: ViewInfo;
    child_views: ViewInfo[];
    ancestor_views: ViewInfo[];
  }
>(name: string, fetcher: Fetcher<T>) {
  const { view, child_views, ancestor_views } = await fetcher();

  const dbView = await db.view_metas.get(name);

  await db.view_metas.put(
    {
      publish_name: name,
      ...view,
      child_views: child_views,
      ancestor_views: ancestor_views,
      visible_view_ids: dbView?.visible_view_ids ?? [],
      database_relations: dbView?.database_relations ?? {},
    },
    name
  );

  return db.view_metas.get(name);
}

export async function revalidatePublishView<
  T extends {
    data: Uint8Array;
    rows?: Record<RowId, number[]>;
    visibleViewIds?: ViewId[];
    relations?: Record<DatabaseId, ViewId>;
    subDocuments?: Record<string, number[]>;
    meta: PublishViewMetaData;
  }
>(name: string, fetcher: Fetcher<T>, collab: YDoc) {
  const { data, meta, rows, visibleViewIds = [], relations = {}, subDocuments } = await fetcher();

  await db.view_metas.put(
    {
      publish_name: name,
      ...meta.view,
      child_views: meta.child_views,
      ancestor_views: meta.ancestor_views,
      visible_view_ids: visibleViewIds,
      database_relations: relations,
    },
    name
  );

  if (rows) {
    await updateRows(collab, rows);
  }

  if (subDocuments) {
    for (const [key, value] of Object.entries(subDocuments)) {
      const doc = await openCollabDB(key);

      applyYDoc(doc, new Uint8Array(value));
    }
  }

  applyYDoc(collab, data);

  await migrateDatabaseFieldTypes(collab, {
    loadRow: createRow,
    rowIds: rows ? Object.keys(rows) : undefined,
  });
}

export async function deleteViewMeta(name: string) {
  try {
    await db.view_metas.delete(name);
  } catch (e) {
    console.error(e);
  }
}

export async function deleteView(name: string) {
  Log.debug('deleteView', name);
  await deleteViewMeta(name);
  await closeCollabDB(name);

  await closeCollabDB(`${name}_rows`);
}

export async function revalidateUser<T extends User>(fetcher: Fetcher<T>) {
  const data = await fetcher();

  await db.users.put(data, data.uuid);

  return data;
}

type RowDocEntry = {
  doc: YDoc;
  whenSynced: Promise<void>;
};

const ROW_SYNC_LOG_LIMIT = 50;
const ROW_FAST_LOG_LIMIT = 50;
let rowSyncLogCount = 0;
let rowFastLogCount = 0;

const rowDocs = new Map<string, RowDocEntry>();

async function getOrCreateRowDocEntry(rowKey: string): Promise<RowDocEntry> {
  const existing = rowDocs.get(rowKey);

  if (existing) {
    Log.debug('[Database] getOrCreateRowDocEntry returning existing entry', {
      rowKey,
      hasDoc: Boolean(existing.doc),
    });
    return existing;
  }

  Log.debug('[Database] getOrCreateRowDocEntry creating new entry', {
    rowKey,
  });

  const startedAt = Date.now();
  const { doc, provider } = await openCollabDBWithProvider(rowKey, { awaitSync: false });

  // Check initial state immediately after opening
  const initialSharedRoot = doc.getMap(YjsEditorKey.data_section);
  const initialHasRowData = initialSharedRoot.has(YjsEditorKey.database_row);

  Log.debug('[Database] getOrCreateRowDocEntry opened (before sync)', {
    rowKey,
    openDurationMs: Date.now() - startedAt,
    providerSynced: provider.synced,
    hasRowDataBeforeSync: initialHasRowData,
  });

  const whenSynced = provider.synced
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        provider.on('synced', () => {
          if (rowSyncLogCount < ROW_SYNC_LOG_LIMIT) {
            rowSyncLogCount += 1;
            const rowSharedRoot = doc.getMap(YjsEditorKey.data_section);
            const hasRowData = rowSharedRoot.has(YjsEditorKey.database_row);

            Log.debug('[Database] row doc IndexedDB synced', {
              rowKey,
              durationMs: Date.now() - startedAt,
              hasRowDataAfterSync: hasRowData,
              hadRowDataBeforeSync: initialHasRowData,
            });
          }

          resolve();
        });
      });
  const entry = { doc, whenSynced };

  rowDocs.set(rowKey, entry);
  return entry;
}

export async function createRow(rowKey: string) {
  const entry = await getOrCreateRowDocEntry(rowKey);

  await entry.whenSynced;

  return entry.doc;
}

export async function createRowFast(
  rowKey: string,
  seed?: { bytes: Uint8Array; encoderVersion: number }
) {
  Log.debug('[Database] createRowDocFast start', {
    rowKey,
    hasSeed: Boolean(seed),
    seedBytes: seed?.bytes.length ?? 0,
  });

  const entry = await getOrCreateRowDocEntry(rowKey);

  // Check state before applying seed
  const rowSharedRootBefore = entry.doc.getMap(YjsEditorKey.data_section);
  const hasRowDataBefore = rowSharedRootBefore.has(YjsEditorKey.database_row);

  if (seed) {
    Log.debug('[Database] createRowDocFast applying seed', {
      rowKey,
      seedBytes: seed.bytes.length,
      encoderVersion: seed.encoderVersion,
      hasRowDataBeforeSeed: hasRowDataBefore,
    });

    applyYDoc(entry.doc, seed.bytes, seed.encoderVersion);
  }

  const rowSharedRoot = entry.doc.getMap(YjsEditorKey.data_section);
  const hasRowData = rowSharedRoot.has(YjsEditorKey.database_row);

  if (rowFastLogCount < ROW_FAST_LOG_LIMIT) {
    rowFastLogCount += 1;

    Log.debug('[Database] createRowDocFast completed', {
      rowKey,
      hasSeed: Boolean(seed),
      hasRowDataBefore,
      hasRowDataAfter: hasRowData,
      rowDataAppeared: !hasRowDataBefore && hasRowData,
    });
  }

  return entry.doc;
}

export function getCachedRowDoc(rowKey: string): YDoc | undefined {
  return rowDocs.get(rowKey)?.doc;
}

export function deleteRow(rowKey: string) {
  rowDocs.delete(rowKey);
}

// ============================================================================
// Row Sub-Document Cache (for document content inside database rows)
// ============================================================================

type RowSubDocEntry = {
  doc: YDoc;
  whenSynced: Promise<void>;
};

const rowSubDocs = new Map<string, RowSubDocEntry>();

/**
 * Helper to get text content summary from a Y.Doc for debugging.
 */
function getDocTextSummary(doc: YDoc): { hasText: boolean; textCount: number; sampleText: string } {
  try {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const document = sharedRoot?.get(YjsEditorKey.document) as Y.Map<unknown> | undefined;
    const meta = document?.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
    const textMap = meta?.get(YjsEditorKey.text_map) as Y.Map<Y.Text> | undefined;

    if (!textMap) {
      return { hasText: false, textCount: 0, sampleText: '' };
    }

    let textCount = 0;
    let sampleText = '';

    for (const text of textMap.values()) {
      const str = text?.toString() || '';

      if (str.length > 0) {
        textCount++;
        if (!sampleText) {
          sampleText = str.slice(0, 50);
        }
      }
    }

    return { hasText: textCount > 0, textCount, sampleText };
  } catch {
    return { hasText: false, textCount: 0, sampleText: '' };
  }
}

/**
 * Get or create a cached row sub-document.
 * This ensures the same Y.Doc instance is reused when reopening a card,
 * preserving the sync state and preventing content loss.
 */
export async function getOrCreateRowSubDoc(documentId: string): Promise<YDoc> {
  const existing = rowSubDocs.get(documentId);

  if (existing) {
    const textSummary = getDocTextSummary(existing.doc);

    Log.debug('[RowSubDoc] returning cached doc', {
      documentId,
      hasDoc: Boolean(existing.doc),
      ...textSummary,
    });

    await existing.whenSynced;
    return existing.doc;
  }

  Log.debug('[RowSubDoc] creating new doc entry', { documentId });

  const startedAt = Date.now();
  const { doc, provider } = await openCollabDBWithProvider(documentId, { awaitSync: false });

  // Check initial state
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const hasDocument = sharedRoot.has(YjsEditorKey.document);
  const textBeforeSync = getDocTextSummary(doc);

  Log.debug('[RowSubDoc] opened (before IndexedDB sync)', {
    documentId,
    openDurationMs: Date.now() - startedAt,
    providerSynced: provider.synced,
    hasDocumentBeforeSync: hasDocument,
    ...textBeforeSync,
  });

  const whenSynced = provider.synced
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        provider.on('synced', () => {
          const syncedSharedRoot = doc.getMap(YjsEditorKey.data_section);
          const hasDocAfterSync = syncedSharedRoot.has(YjsEditorKey.document);
          const textAfterSync = getDocTextSummary(doc);

          Log.debug('[RowSubDoc] IndexedDB synced', {
            documentId,
            durationMs: Date.now() - startedAt,
            hasDocumentAfterSync: hasDocAfterSync,
            hadDocumentBeforeSync: hasDocument,
            textBefore: textBeforeSync,
            textAfter: textAfterSync,
          });

          resolve();
        });
      });

  const entry = { doc, whenSynced };

  rowSubDocs.set(documentId, entry);

  await whenSynced;

  // Log final state after sync
  const finalTextSummary = getDocTextSummary(doc);

  Log.debug('[RowSubDoc] ready', {
    documentId,
    totalDurationMs: Date.now() - startedAt,
    ...finalTextSummary,
  });

  return doc;
}

/**
 * Get a cached row sub-document if it exists, without creating a new one.
 */
export function getCachedRowSubDoc(documentId: string): YDoc | undefined {
  return rowSubDocs.get(documentId)?.doc;
}

/**
 * Remove a row sub-document from the cache.
 * Call this when the document is no longer needed (e.g., row deleted).
 */
export function deleteRowSubDoc(documentId: string) {
  rowSubDocs.delete(documentId);
}
