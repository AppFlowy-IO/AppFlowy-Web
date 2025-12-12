import BaseDexie from 'dexie';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { databasePrefix } from '@/application/constants';
import { Log } from '@/utils/log';
import { rowSchema, rowTable } from '@/application/db/tables/rows';
import { userSchema, UserTable } from '@/application/db/tables/users';
import { versionSchema, VersionsTable } from '@/application/db/tables/versions';
import { viewMetasSchema, ViewMetasTable } from '@/application/db/tables/view_metas';
import {
  workspaceMemberProfileSchema,
  WorkspaceMemberProfileTable,
} from '@/application/db/tables/workspace_member_profiles';
import { VersionedDoc } from '@/application/types';

type DexieTables = ViewMetasTable & UserTable & rowTable & WorkspaceMemberProfileTable & VersionsTable;

export type Dexie<T = DexieTables> = BaseDexie & T;

export const db = new BaseDexie(`${databasePrefix}_cache`) as Dexie;
const schema = Object.assign({}, { ...viewMetasSchema, ...userSchema, ...rowSchema, ...versionSchema });

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
export async function openCollabDB(name: string, options: OpenCollabOptions = {}): Promise<VersionedDoc> {
  const doc = new Y.Doc({
    guid: name,
  });

  let provider = new IndexeddbPersistence(name, doc);
  let version = await provider.get(name + '/version');

  if (options.expectedVersion && version !== options.expectedVersion) {
    // version was provided and it differs from the one we persisted
    await provider.clearData();
    provider = new IndexeddbPersistence(name, doc);
    await provider.set(name + '/version', options.expectedVersion);
  }

  version = options.expectedVersion;

  provider.on('synced', () => {
    if (!openedSet.has(name)) {
      openedSet.add(name);
    }
  });

  await provider.whenSynced;

  return { doc, version };
}

export async function closeCollabDB(name: string) {
  if (openedSet.has(name)) {
    openedSet.delete(name);
  }

  const doc = new Y.Doc({
    guid: name,
  });

  const provider = new IndexeddbPersistence(name, doc);

  await provider.destroy();
}

export async function clearData() {
  const databases = await indexedDB.databases();

  const deleteDatabase = async (dbInfo: IDBDatabaseInfo): Promise<boolean> => {
    const dbName = dbInfo.name;

    if (!dbName) return false;

    return new Promise((resolve) => {
      const request = indexedDB.open(dbName);

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        db.close();

        const deleteRequest = indexedDB.deleteDatabase(dbName);

        deleteRequest.onsuccess = () => {
          Log.debug(`Database ${dbName} deleted successfully`);
          resolve(true);
        };

        deleteRequest.onerror = (event) => {
          console.error(`Error deleting database ${dbName}`, event);
          resolve(false);
        };

        deleteRequest.onblocked = () => {
          console.warn(`Delete operation blocked for database ${dbName}`);
          resolve(false);
        };
      };

      request.onerror = (event) => {
        console.error(`Error opening database ${dbName}`, event);
        resolve(false);
      };
    });
  };

  try {
    const results = await Promise.all(databases.map(deleteDatabase));

    return results.every(Boolean);
  } catch (error) {
    console.error('Error during database deletion process:', error);
    return false;
  }
}
