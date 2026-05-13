import BaseDexie from 'dexie';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { databasePrefix } from '@/application/constants';
import {
  collabStorageSchema,
  type CollabSnapshotRecord,
  type CollabStorageTable,
  type CollabUpdateRecord,
} from '@/application/db/tables/collab_storage';
import { rowSchema, rowTable } from '@/application/db/tables/rows';
import { syncOutboxSchema, SyncOutboxTable } from '@/application/db/tables/sync_outbox';
import { userSchema, UserTable } from '@/application/db/tables/users';
import { versionSchema, VersionsTable } from '@/application/db/tables/versions';
import { viewMetasSchema, ViewMetasTable } from '@/application/db/tables/view_metas';
import {
  workspaceMemberProfileSchema,
  WorkspaceMemberProfileTable,
} from '@/application/db/tables/workspace_member_profiles';
import { YDoc } from '@/application/types';
import { Log } from '@/utils/log';

type DexieTables = ViewMetasTable &
  UserTable &
  rowTable &
  WorkspaceMemberProfileTable &
  VersionsTable &
  SyncOutboxTable &
  CollabStorageTable;

export type Dexie<T = DexieTables> = BaseDexie & T;

export const db = new BaseDexie(`${databasePrefix}_cache`) as Dexie;
const _schema = Object.assign(
  {},
  { ...viewMetasSchema, ...userSchema, ...rowSchema, ...versionSchema, ...syncOutboxSchema, ...collabStorageSchema }
);

// Version 1: Initial schema with view_metas, users, and rows
db.version(1).stores({
  ...viewMetasSchema,
  ...userSchema,
  ...rowSchema,
});

// Version 2: Add workspace_member_profiles table
db.version(2)
  .stores({
    ...viewMetasSchema,
    ...userSchema,
    ...rowSchema,
    ...workspaceMemberProfileSchema,
  })
  .upgrade(async (transaction) => {
    try {
      // Touch the new store so Dexie creates it for users upgrading from version 1.
      await transaction.table('workspace_member_profiles').count();
    } catch (error) {
      console.error('Failed to initialize workspace_member_profiles store during upgrade:', error);
      throw error;
    }
  });

// Version 3: Add collab_versions table
db.version(3)
  .stores({
    ...viewMetasSchema,
    ...userSchema,
    ...rowSchema,
    ...workspaceMemberProfileSchema,
    ...versionSchema,
  })
  .upgrade(async (transaction) => {
    try {
      // Touch the new store so Dexie creates it for users upgrading from version 2.
      await transaction.table('collab_versions').count();
    } catch (error) {
      console.error('Failed to initialize collab_versions store during upgrade:', error);
      throw error;
    }
  });

// Version 4: Initial sync_outbox table (superseded by v5 — kept for upgrade path)
db.version(4).stores({
  ...viewMetasSchema,
  ...userSchema,
  ...rowSchema,
  ...workspaceMemberProfileSchema,
  ...versionSchema,
  sync_outbox: '++id, objectId, [objectId+id]',
});

// Version 5: Add workspaceId scoping to sync_outbox so records enqueued in
// one workspace cannot be drained against another workspace's WebSocket.
// Records from v4 (without workspaceId) are discarded on upgrade — they would
// otherwise be orphaned since we cannot infer their originating workspace.
db.version(5)
  .stores({
    ...viewMetasSchema,
    ...userSchema,
    ...rowSchema,
    ...workspaceMemberProfileSchema,
    ...versionSchema,
    sync_outbox: '++id, workspaceId, objectId, [workspaceId+objectId], [workspaceId+objectId+id]',
  })
  .upgrade(async (transaction) => {
    try {
      await transaction.table('sync_outbox').clear();
    } catch (error) {
      console.error('Failed to clear sync_outbox on v5 upgrade:', error);
      throw error;
    }
  });

// Version 6: Add userId scoping to sync_outbox. Without userId, a tab crash
// with pending rows for user A could drain those rows over user B's
// WebSocket after re-authentication on the same browser. Drop any v5 records
// on upgrade — their originating userId is unknowable.
db.version(6)
  .stores({
    ...viewMetasSchema,
    ...userSchema,
    ...rowSchema,
    ...workspaceMemberProfileSchema,
    ...versionSchema,
    ...syncOutboxSchema,
  })
  .upgrade(async (transaction) => {
    try {
      await transaction.table('sync_outbox').clear();
    } catch (error) {
      console.error('Failed to clear sync_outbox on v6 upgrade:', error);
      throw error;
    }
  });

