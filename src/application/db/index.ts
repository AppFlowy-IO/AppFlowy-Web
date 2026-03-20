import BaseDexie from 'dexie';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { databasePrefix } from '@/application/constants';
import { rowSchema, rowTable } from '@/application/db/tables/rows';
import { userSchema, UserTable } from '@/application/db/tables/users';
import { versionSchema, VersionsTable } from '@/application/db/tables/versions';
import { viewMetasSchema, ViewMetasTable } from '@/application/db/tables/view_metas';
import {
  workspaceMemberProfileSchema,
  WorkspaceMemberProfileTable,
} from '@/application/db/tables/workspace_member_profiles';
import { YDoc } from '@/application/types';
import { Log } from '@/utils/log';

type DexieTables = ViewMetasTable & UserTable & rowTable & WorkspaceMemberProfileTable & VersionsTable;

export type Dexie<T = DexieTables> = BaseDexie & T;

export const db = new BaseDexie(`${databasePrefix}_cache`) as Dexie;
const _schema = Object.assign({}, { ...viewMetasSchema, ...userSchema, ...rowSchema, ...versionSchema });

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

const openedSet = new Set<string>();
const ensuredStores = new Map<string, Promise<void>>();

const yjsStoreDefinitions = [
  { name: 'updates', options: { autoIncrement: true } },
  { name: 'custom' },
];

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
  provider: IndexeddbPersistence;
  whenSynced: Promise<void>;
}

const providerCache = new Map<string, CachedProviderEntry>();
const pendingOpens = new Map<string, Promise<CachedProviderEntry>>();

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
      await entry.whenSynced;
    }

    return { doc: entry.doc, provider: entry.provider };
  }

  const needsReset = options?.forceReset || options?.expectedVersion;

  if (needsReset) {
    // Evict stale entry so a fresh one is created below
    providerCache.delete(name);
    pendingOpens.delete(name);
  } else {
    // Check providerCache for a resolved entry
    const cached = providerCache.get(name);

    if (cached) {
      if (options?.awaitSync !== false) {
        await cached.whenSynced;
      }

      return { doc: cached.doc, provider: cached.provider };
    }

    // Join an in-flight open for the same name
    const pending = pendingOpens.get(name);

    if (pending) {
      const entry = await pending;

      if (options?.awaitSync !== false) {
        await entry.whenSynced;
      }

      return { doc: entry.doc, provider: entry.provider };
    }
  }

  // Create new entry and cache it
  const promise = _openCollabDBWithProviderInternal(name, options);

  pendingOpens.set(name, promise);

  try {
    const entry = await promise;

    providerCache.set(name, entry);

    // Auto-evict if the doc is destroyed via an external path
    // (e.g., handleAccessChanged, version revert) so subsequent
    // callers don't receive a stale, destroyed Y.Doc.
    entry.doc.on('destroy', () => {
      if (providerCache.get(name) === entry) {
        providerCache.delete(name);
      }
    });

    if (options?.awaitSync !== false) {
      await entry.whenSynced;
    }

    return { doc: entry.doc, provider: entry.provider };
  } finally {
    pendingOpens.delete(name);
  }
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
    await provider.clearData();
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

  const whenSynced = new Promise<void>((resolve) => {
    const handleSync = () => {
      Log.debug('[DB] openCollabDBWithProvider synced', {
        name,
        syncDurationMs: Date.now() - startedAt,
        wasOpened: openedSet.has(name),
      });

      if (!openedSet.has(name)) {
        openedSet.add(name);
      }

      resolve();
    };

    provider.on('synced', handleSync);

    // If provider already synced before listener was attached
    if ((provider as unknown as { synced?: boolean }).synced) {
      handleSync();
    }
  });

  return { doc, provider, whenSynced };
}

export async function closeCollabDB(name: string) {
  if (openedSet.has(name)) {
    openedSet.delete(name);
  }

  const cached = providerCache.get(name);

  providerCache.delete(name);
  pendingOpens.delete(name);

  if (cached) {
    await cached.provider.destroy();
    return;
  }

  // No cached entry — create a temp provider to destroy the IndexedDB store
  const doc = new Y.Doc({
    guid: name,
  });

  const provider = new IndexeddbPersistence(name, doc);

  await provider.destroy();
}

/**
 * Synchronously evict an entry from the provider cache.
 * Used by deleteRow / deleteRowSubDoc after they destroy the Y.Doc themselves.
 */
export function evictProviderCache(name: string) {
  providerCache.delete(name);
  pendingOpens.delete(name);
}

/**
 * Return the cached Y.Doc for a given name, if one exists in the provider cache.
 */
export function getCachedProviderDoc(name: string): YDoc | undefined {
  return providerCache.get(name)?.doc;
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
        localStorage.removeItem(`af_database_blob_rid:${databaseId}`);
      });
    } catch {
      // Ignore localStorage failures (private mode/quota).
    }

    return results.every((result) => result.deleted);
  } catch (error) {
    console.error('Error during database deletion process:', error);
    return false;
  }
}
