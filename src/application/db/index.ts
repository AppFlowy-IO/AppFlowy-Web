import BaseDexie, { type Table } from 'dexie';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { databasePrefix } from '@/application/constants';
import { metaIdFromRowId } from '@/application/database-yjs/const';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { appViewCacheSchema, type AppViewCacheTable } from '@/application/db/tables/app_view_cache';
import { atomicCreationSchema, type AtomicCreationTable } from '@/application/db/tables/atomic_creation';
import {
  collabStorageSchema,
  type CollabSnapshotRecord,
  type CollabStorageTable,
  type CollabUpdateRecord,
} from '@/application/db/tables/collab_storage';
import { rowSchema, rowTable } from '@/application/db/tables/rows';
import { syncOutboxSchema, syncPermissionBlockSchema, SyncOutboxTable } from '@/application/db/tables/sync_outbox';
import { userSchema, UserTable } from '@/application/db/tables/users';
import { versionSchema, VersionsTable } from '@/application/db/tables/versions';
import { viewMetasSchema, ViewMetasTable } from '@/application/db/tables/view_metas';
import {
  workspaceDatabaseCatalogSchema,
  WorkspaceDatabaseCatalogTable,
} from '@/application/db/tables/workspace_database_catalog';
import {
  workspaceMemberProfileSchema,
  WorkspaceMemberProfileTable,
} from '@/application/db/tables/workspace_member_profiles';
import { serverRestore } from '@/application/server-restore';
import { YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { Log } from '@/utils/log';

import {
  accountCollabStoragePrefix,
  bindCollabStorageScope,
  captureCollabStorageScope,
  COLLAB_STORAGE_PREFIX,
  collabStorageKey,
  isPreScopeCollabStorageName,
  ScopedCollabMap,
  type CollabStorageScope,
} from './collab-storage-scope';
import {
  DATABASE_CACHE_EPOCH_PREFIX,
  DATABASE_RESTORE_MARKER_PREFIX,
  DatabaseStorageGenerationChangedError,
  type DatabaseStorageFence,
  databaseStorageFenceObjectId,
  getApplyingDatabaseStorageFence,
  isDatabaseStorageFenceCurrent,
  publishDatabaseCacheEpoch,
  readDatabaseCacheEpoch,
} from './database-storage-fence';

type DexieTables = AtomicCreationTable &
  ViewMetasTable &
  UserTable &
  rowTable &
  WorkspaceMemberProfileTable &
  VersionsTable &
  SyncOutboxTable &
  CollabStorageTable &
  AppViewCacheTable &
  WorkspaceDatabaseCatalogTable;

export type Dexie<T = DexieTables> = BaseDexie & T;

export const db = new BaseDexie(serverRestore.cacheKey(`${databasePrefix}_cache`)) as Dexie;
const _schema = Object.assign(
  {},
  {
    ...atomicCreationSchema,
    ...viewMetasSchema,
    ...userSchema,
    ...rowSchema,
    ...versionSchema,
    ...syncOutboxSchema,
    ...collabStorageSchema,
    ...appViewCacheSchema,
    ...workspaceDatabaseCatalogSchema,
  }
);

const legacyAppViewCacheSchema = {
  app_view_cache: '[workspace_id+view_id], workspace_id, view_id, updated_at',
};

const legacyUserIndexedAppViewCacheSchema = {
  app_view_cache: '[workspace_id+view_id], user_id, [user_id+workspace_id+view_id], workspace_id, view_id, updated_at',
};

const dropAppViewCacheSchema = {
  app_view_cache: null,
};

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

// Version 8: durable app view payload cache used by the sidebar to render
// expanded children immediately while refreshing from the server.
db.version(8).stores({
  ...viewMetasSchema,
  ...userSchema,
  ...rowSchema,
  ...workspaceMemberProfileSchema,
  ...versionSchema,
  ...syncOutboxSchema,
  ...collabStorageSchema,
  ...legacyAppViewCacheSchema,
});

// Version 9: add a user-scoped lookup index to app_view_cache. Existing v8 rows
// cannot be safely attributed, so discard them during migration.
db.version(9)
  .stores({
    ...viewMetasSchema,
    ...userSchema,
    ...rowSchema,
    ...workspaceMemberProfileSchema,
    ...versionSchema,
    ...syncOutboxSchema,
    ...collabStorageSchema,
    ...legacyUserIndexedAppViewCacheSchema,
  })
  .upgrade(async (transaction) => {
    try {
      await transaction.table('app_view_cache').clear();
    } catch (error) {
      console.error('Failed to clear app_view_cache on v9 upgrade:', error);
      throw error;
    }
  });

// Version 10: drop the legacy app_view_cache store before changing its primary
// key. Dexie cannot migrate an IndexedDB object store key path in place.
db.version(10).stores({
  ...viewMetasSchema,
  ...userSchema,
  ...rowSchema,
  ...workspaceMemberProfileSchema,
  ...versionSchema,
  ...syncOutboxSchema,
  ...collabStorageSchema,
  ...dropAppViewCacheSchema,
});

// Version 11: recreate app_view_cache with user_id in the primary key so two
// users can persist separate cache rows for the same workspace/view.
db.version(11).stores({
  ...viewMetasSchema,
  ...userSchema,
  ...rowSchema,
  ...workspaceMemberProfileSchema,
  ...versionSchema,
  ...syncOutboxSchema,
  ...collabStorageSchema,
  ...appViewCacheSchema,
});

// Version 12: persist the workspace database catalog by view ID. Database
// identity lookups can now resolve from IndexedDB before fetching the server
// catalog, without reopening the legacy workspace-database collaboration doc.
db.version(12).stores({
  ...viewMetasSchema,
  ...userSchema,
  ...rowSchema,
  ...workspaceMemberProfileSchema,
  ...versionSchema,
  ...syncOutboxSchema,
  ...collabStorageSchema,
  ...appViewCacheSchema,
  ...workspaceDatabaseCatalogSchema,
});

// Version 13: immutable atomic commands are scoped to their original account,
// server and workspace. They are never drained automatically after reconnect.
// Released builds already created this version: it must stay exactly as it is.
db.version(13).stores({
  ...viewMetasSchema,
  ...userSchema,
  ...rowSchema,
  ...workspaceMemberProfileSchema,
  ...versionSchema,
  ...syncOutboxSchema,
  ...collabStorageSchema,
  ...appViewCacheSchema,
  ...workspaceDatabaseCatalogSchema,
  ...atomicCreationSchema,
});

// Version 14: a durable denial survives even when a prior socket submission
// already retired its outbox row. Never infer a new grant from a restart.
db.version(14).stores({
  ...viewMetasSchema, ...userSchema, ...rowSchema, ...workspaceMemberProfileSchema,
  ...versionSchema, ...syncOutboxSchema, ...syncPermissionBlockSchema,
  ...collabStorageSchema, ...appViewCacheSchema, ...workspaceDatabaseCatalogSchema,
  ...atomicCreationSchema,
});

/** Server-scoped account keys are JSON arrays; earlier builds stored the bare account id. */
function isPreScopeAccountCacheRow(record: { user_id?: unknown }): boolean {
  return typeof record.user_id !== 'string' || !record.user_id.startsWith('[');
}

// Version 15: the app view and workspace database catalog caches are keyed by
// a server-scoped account. Rows written under the bare account id can never be
// read, refreshed or evicted again, so drop them (as version 9 did for its key change).
db.version(15)
  .stores({
    ...viewMetasSchema, ...userSchema, ...rowSchema, ...workspaceMemberProfileSchema,
    ...versionSchema, ...syncOutboxSchema, ...syncPermissionBlockSchema,
    ...collabStorageSchema, ...appViewCacheSchema, ...workspaceDatabaseCatalogSchema,
    ...atomicCreationSchema,
  })
  .upgrade(async (transaction) => {
    await Promise.all(
      ['app_view_cache', 'workspace_database_catalog'].map((table) =>
        transaction.table(table).filter(isPreScopeAccountCacheRow).delete()
      )
    );
  });

const openedSet = new Set<string>();
const ensuredStores = new Map<string, Promise<void>>();

const yjsStoreDefinitions = [{ name: 'updates', options: { autoIncrement: true } }, { name: 'custom' }];

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
    const storageName = serverRestore.cacheKey(name);
    const request = typeof version === 'number' ? indexedDB.open(storageName, version) : indexedDB.open(storageName);

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

    const prefix = captureCollabStorageScope().storageKey('');

    // Only this restore generation, then only this account and workspace.
    return new Set(
      databases.flatMap(({ name }) => {
        const logicalName = name ? serverRestore.logicalCacheKey(name) : undefined;

        return logicalName?.startsWith(prefix) ? [logicalName.slice(prefix.length)] : [];
      })
    );
  } catch (error) {
    Log.warn('[DB] failed to list IndexedDB databases', { error });
    return new Set<string>();
  }
}

