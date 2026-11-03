import 'fake-indexeddb/auto';
import { TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';

import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { captureDatabaseStorageFence, db, publishWithDatabaseStorageFence } from '@/application/db';
import { Types } from '@/application/types';
import { CollabSendWindow } from '@/application/realtime/send-window';

import {
  clearDrainConfig, configureDrain, deleteOutboxByObjectId, enqueueOutboxUpdate,
  purgeAllOutbox, setCurrentSession, waitForDrain, wakeOutboxDrains,
} from '..';

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

it.each([false, true])('retains a backpressured update in IndexedDB and handles discard=%s', async (discard) => {
  const userId = uuidv4();
  const workspaceId = uuidv4();
  const firstId = uuidv4();
  const secondId = uuidv4();
  const sent: string[] = [];
  let firstSent: () => void = () => undefined;
  let secondSent: () => void = () => undefined;
  const firstFrame = new Promise<void>((resolve) => { firstSent = resolve; });
  const secondFrame = new Promise<void>((resolve) => { secondSent = resolve; });
  const window = new CollabSendWindow({
    maxUpdates: 1,
    send: (message) => {
      sent.push(message.collabMessage!.objectId!);
      if (sent.length === 1) firstSent();
      if (sent.length === 2) secondSent();
    },
    onUpdateStalled: () => { throw new Error('unexpected stalled update'); },
    onManifestTimeout: () => { throw new Error('unexpected manifest'); },
  });
  const doc = new Y.Doc();

  doc.getMap('content').set('text', 'retained while the server window is full');
  const payload = Y.encodeStateAsUpdate(doc);

  window.setConnection(true, true);
  setCurrentSession({ userId, workspaceId });
  configureDrain({ userId, workspaceId, isReady: () => true,
    send: (message) => window.send(message, false), canSendObject: (id) => window.canSendUpdate(id) });
  const unsubscribe = window.subscribeReady(wakeOutboxDrains);

  try {
    await enqueueOutboxUpdate({ objectId: firstId, collabType: Types.Document, payload });
    await firstFrame;
    await enqueueOutboxUpdate({ objectId: secondId, collabType: Types.Document, payload });
    const pending = await db.sync_outbox.where('[userId+workspaceId+objectId]')
      .equals([userId, workspaceId, secondId]).toArray();

    expect(pending).toHaveLength(1);
    expect(sent).toEqual([firstId]);
    const restored = new Y.Doc();

    Y.applyUpdate(restored, pending[0].payload);
    expect(restored.getMap('content').get('text')).toBe('retained while the server window is full');
    restored.destroy();
    if (discard) await deleteOutboxByObjectId(secondId);
    window.receive({ objectId: firstId, updateAck: {} });
    if (!discard) {
      await secondFrame;
      window.receive({ objectId: secondId, updateAck: {} });
    }
    await expect(waitForDrain([firstId, secondId])).resolves.toBe(true);
    expect(sent).toEqual(discard ? [firstId] : [firstId, secondId]);
  } finally {
    unsubscribe();
    window.dispose();
    doc.destroy();
  }
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