// Version 7: Shared collab storage for high-cardinality objects such as
// database rows. This avoids creating one browser IndexedDB database per row.
db.version(7).stores({
  ...viewMetasSchema,
  ...userSchema,
  ...rowSchema,
  ...workspaceMemberProfileSchema,
  ...versionSchema,
  ...syncOutboxSchema,
  ...collabStorageSchema,
});

const openedSet = new Set<string>();
const ensuredStores = new Map<string, Promise<void>>();

const yjsStoreDefinitions = [
  { name: 'updates', options: { autoIncrement: true } },
  { name: 'custom' },
];

type IndexedDBFactoryWithDatabases = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string | null }>>;
};

function createYjsStores(db: IDBDatabase) {
  yjsStoreDefinitions.forEach((store) => {
    if (!db.objectStoreNames.contains(store.name)) {
      db.createObjectStore(store.name, store.options);
    }
  });
}

function openIdbDatabase(name: string, version?: number) {
  return new Promise<IDBDatabase | null>((resolve) => {
    const request = typeof version === 'number' ? indexedDB.open(name, version) : indexedDB.open(name);

    request.onupgradeneeded = () => {
      createYjsStores(request.result);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function ensureYjsStores(name: string) {
  if (typeof indexedDB === 'undefined') return;

  const existing = ensuredStores.get(name);

  if (existing) {
    await existing;
    return;
  }

  const ensurePromise = (async () => {
    const db = await openIdbDatabase(name);

    if (!db) return;

    const missingStores = yjsStoreDefinitions.filter((store) => !db.objectStoreNames.contains(store.name));

    if (missingStores.length === 0) {
      db.close();
      return;
    }

    const nextVersion = db.version + 1;

    db.close();
    const upgraded = await openIdbDatabase(name, nextVersion);

    upgraded?.close();
  })().catch((error) => {
    Log.warn('[Database] failed to ensure yjs stores', { name, error });
  });

  ensuredStores.set(name, ensurePromise);
  await ensurePromise;
  ensuredStores.delete(name);
}

export async function listCollabIndexedDBNames() {
  if (typeof indexedDB === 'undefined') return new Set<string>();

  const indexedDBWithDatabases = indexedDB as IndexedDBFactoryWithDatabases;

  if (typeof indexedDBWithDatabases.databases !== 'function') {
    return new Set<string>();
  }

  try {
    const databases = await indexedDBWithDatabases.databases();

    return new Set(databases.flatMap((database) => (database.name ? [database.name] : [])));
  } catch (error) {
    Log.warn('[DB] failed to list IndexedDB databases', { error });
    return new Set<string>();
  }
}

export async function collabIndexedDBExists(name: string) {
  if (!name) return false;

  return (await listCollabIndexedDBNames()).has(name);
}

export interface OpenCollabOptions {
  /**
   * Define what version collab should have when loaded from IndexedDB.
   * If the persisted version is different, it will be removed as outdated.
   */
  expectedVersion?: string;
  /**
   * Force clearing persisted Yjs updates before reopening.
   * Useful when the local cache must be discarded even without an expectedVersion,
   * for example when local/remote version-known state mismatches.
   */
  forceReset?: boolean;
  /**
   * Define current user UID. If provided that value will be written into
   * the document data itself and used in the future for associating Yjs document
   * changes with specific users.
   */
  currentUser?: string;
}

/**
 * Unified provider cache for Y.Doc + IndexeddbPersistence instances.
 * All paths that create Y.Docs funnel through openCollabDBWithProvider,
 * which uses this cache to ensure the same Y.Doc is shared across consumers.
 */
interface CachedProviderEntry {
  doc: YDoc;
  provider: CollabPersistenceProvider;
  whenSynced: Promise<void>;
  disposed: boolean;
  settleWhenDisposed: () => void;
}

const providerCache = new Map<string, CachedProviderEntry>();
const pendingOpens = new Map<string, Promise<CachedProviderEntry>>();
const rowProviderCache = new Map<string, CachedProviderEntry>();
const pendingRowOpens = new Map<string, Promise<CachedProviderEntry>>();
const DATABASE_BLOB_RID_PREFIX = 'af_database_blob_rid:';
const SHARED_COLLAB_COMPACT_UPDATE_THRESHOLD = 200;
const SHARED_COLLAB_COMPACT_MAX_RETRIES = 3;

type CollabPersistenceProvider = IndexeddbPersistence | SharedIndexeddbPersistence;
type SharedCollabOpenOptions = { awaitSync?: boolean; expectedVersion?: string; forceReset?: boolean; skipCache?: boolean };

class SharedCollabCompactionRetry extends Error {
  constructor() {
    super('Shared collab snapshot changed during compaction');
    this.name = 'SharedCollabCompactionRetry';
  }
}

function shouldRetrySharedCollabCompaction(error: unknown) {
  return error instanceof SharedCollabCompactionRetry || (error as Error)?.name === 'SharedCollabCompactionRetry';
}

function getSharedCollabSnapshotToken(snapshot: CollabSnapshotRecord | undefined) {
  return `${snapshot?.compactionId ?? ''}:${snapshot?.updatedAt ?? 0}:${snapshot?.byteLength ?? 0}:${
    snapshot?.stateVector.byteLength ?? 0
  }`;
}

function createSharedCollabSnapshotId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readSharedCollabRecordsForSync(name: string): Promise<{
  snapshot: CollabSnapshotRecord | undefined;
  updates: CollabUpdateRecord[];
}> {
  return db.transaction('r', db.collab_snapshots, db.collab_updates, async () => {
    const snapshot = await db.collab_snapshots.get(name);
    const updates = await db.collab_updates
      .where('[objectId+id]')
      .between([name, BaseDexie.minKey], [name, BaseDexie.maxKey])
      .toArray();

    return { snapshot, updates };
  });
}

class CollabProviderDisposedError extends Error {
  constructor(name: string) {
    super(`Collab provider was disposed while opening: ${name}`);
    this.name = 'CollabProviderDisposedError';
  }
}

function createCachedProviderEntry(
  name: string,
  startedAt: number,
  doc: YDoc,
  provider: CollabPersistenceProvider
): CachedProviderEntry {
  let settled = false;
  let resolveWhenSynced!: () => void;

  const entry: CachedProviderEntry = {
    doc,
    provider,
    disposed: false,
    whenSynced: new Promise<void>((resolve) => {
      resolveWhenSynced = resolve;
    }),
    settleWhenDisposed: () => {
      entry.disposed = true;

      if (settled) return;

      settled = true;
      (provider as { off?: (event: string, listener: (...args: unknown[]) => void) => void }).off?.('synced', handleSync);
      resolveWhenSynced();
    },
  };

  const handleSync = () => {
    if (settled) return;

    settled = true;
    (provider as { off?: (event: string, listener: (...args: unknown[]) => void) => void }).off?.('synced', handleSync);

    Log.debug('[DB] collab provider synced', {
      name,
      syncDurationMs: Date.now() - startedAt,
      wasOpened: openedSet.has(name),
    });

    if (!openedSet.has(name)) {
      openedSet.add(name);
    }

    resolveWhenSynced();
  };

  provider.on('synced', handleSync);

  if ((provider as { synced?: boolean }).synced) {
    handleSync();
  }

  return entry;
}

async function waitForProviderEntry(name: string, entry: CachedProviderEntry) {
  await entry.whenSynced;

  if (entry.disposed) {
    throw new CollabProviderDisposedError(name);
  }
}

class SharedIndexeddbPersistence {
  doc: YDoc;
  name: string;
  synced = false;
  whenSynced: Promise<SharedIndexeddbPersistence>;

  private _destroyed = false;
  private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private _pendingWrite: Promise<void> = Promise.resolve();
  private _updatesSinceCompact = 0;

  constructor(name: string, doc: YDoc) {
    this.name = name;
    this.doc = doc;
    this.whenSynced = this.sync();
    this.destroy = this.destroy.bind(this);

    doc.on('update', this._storeUpdate);
    doc.on('destroy', this.destroy);
  }

  on(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this._listeners.get(event) ?? new Set<(...args: unknown[]) => void>();

    listeners.add(listener);
    this._listeners.set(event, listeners);
  }

  off(event: string, listener: (...args: unknown[]) => void) {
    this._listeners.get(event)?.delete(listener);
  }

  emit(event: string, args: unknown[] = []) {
    this._listeners.get(event)?.forEach((listener) => {
      listener(...args);
    });
  }

  private async sync() {
    try {
      const { snapshot, updates } = await readSharedCollabRecordsForSync(this.name);

      if (this._destroyed) return this;

      if (snapshot?.update) {
        Y.applyUpdate(this.doc, snapshot.update, this);
      }

      if (updates.length > 0) {
        Y.transact(
          this.doc,
          () => {
            updates.forEach((record) => {
              Y.applyUpdate(this.doc, record.update, this);
            });
          },
          this
        );
      }

      this._updatesSinceCompact = updates.length;
    } catch (error) {
      Log.warn('[DB] failed to sync shared collab IndexedDB data', { name: this.name, error });
    } finally {
      if (!this._destroyed) {
        this.synced = true;
        this.emit('synced', [this]);

        if (this._updatesSinceCompact >= SHARED_COLLAB_COMPACT_UPDATE_THRESHOLD) {
          this.queueCompact();
        }
      }
    }

    return this;
  }

  private _storeUpdate = (update: Uint8Array, origin: unknown) => {
    if (this._destroyed || origin === this) {
      return;
    }

    const persistedUpdate = new Uint8Array(update);

    this._pendingWrite = this._pendingWrite
      .then(async () => {
        await db.collab_updates.add({
          objectId: this.name,
          update: persistedUpdate,
          createdAt: Date.now(),
          byteLength: persistedUpdate.byteLength,
        });
        this._updatesSinceCompact += 1;

        if (this._updatesSinceCompact >= SHARED_COLLAB_COMPACT_UPDATE_THRESHOLD) {
          await this.compact();
        }
      })
      .catch((error) => {
        Log.warn('[DB] failed to persist shared collab update', { name: this.name, error });
      });
  };

  private queueCompact() {
    this._pendingWrite = this._pendingWrite.then(() => this.compact()).catch((error) => {
      Log.warn('[DB] failed to compact shared collab updates', { name: this.name, error });
    });
  }

  private async compact() {
    if (this._destroyed) return;

    for (let attempt = 0; attempt < SHARED_COLLAB_COMPACT_MAX_RETRIES; attempt += 1) {
      const baseSnapshot = await db.collab_snapshots.get(this.name);
      const baseSnapshotToken = getSharedCollabSnapshotToken(baseSnapshot);
      const compactedRecords = await db.collab_updates
        .where('[objectId+id]')
        .between([this.name, BaseDexie.minKey], [this.name, BaseDexie.maxKey])
        .toArray();

      if (this._destroyed) return;

      if (baseSnapshot?.update) {
        Y.applyUpdate(this.doc, baseSnapshot.update, this);
      }

      if (compactedRecords.length > 0) {
        Y.transact(
          this.doc,
          () => {
            compactedRecords.forEach((record) => {
              Y.applyUpdate(this.doc, record.update, this);
            });
          },
          this
        );
      }

      const update = Y.encodeStateAsUpdate(this.doc);
      const stateVector = Y.encodeStateVector(this.doc);
      const compactedIds = compactedRecords.flatMap((record) => (typeof record.id === 'number' ? [record.id] : []));
      const compactionId = createSharedCollabSnapshotId();
      let remainingUpdateCount = 0;

      try {
        await db.transaction('rw', db.collab_snapshots, db.collab_updates, async () => {
          const currentSnapshot = await db.collab_snapshots.get(this.name);

          if (getSharedCollabSnapshotToken(currentSnapshot) !== baseSnapshotToken) {
            throw new SharedCollabCompactionRetry();
          }

          await db.collab_snapshots.put({
            objectId: this.name,
            update,
            stateVector,
            version: this.doc.version ?? null,
            compactionId,
            updatedAt: Date.now(),
            byteLength: update.byteLength,
          });

          if (compactedIds.length > 0) {
            await db.collab_updates.bulkDelete(compactedIds);
          }

          remainingUpdateCount = await db.collab_updates.where('objectId').equals(this.name).count();
        });

        this._updatesSinceCompact = remainingUpdateCount;
        return;
      } catch (error) {
        if (shouldRetrySharedCollabCompaction(error)) {
          continue;
        }

        throw error;
      }
    }

    this._updatesSinceCompact = await db.collab_updates.where('objectId').equals(this.name).count();
  }

  async destroy() {
    if (this._destroyed) {
      await this._pendingWrite.catch(() => undefined);
      return;
    }

    this.doc.off('update', this._storeUpdate);
    this.doc.off('destroy', this.destroy);
    this._destroyed = true;
    this._listeners.clear();
    await this._pendingWrite.catch(() => undefined);
  }

  async clearData() {
    await this.destroy();
    await deleteSharedCollabData(this.name);
  }

  async get(key: IDBValidKey) {
    return db.collab_custom.get([this.name, String(key)]).then((record) => record?.value);
  }

  async set(key: IDBValidKey, value: unknown) {
    await db.collab_custom.put({
      objectId: this.name,
      key: String(key),
      value,
    });

    return value;
  }

  async del(key: IDBValidKey) {
    await db.collab_custom.delete([this.name, String(key)]);
  }
}

async function destroyProviderEntry(entry: CachedProviderEntry, options: { destroyDoc?: boolean } = {}) {
  entry.settleWhenDisposed();
  await entry.provider.destroy();

  if (options.destroyDoc !== false) {
    entry.doc.destroy();
  }
}

async function disposeCachedProvider(name: string, options: { destroyDoc?: boolean } = {}) {
  let disposed = false;
  const pending = pendingOpens.get(name);

  if (pending) {
    pendingOpens.delete(name);

    try {
      const entry = await pending;

      if (providerCache.get(name) === entry) {
        providerCache.delete(name);
      }

      await destroyProviderEntry(entry, options);
      disposed = true;
    } catch (error) {
      Log.warn('[DB] failed to dispose pending collab provider', { name, error });
    }
  }

  const cached = providerCache.get(name);

  providerCache.delete(name);
  pendingOpens.delete(name);

  if (cached) {
    await destroyProviderEntry(cached, options);
    disposed = true;
  }

  return disposed;
}

async function disposeRowProvider(name: string, options: { destroyDoc?: boolean } = {}) {
  let disposed = false;
  const pending = pendingRowOpens.get(name);

  if (pending) {
    pendingRowOpens.delete(name);

    try {
      const entry = await pending;

      if (rowProviderCache.get(name) === entry) {
        rowProviderCache.delete(name);
      }

      await destroyProviderEntry(entry, options);
      disposed = true;
    } catch (error) {
      Log.warn('[DB] failed to dispose pending shared row provider', { name, error });
    }
  }

  const cached = rowProviderCache.get(name);

  rowProviderCache.delete(name);
  pendingRowOpens.delete(name);

  if (cached) {
    await destroyProviderEntry(cached, options);
    disposed = true;
  }

  return disposed;
}

async function deleteIndexedDBDatabase(name: string) {
  if (typeof indexedDB === 'undefined') return true;

  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(name);

    request.onsuccess = () => resolve(true);
    request.onerror = () => {
      Log.warn('[DB] failed to delete collab IndexedDB database', { name, error: request.error });
      resolve(false);
    };

    request.onblocked = () => {
      Log.warn('[DB] delete collab IndexedDB database blocked', { name });
      resolve(false);
    };
  });
}

async function deleteSharedCollabData(name: string) {
  if (typeof indexedDB === 'undefined') return true;

  try {
    await db.transaction('rw', db.collab_snapshots, db.collab_updates, db.collab_custom, async () => {
      await db.collab_snapshots.delete(name);
      await db.collab_updates.where('objectId').equals(name).delete();
      await db.collab_custom.where('objectId').equals(name).delete();
    });

    return true;
  } catch (error) {
    Log.warn('[DB] failed to delete shared collab data', { name, error });
    return false;
  }
}

/**
 * Open the collaboration database, and return a function to close it
 */
export async function openCollabDB(name: string, options: OpenCollabOptions = {}): Promise<YDoc> {
  const { doc } = await openCollabDBWithProvider(name, {
    awaitSync: true,
    expectedVersion: options.expectedVersion,
    forceReset: options.forceReset,
  });

  return doc;
}

export async function openCollabDBWithProvider(
  name: string,
  options?: { awaitSync?: boolean; expectedVersion?: string; forceReset?: boolean; skipCache?: boolean }
): Promise<{ doc: YDoc; provider: IndexeddbPersistence }> {
  // Ephemeral callers bypass cache entirely
  if (options?.skipCache) {
    const entry = await _openCollabDBWithProviderInternal(name, options);

    if (options.awaitSync !== false) {
      await waitForProviderEntry(name, entry);
    }

    if (entry.disposed) {
      throw new CollabProviderDisposedError(name);
    }

    return { doc: entry.doc, provider: entry.provider as IndexeddbPersistence };
  }

  const needsReset = options?.forceReset || options?.expectedVersion;

  if (needsReset) {
    // Close stale connections before deleting/reopening this object's IndexedDB.
    await disposeCachedProvider(name);
  } else {
    // Check providerCache for a resolved entry
    const cached = providerCache.get(name);

    if (cached) {
      if (options?.awaitSync !== false) {
        await waitForProviderEntry(name, cached);
      }

      if (cached.disposed) {
        providerCache.delete(name);
        throw new CollabProviderDisposedError(name);
      }

      return { doc: cached.doc, provider: cached.provider as IndexeddbPersistence };
    }

    // Join an in-flight open for the same name
    const pending = pendingOpens.get(name);

    if (pending) {
      const entry = await pending;

      if (options?.awaitSync !== false) {
        await waitForProviderEntry(name, entry);
      }

      if (entry.disposed) {
        throw new CollabProviderDisposedError(name);
      }

      return { doc: entry.doc, provider: entry.provider as IndexeddbPersistence };
    }
  }

  // Create new entry and cache it
  const promise = _openCollabDBWithProviderInternal(name, options);

  pendingOpens.set(name, promise);

  try {
    const entry = await promise;

    if (pendingOpens.get(name) === promise) {
      providerCache.set(name, entry);

      // Auto-evict if the doc is destroyed via an external path
      // (e.g., handleAccessChanged, version revert) so subsequent
      // callers don't receive a stale, destroyed Y.Doc.
      entry.doc.on('destroy', () => {
        if (providerCache.get(name) === entry) {
          providerCache.delete(name);
        }
      });
    }

    if (options?.awaitSync !== false) {
      await waitForProviderEntry(name, entry);
    }

    if (entry.disposed) {
      throw new CollabProviderDisposedError(name);
    }

    return { doc: entry.doc, provider: entry.provider as IndexeddbPersistence };
  } finally {
    if (pendingOpens.get(name) === promise) {
      pendingOpens.delete(name);
    }
  }
}

export async function openRowCollabDBWithProvider(
  name: string,
  options?: SharedCollabOpenOptions
): Promise<{ doc: YDoc; provider: SharedIndexeddbPersistence }> {
  if (options?.skipCache) {
    const entry = await _openRowCollabDBWithProviderInternal(name, options);

    if (options.awaitSync !== false) {
      await waitForProviderEntry(name, entry);
    }

    if (entry.disposed) {
      throw new CollabProviderDisposedError(name);
    }

    return { doc: entry.doc, provider: entry.provider as SharedIndexeddbPersistence };
  }

  const needsReset = options?.forceReset || options?.expectedVersion;

  if (needsReset) {
    await disposeRowProvider(name);
  } else {
    const cached = rowProviderCache.get(name);

    if (cached) {
      if (options?.awaitSync !== false) {
        await waitForProviderEntry(name, cached);
      }

      if (cached.disposed) {
        rowProviderCache.delete(name);
        throw new CollabProviderDisposedError(name);
      }

      return { doc: cached.doc, provider: cached.provider as SharedIndexeddbPersistence };
    }

    const pending = pendingRowOpens.get(name);

    if (pending) {
      const entry = await pending;

      if (options?.awaitSync !== false) {
        await waitForProviderEntry(name, entry);
      }

      if (entry.disposed) {
        throw new CollabProviderDisposedError(name);
      }

      return { doc: entry.doc, provider: entry.provider as SharedIndexeddbPersistence };
    }
  }

  const promise = _openRowCollabDBWithProviderInternal(name, options);

  pendingRowOpens.set(name, promise);

  try {
    const entry = await promise;

    if (pendingRowOpens.get(name) === promise) {
      rowProviderCache.set(name, entry);
      entry.doc.on('destroy', () => {
        if (rowProviderCache.get(name) === entry) {
          rowProviderCache.delete(name);
        }
      });
    }

    if (options?.awaitSync !== false) {
      await waitForProviderEntry(name, entry);
    }

    if (entry.disposed) {
      throw new CollabProviderDisposedError(name);
    }

    return { doc: entry.doc, provider: entry.provider as SharedIndexeddbPersistence };
  } finally {
    if (pendingRowOpens.get(name) === promise) {
      pendingRowOpens.delete(name);
    }
  }
}

async function _openRowCollabDBWithProviderInternal(
  name: string,
  options?: { expectedVersion?: string; forceReset?: boolean }
): Promise<CachedProviderEntry> {
  const startedAt = Date.now();
  let doc = new Y.Doc({
    guid: name,
  }) as YDoc;
  let provider = new SharedIndexeddbPersistence(name, doc);
  let version = await provider.get(name + '/version') as string | undefined;

  if (options?.forceReset || (options?.expectedVersion && version !== options.expectedVersion)) {
    await provider.destroy();
    doc.destroy();

    const deleted = await deleteSharedCollabData(name);

    if (!deleted) {
      throw new Error(`Failed to delete shared IndexedDB data for collab ${name}`);
    }

    doc = new Y.Doc({
      guid: name,
    }) as YDoc;
    provider = new SharedIndexeddbPersistence(name, doc);

    if (options?.expectedVersion) {
      await provider.set(name + '/version', options.expectedVersion);
      version = options.expectedVersion;
    } else {
      version = undefined;
    }
  }

  doc.version = version;

  return createCachedProviderEntry(name, startedAt, doc, provider);
}

async function _openCollabDBWithProviderInternal(
  name: string,
  options?: { expectedVersion?: string; forceReset?: boolean }
): Promise<CachedProviderEntry> {
  const startedAt = Date.now();

  Log.debug('[DB] openCollabDBWithProvider start', {
    name,
    alreadyOpened: openedSet.has(name),
  });

  let doc = new Y.Doc({
    guid: name,
  }) as YDoc;

  await ensureYjsStores(name);

  let provider = new IndexeddbPersistence(name, doc);
  let version = await provider.get(name + '/version');

  if (options?.forceReset || (options?.expectedVersion && version !== options.expectedVersion)) {
    await provider.destroy();
    doc.destroy();

    const deleted = await deleteIndexedDBDatabase(name);

    if (!deleted) {
      throw new Error(`Failed to delete IndexedDB database for collab ${name}`);
    }

    await ensureYjsStores(name);
    doc = new Y.Doc({
      guid: name,
    }) as YDoc;
    provider = new IndexeddbPersistence(name, doc);

    if (options?.expectedVersion) {
      await provider.set(name + '/version', options.expectedVersion);
      version = options.expectedVersion;
    } else {
      version = undefined;
    }
  }

  doc.version = version;

  return createCachedProviderEntry(name, startedAt, doc, provider);
}

export async function closeCollabDB(name: string) {
  if (openedSet.has(name)) {
    openedSet.delete(name);
  }

  const disposed = await disposeCachedProvider(name);
  const rowDisposed = await disposeRowProvider(name);

  if (disposed || rowDisposed) {
    return;
  }

  // No cached entry — create a temp provider so y-indexeddb has no live connection.
  const doc = new Y.Doc({
    guid: name,
  });

  const provider = new IndexeddbPersistence(name, doc);

  await provider.destroy();
  doc.destroy();
}

/**
 * Destroy any in-memory provider/doc for the object and delete its y-indexeddb
 * database. Call this only for authoritative invalidations: access revoked,
 * object deleted, version reset/force reset, or row deleted.
 */
export async function deleteCollabDB(name: string, options: { destroyDoc?: boolean } = {}) {
  if (!name) return false;

  if (openedSet.has(name)) {
    openedSet.delete(name);
  }

  ensuredStores.delete(name);
  await disposeCachedProvider(name, options);
  await disposeRowProvider(name, options);

  const [indexedDbDeleted, sharedDataDeleted] = await Promise.all([
    deleteIndexedDBDatabase(name),
    deleteSharedCollabData(name),
  ]);

  if (indexedDbDeleted && sharedDataDeleted) {
    Log.debug('[DB] deleted collab IndexedDB database', { name });
  }

  return indexedDbDeleted && sharedDataDeleted;
}

/**
 * Synchronously evict an entry from the provider cache.
 * Used by deleteRow / deleteRowSubDoc after they destroy the Y.Doc themselves.
 */
export function evictProviderCache(name: string) {
  providerCache.delete(name);
  pendingOpens.delete(name);
  rowProviderCache.delete(name);
  pendingRowOpens.delete(name);
}

/**
 * Return the cached Y.Doc for a given name, if one exists in the provider cache.
 */
export function getCachedProviderDoc(name: string): YDoc | undefined {
  return providerCache.get(name)?.doc ?? rowProviderCache.get(name)?.doc;
}

function removeLocalStorageKeysByPrefix(prefix: string) {
  if (typeof localStorage === 'undefined') return;

  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);

    if (key?.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

function clearBlobRidCheckpointsForDeletedDatabases(results: Array<{ name: string; deleted: boolean }>) {
  if (typeof localStorage === 'undefined') return;

  const sharedCacheDeleted = results.some(({ name, deleted }) => deleted && name === db.name);
  const allDatabasesDeleted = results.every((result) => result.deleted);

  if (sharedCacheDeleted || allDatabasesDeleted) {
    removeLocalStorageKeysByPrefix(DATABASE_BLOB_RID_PREFIX);
    return;
  }

  const deletedDatabaseIds = new Set<string>();
  const blockedDatabaseIds = new Set<string>();

  results.forEach(({ name, deleted }) => {
    if (!name) return;
    const markerIndex = name.indexOf('_rows_');

    if (markerIndex <= 0) return;
    const databaseId = name.slice(0, markerIndex);

    if (!databaseId) return;
    if (deleted) {
      deletedDatabaseIds.add(databaseId);
    } else {
      blockedDatabaseIds.add(databaseId);
    }
  });

  deletedDatabaseIds.forEach((databaseId) => {
    if (blockedDatabaseIds.has(databaseId)) return;
    localStorage.removeItem(`${DATABASE_BLOB_RID_PREFIX}${databaseId}`);
  });
}

export async function clearData() {
  const databases = await indexedDB.databases();

  const deleteDatabase = async (dbInfo: IDBDatabaseInfo): Promise<{ name: string; deleted: boolean }> => {
    const dbName = dbInfo.name;

    if (!dbName) return { name: '', deleted: false };

    return new Promise((resolve) => {
      const request = indexedDB.open(dbName);

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        db.close();

        const deleteRequest = indexedDB.deleteDatabase(dbName);

        deleteRequest.onsuccess = () => {
          Log.debug(`Database ${dbName} deleted successfully`);
          resolve({ name: dbName, deleted: true });
        };

        deleteRequest.onerror = (event) => {
          console.error(`Error deleting database ${dbName}`, event);
          resolve({ name: dbName, deleted: false });
        };

        deleteRequest.onblocked = () => {
          console.warn(`Delete operation blocked for database ${dbName}`);
          resolve({ name: dbName, deleted: false });
        };
      };

      request.onerror = (event) => {
        console.error(`Error opening database ${dbName}`, event);
        resolve({ name: dbName, deleted: false });
      };
    });
  };

  try {
    const results = await Promise.all(databases.map(deleteDatabase));

    try {
      clearBlobRidCheckpointsForDeletedDatabases(results);
    } catch {
      // Ignore localStorage failures (private mode/quota).
    }

    return results.every((result) => result.deleted);
  } catch (error) {
    console.error('Error during database deletion process:', error);
    return false;
  }
}

export const __dbTestUtils = {
  createCachedProviderEntry,
  clearBlobRidCheckpointsForDeletedDatabases,
  destroyProviderEntry,
  readSharedCollabRecordsForSync,
  waitForProviderEntry,
};