type SignedOutAccount = { serverUrl: string; userId: string };

const SIGN_OUT_DELETE_BATCH = 16;

/** Pre-scope shared rows are the keys outside the scoped namespace, on either side of it. */
async function deleteSharedRowsOutsideScopedNamespace(
  table: { where: (index: string) => { below: (key: string) => { delete: () => Promise<unknown> }; above: (key: string) => { delete: () => Promise<unknown> } } },
  index: string
) {
  await table.where(index).below(COLLAB_STORAGE_PREFIX).delete();
  await table.where(index).above(`${COLLAB_STORAGE_PREFIX}\uffff`).delete();
}

// After the account prefix: the workspace (JSON string or null), then the object part.
const ACCOUNT_STORAGE_NAME_REST = /^(null|"(?:[^"\\]|\\.)*")\]:(.*)$/s;
const LEGACY_ROW_MARKER = '_rows_';

/** `<workspace JSON>\0<objectId>` for every object of the account that still has outbox rows. */
async function objectsWithUnsentEdits(userId: string): Promise<Set<string>> {
  const keys = await db.sync_outbox
    .where('[userId+workspaceId+objectId]')
    .between([userId, BaseDexie.minKey, BaseDexie.minKey], [userId, BaseDexie.maxKey, BaseDexie.maxKey])
    .uniqueKeys();

  return new Set(keys.map((key) => {
    const [, workspaceId, objectId] = key as unknown as [string, string, string];

    return `${JSON.stringify(workspaceId)}\u0000${objectId}`;
  }));
}

/**
 * True for a storage name of the account whose object still has unsent edits:
 * the object itself, a restored generation of it (`<id>:database-restore:<epoch>`)
 * or, for a row, its legacy copy and row index entry (`<databaseId>_rows_<rowId>`).
 */
function storesObjectWithUnsentEdits(name: string, accountPrefix: string, pending: ReadonlySet<string>): boolean {
  if (pending.size === 0 || !name.startsWith(accountPrefix)) return false;
  const match = ACCOUNT_STORAGE_NAME_REST.exec(name.slice(accountPrefix.length));

  if (!match) return false;
  const [, workspace, rest] = match;
  const base = rest.split(':')[0];
  const rowMarker = base.lastIndexOf(LEGACY_ROW_MARKER);
  const objectId = rowMarker > 0 ? base.slice(rowMarker + LEGACY_ROW_MARKER.length) : base;

  return pending.has(`${workspace}\u0000${objectId}`);
}

/**
 * Removes, at the user's request when signing out, the copies of server
 * content that belong to that account (documents, database rows and their sync
 * checkpoints in every workspace on that server), plus pre-scope copies that
 * cannot be attributed to any account. Unsent edits are kept, with the copies of
 * the objects they belong to: a queued or quarantined database row edit finds
 * its database (for restore checks) through the row's copy. Outbox rows and
 * their quarantine are uploaded only after that account signs in again and a
 * fresh permission check allows it. Edits that were already sent over the
 * realtime connection but never applied cannot be told apart and are lost with
 * their copy. Removes nothing if the outbox cannot be read, and stops as soon as
 * `isSignedOut` reports the same account signed in again. Only the current
 * server restore generation is touched.
 */
