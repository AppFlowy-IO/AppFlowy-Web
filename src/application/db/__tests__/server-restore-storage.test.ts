import 'fake-indexeddb/auto';
import { TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';

import Dexie from 'dexie';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { collabIndexedDBExists, db, deleteCollabDB, listCollabIndexedDBNames, openCollabDBWithProvider } from '@/application/db';

jest.mock('@/application/server-restore', () => {
  const { ServerRestoreBoundary } = jest.requireActual('@/application/server-restore');
  const storage = {
    getItem: () => '11111111-1111-4111-8111-111111111111',
    setItem: jest.fn(),
  };

  return { serverRestore: new ServerRestoreBoundary('https://cloud', storage, jest.fn()) };
});
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

beforeAll(() => Object.assign(globalThis, {
  TextEncoder,
  structuredClone: (value: unknown) => deserialize(serialize(value)),
}));
afterAll(() => db.close());

test('the production provider and outbox cannot reopen pre-restore bytes', async () => {
  const objectId = 'document-before-full-restore';
  const oldDoc = new Y.Doc({ guid: objectId });
  const oldProvider = new IndexeddbPersistence(objectId, oldDoc);
  const oldCache = new Dexie('af_database_cache');

  oldCache.version(1).stores({ sync_outbox: '++id, objectId' });
  try {
    await oldProvider.whenSynced;
    oldDoc.getMap('page').set('content', 'newer than the backup');
    // A custom write waits behind the update transaction on the same connection.
    await oldProvider.set('persisted', true);
    await oldCache.table('sync_outbox').add({ objectId, update: Y.encodeStateAsUpdate(oldDoc) });

    expect(await collabIndexedDBExists(objectId)).toBe(false);
    expect(await listCollabIndexedDBNames()).not.toContain(objectId);
    const restored = await openCollabDBWithProvider(objectId);

    expect(restored.doc.getMap('page').get('content')).toBeUndefined();
    expect(await db.sync_outbox.count()).toBe(0);
    restored.doc.getMap('page').set('content', 'content at backup');
    await restored.provider.set('persisted', true);
    expect(await collabIndexedDBExists(objectId)).toBe(true);
    expect(await listCollabIndexedDBNames()).toContain(objectId);

    // Late writes from a tab that has not reloaded remain in the retired cache.
    oldDoc.getMap('page').set('content', 'late stale edit');
    await oldProvider.set('persisted', true);
    expect(restored.doc.getMap('page').get('content')).toBe('content at backup');
    await deleteCollabDB(objectId);
    expect(await collabIndexedDBExists(objectId)).toBe(false);
    expect((await indexedDB.databases()).some(({ name }) => name === objectId)).toBe(true);
  } finally {
    await oldProvider.destroy();
    oldDoc.destroy();
    oldCache.close();
    await deleteCollabDB(objectId);
  }
});
