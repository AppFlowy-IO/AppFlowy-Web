import 'fake-indexeddb/auto';
import { TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';

import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import {
  captureDatabaseStorageFence,
  closeCollabDB,
  db,
  deleteCollabDB,
  openRowCollabDBWithProvider,
  publishWithDatabaseStorageFence,
  rotateDatabaseStorageFence,
} from '@/application/db';
import { withDatabaseStorageFence } from '@/application/db/database-storage-fence';

jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

beforeAll(() =>
  Object.assign(globalThis, {
    TextEncoder,
    structuredClone: (value: unknown) => deserialize(serialize(value)),
  })
);
afterAll(() => db.close());

it.each([1, 201])('persists %i fenced row updates without inheriting the publisher transaction', async (updates) => {
  const rowId = uuidv4();
  const databaseId = uuidv4();
  const entry = await openRowCollabDBWithProvider(rowId, { awaitSync: true });
  const fence = await captureDatabaseStorageFence(databaseId, { required: true });

  try {
    await expect(
      publishWithDatabaseStorageFence(fence, () => {
        withDatabaseStorageFence(entry.doc, fence, () => {
          for (let index = 0; index < updates; index += 1) entry.doc.getMap('row').set('body', `durable-${index}`);
        });
      })
    ).resolves.toBe(true);
    await expect(entry.provider.whenPersisted()).resolves.toBeUndefined();
    await closeCollabDB(rowId);
    const reopened = await openRowCollabDBWithProvider(rowId, { awaitSync: true });

    expect(reopened.doc.getMap('row').get('body')).toBe(`durable-${updates - 1}`);
    if (updates > 200) expect(await db.collab_snapshots.get(rowId)).toBeDefined();

    // A detached persistence queue still has to reject bytes captured before
    // an authoritative restore replaces the aggregate generation.
    await rotateDatabaseStorageFence(databaseId, uuidv4(), null);
    withDatabaseStorageFence(reopened.doc, fence, () => reopened.doc.getMap('row').set('body', 'stale'));
    await expect(reopened.provider.whenPersisted()).rejects.toThrow('generation changed');
    const persisted = new Y.Doc();
    const snapshot = await db.collab_snapshots.get(rowId);

    if (snapshot) Y.applyUpdate(persisted, snapshot.update);

    for (const update of await db.collab_updates.where('objectId').equals(rowId).toArray()) {
      Y.applyUpdate(persisted, update.update);
    }

    expect(persisted.getMap('row').get('body')).toBe(`durable-${updates - 1}`);
    persisted.destroy();
  } finally {
    await deleteCollabDB(rowId);
    localStorage.removeItem(`af_database_blob_epoch:${databaseId}`);
    await db.collab_custom.where('objectId').equals(`database-blob-epoch:${databaseId}`).delete();
  }
});