export async function removeSignedOutLocalData(account: SignedOutAccount, isSignedOut: () => boolean = () => true) {
  const prefix = accountCollabStoragePrefix(account.serverUrl, account.userId);

  try {
    const pending = await objectsWithUnsentEdits(account.userId);
    const kept = (name: string) => storesObjectWithUnsentEdits(name, prefix, pending);
    const removable = (name: string) => (name.startsWith(prefix) && !kept(name)) || isPreScopeCollabStorageName(name);
    const factory = typeof indexedDB === 'undefined' ? undefined : (indexedDB as IndexedDBFactoryWithDatabases);

    if (factory?.databases && isSignedOut()) {
      // Only this restore generation: copies an earlier generation left behind, with any
      // edits queued there, are never read, uploaded or removed from here.
      const names = (await factory.databases()).flatMap(({ name }) => {
        const logicalName = name ? serverRestore.logicalCacheKey(name) : undefined;

        return logicalName && removable(logicalName) ? [logicalName] : [];
      });

      // A blocked delete completes once the closing tab releases its connection.
      for (let index = 0; index < names.length; index += SIGN_OUT_DELETE_BATCH) {
        if (!isSignedOut()) return;
        await Promise.all(names.slice(index, index + SIGN_OUT_DELETE_BATCH).map((name) => deleteIndexedDBDatabase(name)));
      }
    }

    if (!isSignedOut()) return;
    await db.transaction('rw', [db.collab_snapshots, db.collab_updates, db.collab_custom, db.rows], async () => {
      if (!isSignedOut()) return;
      const sharedTables: Array<Table<{ objectId: string }>> = [db.collab_snapshots, db.collab_updates, db.collab_custom];

      for (const table of sharedTables) {
        await table.where('objectId').startsWith(prefix).filter((record) => !kept(record.objectId)).delete();
        await deleteSharedRowsOutsideScopedNamespace(table, 'objectId');
      }

      await db.rows.where('row_key').startsWith(prefix).filter((record) => !kept(record.row_key)).delete();
      await deleteSharedRowsOutsideScopedNamespace(db.rows, 'row_key');
    });

    if (!isSignedOut()) return;
    removeLocalStorageKeys((key) =>
      [DATABASE_BLOB_RID_PREFIX, DATABASE_CACHE_EPOCH_PREFIX].some((keyPrefix) =>
        key.startsWith(keyPrefix) && removable(key.slice(keyPrefix.length))) ||
      key.startsWith(`${DATABASE_RESTORE_MARKER_PREFIX}v1:${account.serverUrl}:${account.userId}:`));

    const accountKey = JSON.stringify([account.serverUrl, account.userId]);

    await db.app_view_cache.where('user_id').equals(accountKey).delete();
    await db.workspace_database_catalog
      .where('[user_id+workspace_id]')
      .between([accountKey, BaseDexie.minKey], [accountKey, BaseDexie.maxKey])
      .delete();
  } catch (error) {
    Log.warn('[DB] could not remove local data after sign-out', { error });
  }
}

async function probeCollabIndexedDBExists(name: string) {
  if (typeof indexedDB === 'undefined') return false;

  return new Promise<boolean>((resolve) => {
    let createdDuringProbe = false;
    let settled = false;
    const resolveOnce = (exists: boolean) => {
      if (settled) return;

      settled = true;
      resolve(exists);
    };

    try {
      const request = indexedDB.open(serverRestore.cacheKey(name));

      request.onupgradeneeded = () => {
        createdDuringProbe = true;
      };

      request.onsuccess = async () => {
        const database = request.result;

        database.close();

        if (createdDuringProbe) {
          const deleted = await deleteIndexedDBDatabase(name);

          if (!deleted) {
            Log.warn('[DB] failed to delete empty IndexedDB database created while probing existence', { name });
          }

          resolveOnce(false);
          return;
        }

        resolveOnce(true);
      };

      request.onerror = () => {
        Log.warn('[DB] failed to probe collab IndexedDB database', { name, error: request.error });
        resolveOnce(false);
      };

      request.onblocked = () => {
        Log.warn('[DB] collab IndexedDB existence probe blocked', { name });
        resolveOnce(false);
      };
    } catch (error) {
      Log.warn('[DB] failed to probe collab IndexedDB database', { name, error });
      resolveOnce(false);
    }
  });
}

export async function collabIndexedDBExists(name: string) {
  if (!name) return false;
  const storageName = collabStorageKey(name);

  if (typeof indexedDB === 'undefined') return false;

  const indexedDBWithDatabases = indexedDB as IndexedDBFactoryWithDatabases;

  if (typeof indexedDBWithDatabases.databases === 'function') {
    try {
      const databases = await indexedDBWithDatabases.databases();

      return databases.some((database) => database.name === serverRestore.cacheKey(storageName));
    } catch (error) {
      Log.warn('[DB] failed to list IndexedDB databases while checking collab existence', { name, error });
    }
  }

  return probeCollabIndexedDBExists(storageName);
}

export interface OpenCollabOptions {
  /** Database roots use an isolated durable namespace after each committed restore. */
  databaseRestoreId?: string;
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
  databaseRestoreId?: string;
  doc: YDoc;
  provider: CollabPersistenceProvider;
  whenSynced: Promise<void>;
  disposed: boolean;
  settleWhenDisposed: () => void;
}

let providerRetirements: Promise<void> = Promise.resolve();

function retireProviders(entries: Map<string, CachedProviderEntry>): void {
  if (entries.size === 0) return;
  providerRetirements = Promise.all([
    providerRetirements,
    ...[...entries.values()].map((entry) => destroyProviderEntry(entry).catch((error) =>
      Log.warn('[DB] failed to close previous collaboration context', error))),
  ]).then(() => undefined);
}

const providerCache = new ScopedCollabMap<CachedProviderEntry>(retireProviders);
const pendingOpens = new ScopedCollabMap<Promise<CachedProviderEntry>>();
const rowProviderCache = new ScopedCollabMap<CachedProviderEntry>(retireProviders);
const pendingRowOpens = new ScopedCollabMap<Promise<CachedProviderEntry>>();
const DATABASE_BLOB_RID_PREFIX = serverRestore.cacheKey('af_database_blob_rid:');
const SHARED_COLLAB_COMPACT_UPDATE_THRESHOLD = 200;
const SHARED_STORAGE_EPOCH_KEY = '__storage_epoch';
const SHARED_COLLAB_COMPACT_MAX_RETRIES = 3;
const DELETE_INDEXEDDB_BLOCKED_TIMEOUT_MS = 2000;

type CollabPersistenceProvider = IndexeddbPersistence | SharedIndexeddbPersistence;
type SharedCollabOpenOptions = {
  awaitSync?: boolean;
  expectedVersion?: string;
  forceReset?: boolean;
  skipCache?: boolean;
};

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

/** Capture the aggregate epoch before requesting any row bytes from the server. */
export async function captureDatabaseStorageFence(
  databaseId: string,
  options: { required?: boolean } = {}
): Promise<DatabaseStorageFence> {
  const scope = captureCollabStorageScope();

  try {
    return await db.transaction('r', db.collab_custom, async () => {
      const record = await db.collab_custom.get([databaseStorageFenceObjectId(databaseId), SHARED_STORAGE_EPOCH_KEY]);

      scope.assertCurrent();
      const epoch = typeof record?.value === 'string' ? record.value : null;
      const cacheEpoch = readDatabaseCacheEpoch(databaseId);

      if (options.required && cacheEpoch === undefined) throw new Error('Database cache fencing is unavailable');
      return {
        databaseId,
        scopeKey: scope.key, scopeGeneration: scope.generation,
        epoch,
        cacheEpoch,
        ...(epoch === null && cacheEpoch === undefined ? { nonDurable: true } : {}),
      };
    });
  } catch (error) {
    scope.assertCurrent();
    const cacheEpoch = readDatabaseCacheEpoch(databaseId);

    if (options.required || typeof cacheEpoch === 'string') throw error;
    // Published/ordinary reads already support unavailable IndexedDB. Their
    // seed carries the unmarked generation, so any eventual durable write
    // still rejects it if storage recovers after a restore in another tab.
    return { databaseId, scopeKey: scope.key, scopeGeneration: scope.generation, epoch: null, cacheEpoch, nonDurable: true };
  }
}

