import 'fake-indexeddb/auto';
import { TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';

import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { captureDatabaseStorageFence, db, publishWithDatabaseStorageFence } from '@/application/db';
import { Types } from '@/application/types';

import { clearDrainConfig, enqueueOutboxUpdate, purgeAllOutbox, setCurrentSession } from '..';

jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

beforeAll(() =>
  Object.assign(globalThis, {
    TextEncoder,
    structuredClone: (value: unknown) => deserialize(serialize(value)),
  })
);

afterEach(async () => {
  clearDrainConfig();
  await purgeAllOutbox();
  setCurrentSession(null);
});

afterAll(() => db.close());

it.each([
  { name: 'local', source: undefined },
  { name: 'manifest', source: 'manifest' as const },
])('durably enqueues a $name update observed during fenced database publication', async ({ source }) => {
  const userId = uuidv4();
  const workspaceId = uuidv4();
  const databaseId = uuidv4();
  const doc = new Y.Doc({ guid: databaseId });
  const fence = await captureDatabaseStorageFence(databaseId, { required: true });
  let persisted: Promise<boolean> | undefined;

  setCurrentSession({ userId, workspaceId });
  doc.on('update', (payload: Uint8Array) => {
    persisted = enqueueOutboxUpdate({ objectId: databaseId, collabType: Types.Database, payload }, { source });
  });

  try {
    // Row activation publishes the database delta while holding only the
    // collab_custom store. Its Yjs observers must persist in their own scope.
    await expect(publishWithDatabaseStorageFence(fence, () => doc.getMap('rows').set('new-row', true))).resolves.toBe(
      true
    );
    expect(persisted).toBeDefined();
    await expect(persisted).resolves.toBe(true);
    const records = await db.sync_outbox
      .where('[userId+workspaceId+objectId]')
      .equals([userId, workspaceId, databaseId])
      .toArray();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ userId, workspaceId, objectId: databaseId, source });
    const restored = new Y.Doc();

    Y.applyUpdate(restored, records[0].payload);
    expect(restored.getMap('rows').get('new-row')).toBe(true);
    restored.destroy();
  } finally {
    doc.destroy();
  }
});
