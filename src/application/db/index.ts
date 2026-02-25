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
   * Define current user UID. If provided that value will be written into
   * the document data itself and used in the future for associating Yjs document
   * changes with specific users.
   */
  currentUser?: string;
}

/**
 * Open the collaboration database, and return a function to close it
 */
export async function openCollabDB(name: string, options: OpenCollabOptions = {}): Promise<YDoc> {
  // `name` is the canonical collab object id for this local IndexedDB-backed doc.
  // Set Y.Doc guid to the same value so reopen/close/sync paths address the same document identity.
  const doc = new Y.Doc({
    guid: name,
  }) as YDoc;

  await ensureYjsStores(name);

  let provider = new IndexeddbPersistence(name, doc);
  let version = await provider.get(name + '/version');

  if (options.expectedVersion && version !== options.expectedVersion) {
    // version was provided and it differs from the one we persisted
    await provider.clearData();
    provider = new IndexeddbPersistence(name, doc);
    await provider.set(name + '/version', options.expectedVersion);
    version = options.expectedVersion;
  }

  doc.version = version;

  provider.on('synced', () => {
    if (!openedSet.has(name)) {
      openedSet.add(name);
    }
  });

  await provider.whenSynced;

  return doc;
}

export async function openCollabDBWithProvider(
  name: string,
  options?: { awaitSync?: boolean, expectedVersion?: string }
): Promise<{ doc: YDoc; provider: IndexeddbPersistence }> {
  const startedAt = Date.now();

  Log.debug('[DB] openCollabDBWithProvider start', {
    name,
    awaitSync: options?.awaitSync !== false,
    alreadyOpened: openedSet.has(name),
  });

  // Keep guid equal to `name` because provider persistence and sync registration use this object id.
  const doc = new Y.Doc({
    guid: name,
  }) as YDoc;

  await ensureYjsStores(name);

  Log.debug('[DB] openCollabDBWithProvider stores ensured', {
    name,
    ensureDurationMs: Date.now() - startedAt,
  });

  let provider = new IndexeddbPersistence(name, doc);
  let version = await provider.get(name + '/version');

  let resolveSync: (() => void) | null = null;
  const syncPromise = new Promise<void>((resolveFn) => {
    resolveSync = resolveFn;
  });

  if (options?.expectedVersion && version !== options.expectedVersion) {
    // version was provided and it differs from the one we persisted
    await provider.clearData();
    provider = new IndexeddbPersistence(name, doc);
    await provider.set(name + '/version', options.expectedVersion);
    version = options.expectedVersion;
  }

  doc.version = version;

  provider.on('synced', () => {
    Log.debug('[DB] openCollabDBWithProvider synced', {
      name,
      syncDurationMs: Date.now() - startedAt,
      wasOpened: openedSet.has(name),
    });

    if (!openedSet.has(name)) {
      openedSet.add(name);
    }

    if (resolveSync) {
      resolveSync();
      resolveSync = null;
    }
  });

  if (options?.awaitSync !== false) {
    // In most paths this is resolved by the provider 'synced' callback.
    // Keep a fallback for cases where sync already completed before listener work.
    if (!(provider as unknown as { synced?: boolean }).synced) {
      await syncPromise;
    }
  }

  Log.debug('[DB] openCollabDBWithProvider ready', {
    name,
    doc,
    totalDurationMs: Date.now() - startedAt,
    awaitedSync: options?.awaitSync !== false,
  });

  return { doc, provider };
}

export async function closeCollabDB(name: string) {
  if (openedSet.has(name)) {
    openedSet.delete(name);
  }

  // Recreate a doc with the same guid/name to destroy the exact persisted provider instance for that object.
  const doc = new Y.Doc({
    guid: name,
  });

  const provider = new IndexeddbPersistence(name, doc);

  await provider.destroy();
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