/** Called before replacing a restored database's root or any of its rows. */
export async function rotateDatabaseStorageFence(
  databaseId: string,
  databaseRestoreId: string,
  expectedEpoch: string | null
): Promise<void> {
  const scope = captureCollabStorageScope();

  await db.transaction('rw', db.collab_custom, async () => {
    scope.assertCurrent();
    const objectId = databaseStorageFenceObjectId(databaseId);
    const current = await db.collab_custom.get([objectId, SHARED_STORAGE_EPOCH_KEY]);
    const epoch = typeof current?.value === 'string' ? current.value : null;

    scope.assertCurrent();
    if (epoch !== databaseRestoreId && epoch !== expectedEpoch) throw new DatabaseStorageGenerationChangedError();

    // Two tabs reconciling the same committed restore share one generation.
    // Retrying must not retire a provider already hydrated by the other tab.
    if (current?.value !== databaseRestoreId) {
      await db.collab_custom.put({ objectId, key: SHARED_STORAGE_EPOCH_KEY, value: databaseRestoreId });
    }

    // Seed reads are synchronous. Publishing under the same transaction lock
    // makes their cross-tab shadow change before replacement storage is visible.
    publishDatabaseCacheEpoch(databaseId, databaseRestoreId);
  });
}

/** The caller must hold a transaction that includes collab_custom while mutating storage. */
export async function matchesDatabaseStorageFence(fence: DatabaseStorageFence): Promise<boolean> {
  if (!isDatabaseStorageFenceCurrent(fence)) return false;
  const record = await db.collab_custom.get([databaseStorageFenceObjectId(fence.databaseId), SHARED_STORAGE_EPOCH_KEY]);

  return isDatabaseStorageFenceCurrent(fence) && (typeof record?.value === 'string' ? record.value : null) === fence.epoch;
}

/** Publish a synchronous cache checkpoint only while its durable generation is current. */
export async function publishWithDatabaseStorageFence(
  fence: DatabaseStorageFence,
  publish: () => void
): Promise<boolean> {
  try {
    return await db.transaction('rw', db.collab_custom, async () => {
      if (!isDatabaseStorageFenceCurrent(fence) || !(await matchesDatabaseStorageFence(fence))) return false;
      publish();
      return true;
    });
  } catch (error) {
    if (!fence.nonDurable || !isDatabaseStorageFenceCurrent(fence)) throw error;
    publish();
    return true;
  }
}

async function readSharedCollabRecordsForSync(name: string): Promise<{
  snapshot: CollabSnapshotRecord | undefined;
  updates: CollabUpdateRecord[];
  storageEpoch: string | null;
}> {
  return db.transaction('r', db.collab_snapshots, db.collab_updates, db.collab_custom, async () => {
    const epoch = await db.collab_custom.get([name, SHARED_STORAGE_EPOCH_KEY]);
    const snapshot = await db.collab_snapshots.get(name);
    const updates = await db.collab_updates
      .where('[objectId+id]')
      .between([name, BaseDexie.minKey], [name, BaseDexie.maxKey])
      .toArray();

    return { snapshot, updates, storageEpoch: typeof epoch?.value === 'string' ? epoch.value : null };
  });
}

/** Resolve rows owned by another tab without opening a provider or binding sync. */
export async function readDatabaseIdFromRowCache(rowId: string): Promise<string | undefined> {
  const scope = captureCollabStorageScope();
  const { snapshot, updates } = await readSharedCollabRecordsForSync(scope.storageKey(rowId));

  scope.assertCurrent();
  const doc = new Y.Doc();

  try {
    if (snapshot?.update) Y.applyUpdate(doc, snapshot.update);
    for (const record of updates) Y.applyUpdate(doc, record.update);
    const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
    const databaseId = row instanceof Y.Map ? row.get(YjsDatabaseKey.database_id) : undefined;

    return typeof databaseId === 'string' && databaseId.length > 0 ? databaseId : undefined;
  } finally {
    doc.destroy();
  }
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
      (provider as { off?: (event: string, listener: (...args: unknown[]) => void) => void }).off?.(
        'synced',
        handleSync
      );
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
  // Keep the queue usable for later edits without losing an earlier failure.
  private _persistenceError?: { error: unknown };
  private _updatesSinceCompact = 0;
  private _storageEpoch: string | null = null;
  private _storageRetired = false;
  private _databaseStorageFence?: DatabaseStorageFence;

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
      const { snapshot, updates, storageEpoch } = await readSharedCollabRecordsForSync(this.name);

      this._storageEpoch = storageEpoch;

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
      this._persistenceError ??= { error };
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
    if (this._destroyed || this._storageRetired || origin === this) {
      return;
    }

    const persistedUpdate = new Uint8Array(update);
    const databaseStorageFence = getApplyingDatabaseStorageFence(this.doc);

    if (databaseStorageFence) {
      // A provider already containing another aggregate must never adopt the
      // new epoch: its in-memory CRDT would carry the previous branch forward.
      if (
        this._databaseStorageFence &&
        (this._databaseStorageFence.databaseId !== databaseStorageFence.databaseId ||
          this._databaseStorageFence.epoch !== databaseStorageFence.epoch)
      )
        this._storageRetired = true;
      else this._databaseStorageFence = databaseStorageFence;
    }

    // Synchronous fenced publication can run inside a collab_custom-only
    // transaction. Observer work outlives that transaction and must own its
    // storage scope; its own transaction below still rechecks both epochs.
    this._pendingWrite = BaseDexie.ignoreTransaction(() => this._pendingWrite
      .then(async () => {
        await this.whenSynced;
        const persisted = await db.transaction('rw', db.collab_updates, db.collab_custom, async () => {
          if (!(await this.isCurrentStorageEpoch())) return false;
          if (databaseStorageFence && !(await matchesDatabaseStorageFence(databaseStorageFence))) return false;
          await db.collab_updates.add({
            objectId: this.name,
            update: persistedUpdate,
            createdAt: Date.now(),
            byteLength: persistedUpdate.byteLength,
          });
          return true;
        });

        if (!persisted) throw new DatabaseStorageGenerationChangedError();
        this._updatesSinceCompact += 1;

        if (this._updatesSinceCompact >= SHARED_COLLAB_COMPACT_UPDATE_THRESHOLD) {
          await this.compact();
        }
      })
      .catch((error) => {
        this._persistenceError ??= { error };
        Log.warn('[DB] failed to persist shared collab update', { name: this.name, error });
      }));
  };

  /** The epoch check and write share a transaction with authoritative cache deletion. */
  private async isCurrentStorageEpoch(): Promise<boolean> {
    if (this._storageRetired) return false;
    const record = await db.collab_custom.get([this.name, SHARED_STORAGE_EPOCH_KEY]);
    const current = typeof record?.value === 'string' ? record.value : null;

    if (current !== this._storageEpoch) this._storageRetired = true;
    if (this._databaseStorageFence && !(await matchesDatabaseStorageFence(this._databaseStorageFence)))
      this._storageRetired = true;
    return !this._storageRetired;
  }

  private queueCompact() {
    this._pendingWrite = BaseDexie.ignoreTransaction(() => this._pendingWrite
      .then(() => this.compact())
      .catch((error) => {
        this._persistenceError ??= { error };
        Log.warn('[DB] failed to compact shared collab updates', { name: this.name, error });
      }));
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
        await db.transaction('rw', db.collab_snapshots, db.collab_updates, db.collab_custom, async () => {
          if (!(await this.isCurrentStorageEpoch())) return;
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

  /** Confirm durability without changing best-effort provider cleanup. */
  async whenPersisted(): Promise<void> {
    await this.whenSynced;
    await this._pendingWrite;
    if (this._persistenceError) throw this._persistenceError.error;
    if (this._storageRetired) throw new DatabaseStorageGenerationChangedError();
    if (this._destroyed) throw new CollabProviderDisposedError(this.name);
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
    await this.whenSynced;
    await db.transaction('rw', db.collab_custom, async () => {
      if (!(await this.isCurrentStorageEpoch())) return;
      await db.collab_custom.put({ objectId: this.name, key: String(key), value });
    });

    return value;
  }

  async del(key: IDBValidKey) {
    await this.whenSynced;
    await db.transaction('rw', db.collab_custom, async () => {
      if (!(await this.isCurrentStorageEpoch())) return;
      await db.collab_custom.delete([this.name, String(key)]);
    });
  }
}

async function destroyProviderEntry(entry: CachedProviderEntry, options: { destroyDoc?: boolean } = {}) {
  if (entry.disposed) return;
  entry.settleWhenDisposed();
  await entry.provider.destroy();

  if (options.destroyDoc !== false) {
    entry.doc.destroy();
  }
}

async function disposeEntries(
  name: string,
  cache: Map<string, CachedProviderEntry>,
  pendingEntries: Map<string, Promise<CachedProviderEntry>>,
  options: { destroyDoc?: boolean }
) {
  const cached = cache.get(name);
  const pending = pendingEntries.get(name);

  cache.delete(name);
  pendingEntries.delete(name);
  const entries = new Set<CachedProviderEntry>(cached ? [cached] : []);

  if (pending) {
    try { entries.add(await pending); }
    catch (error) { Log.warn('[DB] failed to resolve retired provider', { name, error }); }
  }

  await Promise.all([...entries].map((entry) => destroyProviderEntry(entry, options)));
  return entries.size > 0;
}

function disposeCachedProvider(name: string, options: { destroyDoc?: boolean } = {}) {
  return disposeEntries(name, providerCache.capture(), pendingOpens.capture(), options);
}

function disposeRowProvider(name: string, options: { destroyDoc?: boolean } = {}) {
  return disposeEntries(name, rowProviderCache.capture(), pendingRowOpens.capture(), options);
}

async function deleteIndexedDBDatabase(name: string, options: { blockedTimeoutMs?: number } = {}) {
  if (typeof indexedDB === 'undefined') return true;

  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(serverRestore.cacheKey(name));
    let settled = false;
    let blockedTimeout: ReturnType<typeof setTimeout> | undefined;

    const resolveOnce = (deleted: boolean) => {
      if (settled) return;

      settled = true;

      if (blockedTimeout) {
        clearTimeout(blockedTimeout);
      }

      resolve(deleted);
    };

    request.onsuccess = () => resolveOnce(true);
    request.onerror = () => {
      Log.warn('[DB] failed to delete collab IndexedDB database', { name, error: request.error });
      resolveOnce(false);
    };

    request.onblocked = () => {
      Log.warn('[DB] delete collab IndexedDB database blocked', { name });

      if (blockedTimeout) {
        clearTimeout(blockedTimeout);
      }

      blockedTimeout = setTimeout(() => {
        Log.warn('[DB] delete collab IndexedDB database timed out after blocked', { name });
        resolveOnce(false);
      }, options.blockedTimeoutMs ?? DELETE_INDEXEDDB_BLOCKED_TIMEOUT_MS);
    };
  });
}

async function deleteSharedCollabData(name: string, storageFence?: DatabaseStorageFence, databaseRestoreId?: string) {
  if (typeof indexedDB === 'undefined') return true;

  try {
    const scope = captureCollabStorageScope();

    const storageName = scope.storageKey(name);

    await db.transaction('rw', db.collab_snapshots, db.collab_updates, db.collab_custom, async () => {
      scope.assertCurrent();
      if (storageFence && !(await matchesDatabaseStorageFence(storageFence)))
        throw new Error('Database storage generation changed');
      if (databaseRestoreId) {
        const current = await db.collab_custom.get([storageName, SHARED_STORAGE_EPOCH_KEY]);

        if (current?.value === databaseRestoreId) return;
      }

      await db.collab_snapshots.delete(storageName);
      await db.collab_updates.where('objectId').equals(storageName).delete();
      await db.collab_custom.where('objectId').equals(storageName).delete();
      // Keep a tombstone epoch: a provider in another tab must not append its
      // previous branch after these stores have been cleared and reopened.
      await db.collab_custom.put({
        objectId: storageName,
        key: SHARED_STORAGE_EPOCH_KEY,
        value: databaseRestoreId ?? createSharedCollabSnapshotId(),
      });
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
    databaseRestoreId: options.databaseRestoreId,
  });

  return doc;
}

export async function openCollabDBWithProvider(
  name: string,
  options?: {
    awaitSync?: boolean;
    expectedVersion?: string;
    forceReset?: boolean;
    skipCache?: boolean;
    databaseRestoreId?: string;
  }
): Promise<{ doc: YDoc; provider: IndexeddbPersistence }> {
  const scope = captureCollabStorageScope();
  const cache = providerCache.capture();
  const pendingCache = pendingOpens.capture();

  await providerRetirements;
  scope.assertCurrent();
  const capturedFence = await captureDatabaseStorageFence(name);

  scope.assertCurrent();
  const publishedRestoreId = capturedFence.cacheEpoch;

  // A fresh page load must never read the unversioned root when durable
  // storage knows a restore that its synchronous shadow has not observed.
  if (
    (capturedFence.epoch !== null || typeof publishedRestoreId === 'string') &&
    capturedFence.epoch !== publishedRestoreId
  )
    throw new DatabaseStorageGenerationChangedError();
  const databaseRestoreId = options?.databaseRestoreId ?? publishedRestoreId ?? undefined;

  if (options?.databaseRestoreId && options.databaseRestoreId !== publishedRestoreId) {
    throw new DatabaseStorageGenerationChangedError();
  }

  const resolvedOptions = { ...options, databaseRestoreId };

  // Ephemeral callers bypass cache entirely
  if (resolvedOptions?.skipCache) {
    const entry = await _openCollabDBWithProviderInternal(name, resolvedOptions, scope);

    if (resolvedOptions.awaitSync !== false) {
      await waitForProviderEntry(name, entry);
    }

    if (entry.disposed) {
      throw new CollabProviderDisposedError(name);
    }

    scope.assertCurrent();
    return { doc: entry.doc, provider: entry.provider as IndexeddbPersistence };
  }

  const needsReset =
    resolvedOptions?.forceReset ||
    resolvedOptions?.expectedVersion ||
    (cache.has(name) && cache.get(name)?.databaseRestoreId !== databaseRestoreId);

  if (needsReset) {
    // Close stale connections before deleting/reopening this object's IndexedDB.
    await disposeCachedProvider(name);
    scope.assertCurrent();
  } else {
    // Check providerCache for a resolved entry
    const cached = cache.get(name);

    if (cached) {
      if (resolvedOptions?.awaitSync !== false) {
        await waitForProviderEntry(name, cached);
      }

      if (cached.disposed) {
        cache.delete(name);
        throw new CollabProviderDisposedError(name);
      }

      scope.assertCurrent();
    return { doc: cached.doc, provider: cached.provider as IndexeddbPersistence };
    }

    // Join an in-flight open for the same name
    const pending = pendingCache.get(name);

    if (pending) {
      const entry = await pending;

      if (entry.databaseRestoreId !== databaseRestoreId) {
        scope.assertCurrent();
        await disposeCachedProvider(name);
        scope.assertCurrent();
        return openCollabDBWithProvider(name, resolvedOptions);
      }

      if (resolvedOptions?.awaitSync !== false) {
        await waitForProviderEntry(name, entry);
      }

      if (entry.disposed) {
        throw new CollabProviderDisposedError(name);
      }

      scope.assertCurrent();
    return { doc: entry.doc, provider: entry.provider as IndexeddbPersistence };
    }
  }

  // Create new entry and cache it
  const promise = _openCollabDBWithProviderInternal(name, resolvedOptions, scope);

  pendingCache.set(name, promise);

  try {
    const entry = await promise;

    if (!scope.isCurrent()) {
      await destroyProviderEntry(entry);
      scope.assertCurrent();
    }

    if (pendingCache.get(name) === promise) {
      cache.set(name, entry);

      // Auto-evict if the doc is destroyed via an external path
      // (e.g., handleAccessChanged, version revert) so subsequent
      // callers don't receive a stale, destroyed Y.Doc.
      entry.doc.on('destroy', () => {
        if (cache.get(name) === entry) {
          cache.delete(name);
        }
      });
    }

    if (resolvedOptions?.awaitSync !== false) {
      await waitForProviderEntry(name, entry);
    }

    if (entry.disposed) {
      throw new CollabProviderDisposedError(name);
    }

    scope.assertCurrent();
    return { doc: entry.doc, provider: entry.provider as IndexeddbPersistence };
  } finally {
    if (pendingCache.get(name) === promise) {
      pendingCache.delete(name);
    }
  }
}

export async function openRowCollabDBWithProvider(
  name: string,
  options?: SharedCollabOpenOptions
): Promise<{ doc: YDoc; provider: SharedIndexeddbPersistence }> {
  const scope = captureCollabStorageScope();
  const cache = rowProviderCache.capture();
  const pendingCache = pendingRowOpens.capture();

  await providerRetirements;
  scope.assertCurrent();
  if (options?.skipCache) {
    const entry = await _openRowCollabDBWithProviderInternal(name, options, scope);

    if (options.awaitSync !== false) {
      await waitForProviderEntry(name, entry);
    }

    if (entry.disposed) {
      throw new CollabProviderDisposedError(name);
    }

    scope.assertCurrent();
    return { doc: entry.doc, provider: entry.provider as SharedIndexeddbPersistence };
  }

  const needsReset = options?.forceReset || options?.expectedVersion;

  if (needsReset) {
    await disposeRowProvider(name);
    scope.assertCurrent();
  } else {
    const cached = cache.get(name);

    if (cached) {
      if (options?.awaitSync !== false) {
        await waitForProviderEntry(name, cached);
      }

      if (cached.disposed) {
        cache.delete(name);
        throw new CollabProviderDisposedError(name);
      }

      scope.assertCurrent();
    return { doc: cached.doc, provider: cached.provider as SharedIndexeddbPersistence };
    }

    const pending = pendingCache.get(name);

    if (pending) {
      const entry = await pending;

      if (options?.awaitSync !== false) {
        await waitForProviderEntry(name, entry);
      }

      if (entry.disposed) {
        throw new CollabProviderDisposedError(name);
      }

      scope.assertCurrent();
    return { doc: entry.doc, provider: entry.provider as SharedIndexeddbPersistence };
    }
  }

  const promise = _openRowCollabDBWithProviderInternal(name, options, scope);

  pendingCache.set(name, promise);

  try {
    const entry = await promise;

    if (!scope.isCurrent()) {
      await destroyProviderEntry(entry);
      scope.assertCurrent();
    }

    if (pendingCache.get(name) === promise) {
      cache.set(name, entry);
      entry.doc.on('destroy', () => {
        if (cache.get(name) === entry) {
          cache.delete(name);
        }
      });
    }

    if (options?.awaitSync !== false) {
      await waitForProviderEntry(name, entry);
    }

    if (entry.disposed) {
      throw new CollabProviderDisposedError(name);
    }

    scope.assertCurrent();
    return { doc: entry.doc, provider: entry.provider as SharedIndexeddbPersistence };
  } finally {
    if (pendingCache.get(name) === promise) {
      pendingCache.delete(name);
    }
  }
}

async function _openRowCollabDBWithProviderInternal(
  name: string,
  options: { expectedVersion?: string; forceReset?: boolean } | undefined,
  scope: CollabStorageScope
): Promise<CachedProviderEntry> {
  const startedAt = Date.now();
  let doc = new Y.Doc({
    guid: name,
  }) as YDoc;
  let provider = new SharedIndexeddbPersistence(scope.storageKey(name), doc);
  let version = (await provider.get(name + '/version')) as string | undefined;

  if (!scope.isCurrent()) {
    await provider.destroy();
    doc.destroy();
    scope.assertCurrent();
  }

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
    provider = new SharedIndexeddbPersistence(scope.storageKey(name), doc);

    if (options?.expectedVersion) {
      await provider.set(name + '/version', options.expectedVersion);
      version = options.expectedVersion;
    } else {
      version = undefined;
    }
  }

  bindCollabStorageScope(doc, scope);
  if (!scope.isCurrent()) {
    await provider.destroy();
    doc.destroy();
    scope.assertCurrent();
  }

  doc.version = version;

  return createCachedProviderEntry(name, startedAt, doc, provider);
}

async function _openCollabDBWithProviderInternal(
  name: string,
  options: { expectedVersion?: string; forceReset?: boolean; databaseRestoreId?: string } | undefined,
  scope: CollabStorageScope
): Promise<CachedProviderEntry> {
  const startedAt = Date.now();
  const storageName = databaseRootStorageName(scope.storageKey(name), options?.databaseRestoreId);

  Log.debug('[DB] openCollabDBWithProvider start', {
    name,
    alreadyOpened: openedSet.has(name),
  });

  let doc = new Y.Doc({
    guid: name,
  }) as YDoc;

  await ensureYjsStores(storageName);

  let provider = new IndexeddbPersistence(serverRestore.cacheKey(storageName), doc);
  let version = await provider.get(name + '/version');

  if (!scope.isCurrent()) {
    await provider.destroy();
    doc.destroy();
    scope.assertCurrent();
  }

  if (options?.databaseRestoreId) {
    // Another tab can already be initializing this same R namespace. Missing
    // version metadata is initialization, never permission to delete its data.
    if (
      options.forceReset ||
      (options.expectedVersion && version !== undefined && version !== null && version !== options.expectedVersion)
    ) {
      await provider.destroy();
      doc.destroy();
      throw new Error('The restored database cache version is inconsistent; reload could not safely replace it');
    }

    if (options.expectedVersion && (version === undefined || version === null)) {
      await provider.set(name + '/version', options.expectedVersion);
      version = options.expectedVersion;
    }
  } else if (options?.forceReset || (options?.expectedVersion && version !== options.expectedVersion)) {
    await provider.destroy();
    doc.destroy();

    const deleted = await deleteIndexedDBDatabase(storageName);

    if (!deleted) {
      throw new Error(`Failed to delete IndexedDB database for collab ${name}`);
    }

    await ensureYjsStores(storageName);
    doc = new Y.Doc({
      guid: name,
    }) as YDoc;
    provider = new IndexeddbPersistence(serverRestore.cacheKey(storageName), doc);

    if (options?.expectedVersion) {
      await provider.set(name + '/version', options.expectedVersion);
      version = options.expectedVersion;
    } else {
      version = undefined;
    }
  }

  bindCollabStorageScope(doc, scope);
  if (!scope.isCurrent()) {
    await provider.destroy();
    doc.destroy();
    scope.assertCurrent();
  }

  doc.version = version;

  const entry = createCachedProviderEntry(name, startedAt, doc, provider);

  entry.databaseRestoreId = options?.databaseRestoreId;
  return entry;
}

function databaseRootStorageName(name: string, databaseRestoreId?: string): string {
  return databaseRestoreId ? `${name}:database-restore:${databaseRestoreId}` : name;
}

export async function closeCollabDB(name: string) {
  openedSet.delete(name);
  await Promise.all([disposeCachedProvider(name), disposeRowProvider(name)]);
}

/**
 * Destroy any in-memory provider/doc for the object and delete its local copy
 * (y-indexeddb database, restored generation and shared row data). Used for
 * object deletion, explicit resets, discarded edits and lost read access. The
 * sync outbox is separate: unsent edits of a revoked object stay quarantined
 * there for the user's Try again or Discard.
 */
export async function deleteCollabDB(
  name: string,
  options: {
    destroyDoc?: boolean;
    storageFence?: DatabaseStorageFence;
    databaseRestoreId?: string;
    databaseId?: string;
  } = {}
) {
  const scope = captureCollabStorageScope();
  const storageName = scope.storageKey(name);
  const storageFence =
    options.storageFence ??
    (options.databaseRestoreId
      ? {
          databaseId: options.databaseId ?? name,
          epoch: options.databaseRestoreId,
          cacheEpoch: options.databaseRestoreId,
        }
      : undefined);

  if (storageFence && !isDatabaseStorageFenceCurrent(storageFence)) return false;
  if (!name) return false;

  if (openedSet.has(name)) {
    openedSet.delete(name);
  }

  ensuredStores.delete(name);
  await Promise.all([disposeCachedProvider(name, options), disposeRowProvider(name, options)]);
  scope.assertCurrent();

  // Restored roots live in a namespace selected by R. The legacy root can stay
  // open in another tab without blocking replacement or affecting R's bytes.
  const currentStorageName = databaseRootStorageName(storageName, readDatabaseCacheEpoch(name) ?? undefined);
  const [legacyDeleted, generationDeleted, sharedDataDeleted] = await Promise.all([
    options.databaseRestoreId ? true : deleteIndexedDBDatabase(storageName),
    !options.databaseRestoreId && currentStorageName !== storageName ? deleteIndexedDBDatabase(currentStorageName) : true,
    deleteSharedCollabData(name, storageFence, options.databaseRestoreId),
  ]);
  const indexedDbDeleted = legacyDeleted && generationDeleted;

  if (indexedDbDeleted && sharedDataDeleted) {
    Log.debug('[DB] deleted collab IndexedDB database', { name });
  }

  return indexedDbDeleted && sharedDataDeleted;
}

const DATABASE_COPY_DELETE_BATCH = 16;

/** Row ids listed by the views of a database document. */
export function collectDatabaseRowIds(doc: Y.Doc): string[] {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;
  const rowIds = new Set<string>();

  database?.get(YjsDatabaseKey.views)?.forEach((view) => {
    view?.get(YjsDatabaseKey.row_orders)?.forEach((row: { id?: unknown } | undefined) => {
      if (typeof row?.id === 'string' && row.id) rowIds.add(row.id);
    });
  });
  return Array.from(rowIds);
}

/** Rows listed by the database's local copy (current generation), without caching it. */
async function readLocalDatabaseRowIds(databaseId: string, names: ReadonlySet<string>): Promise<string[]> {
  const generationPrefix = `${databaseId}:database-restore:`;

  if (!names.has(databaseId) && !Array.from(names).some((name) => name.startsWith(generationPrefix))) return [];

  try {
    const { doc, provider } = await openCollabDBWithProvider(databaseId, { skipCache: true });

    try {
      return collectDatabaseRowIds(doc);
    } finally {
      await provider.destroy();
      doc.destroy();
    }
  } catch (error) {
    Log.warn('[DB] could not read the rows of a revoked database', { databaseId, error });
    return [];
  }
}

/** Objects of the current storage scope that still have outbox rows. */
async function scopeObjectsWithUnsentEdits(scope: CollabStorageScope): Promise<Set<string>> {
  const [, userId, workspaceId] = JSON.parse(scope.key) as [string, string | null, string | null];

  if (!userId || !workspaceId) return new Set();
  const keys = await db.sync_outbox
    .where('[userId+workspaceId+objectId]')
    .between([userId, workspaceId, BaseDexie.minKey], [userId, workspaceId, BaseDexie.maxKey])
    .uniqueKeys();

  return new Set(keys.map((key) => (key as unknown as [string, string, string])[2]));
}

/**
 * Removes the local copy of a database the user can no longer read, with the
 * copies of its rows and row pages: deleteCollabDB(databaseId) alone leaves
 * every cached row readable. Rows come from the database's content (in memory
 * or its local copy), `knownRowIds` and the legacy row index. The copy of a row
 * that still has unsent edits is kept, because those quarantined edits find
 * their database through it after a later grant. Row removal is best effort;
 * the database's own copy is always removed. Resolves like deleteCollabDB for
 * the database.
 */
export async function deleteDatabaseLocalCopies(
  databaseId: string,
  options: { destroyDoc?: boolean; knownRowIds?: Iterable<string> } = {}
): Promise<boolean> {
  const scope = captureCollabStorageScope();
  const rowIds = new Set(options.knownRowIds ?? []);
  // Read an in-memory database before anything is awaited: callers destroy it next.
  const cached = getCachedProviderDoc(databaseId);

  if (cached) collectDatabaseRowIds(cached).forEach((rowId) => rowIds.add(rowId));
  // Never removes another account's or workspace's copy after a switch, never rejects.
  const deleteDatabase = () => scope.isCurrent()
    ? deleteCollabDB(databaseId, { destroyDoc: options.destroyDoc }).catch((error) => {
      Log.warn('[DB] could not remove the copy of a revoked database', { databaseId, error });
      return false;
    })
    : Promise.resolve(false);
  // The database's own copy is read below to list its rows when it is not in memory.
  const databaseDeleted = cached ? deleteDatabase() : undefined;

  try {
    const names = await listCollabIndexedDBNames();
    const legacyPrefix = scope.storageKey(`${databaseId}${LEGACY_ROW_MARKER}`);

    (await db.rows.where('row_key').startsWith(legacyPrefix).toArray()).forEach((row) => rowIds.add(row.row_id));
    if (!cached) (await readLocalDatabaseRowIds(databaseId, names)).forEach((rowId) => rowIds.add(rowId));
    scope.assertCurrent();

    const pending = await scopeObjectsWithUnsentEdits(scope);
    const removableRows = Array.from(rowIds).filter((rowId) => !pending.has(rowId));
    const rowNames = removableRows.map((rowId) => scope.storageKey(rowId));
    const shared = new Set<string>([
      ...(await db.collab_snapshots.where('objectId').anyOf(rowNames).primaryKeys()),
      ...((await db.collab_updates.where('objectId').anyOf(rowNames).keys()) as string[]),
    ]);
    const stored = (name: string) => names.has(name) || hasCollabDocInMemory(name);
    const targets = [
      ...removableRows.filter((rowId) => shared.has(scope.storageKey(rowId)) || stored(rowId)),
      ...removableRows.map((rowId) => `${databaseId}${LEGACY_ROW_MARKER}${rowId}`).filter(stored),
      // A row page has no edits a later grant depends on; it goes with its row.
      ...Array.from(rowIds).map((rowId) => metaIdFromRowId(rowId)(RowMetaKey.DocumentId)).filter(stored),
    ];

    for (let index = 0; index < targets.length; index += DATABASE_COPY_DELETE_BATCH) {
      scope.assertCurrent();
      await Promise.all(targets.slice(index, index + DATABASE_COPY_DELETE_BATCH)
        .map((name) => deleteCollabDB(name, { destroyDoc: options.destroyDoc })));
    }

    scope.assertCurrent();
    await db.rows.where('row_key').startsWith(legacyPrefix).filter((row) => !pending.has(row.row_id)).delete();
  } catch (error) {
    Log.warn('[DB] could not remove the row copies of a revoked database', { databaseId, error });
  }

  return databaseDeleted ?? deleteDatabase();
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

/**
 * True while this tab holds, or is still opening, an in-memory copy of the
 * object. Such a copy can rebuild edits that were discarded meanwhile.
 */
export function hasCollabDocInMemory(name: string): boolean {
  return providerCache.has(name) || rowProviderCache.has(name) || pendingOpens.has(name) || pendingRowOpens.has(name);
}

/** The canonical row provider owns the durability result for its live document. */
export function getCachedRowProvider(name: string): SharedIndexeddbPersistence | undefined {
  const entry = rowProviderCache.get(name);

  return entry && !entry.disposed ? entry.provider as SharedIndexeddbPersistence : undefined;
}

function removeLocalStorageKeys(matches: (key: string) => boolean) {
  if (typeof localStorage === 'undefined') return;

  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);

    if (key && matches(key)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

function removeLocalStorageKeysByPrefix(prefix: string) {
  removeLocalStorageKeys((key) => key.startsWith(prefix));
}

function clearDatabaseCheckpointsForDeletedDatabases(results: Array<{ name: string; deleted: boolean }>) {
  if (typeof localStorage === 'undefined') return;

  const sharedCacheDeleted = results.some(({ name, deleted }) => deleted && name === db.name);
  const allDatabasesDeleted = results.every((result) => result.deleted);

  if (sharedCacheDeleted || allDatabasesDeleted) {
    removeLocalStorageKeysByPrefix(DATABASE_BLOB_RID_PREFIX);
    // The synchronous shadow and committed restore markers describe the cache
    // that was just deleted. Reopening must discover and reload its generation.
    // Pending server restore jobs have separate keys and must survive this reset.
    removeLocalStorageKeysByPrefix(DATABASE_CACHE_EPOCH_PREFIX);
    removeLocalStorageKeysByPrefix(DATABASE_RESTORE_MARKER_PREFIX);
    return;
  }

  const deletedDatabaseIds = new Set<string>();
  const blockedDatabaseIds = new Set<string>();

  results.forEach(({ name, deleted }) => {
    const logicalName = serverRestore.logicalCacheKey(name);

    if (!logicalName) return;
    const markerIndex = logicalName.indexOf('_rows_');

    if (markerIndex <= 0) return;
    const databaseId = logicalName.slice(0, markerIndex);

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
      clearDatabaseCheckpointsForDeletedDatabases(results);
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
  SharedIndexeddbPersistence,
  deleteSharedCollabData,
  createCachedProviderEntry,
  clearDatabaseCheckpointsForDeletedDatabases,
  deleteIndexedDBDatabase,
  destroyProviderEntry,
  readSharedCollabRecordsForSync,
  waitForProviderEntry,
};
