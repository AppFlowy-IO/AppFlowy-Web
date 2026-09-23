import * as Y from 'yjs';

import { SyncReceiptRecord } from '@/application/db/tables/sync_receipts';
import { Types } from '@/application/types';
import { collab } from '@/proto/messages';
import { getSyncStatus, markSyncReady, setSyncConnected, setSyncParent } from '@/application/sync-status/store';

interface MockSyncOutboxRecord {
  id?: number;
  syncId?: string;
  syncAncestors?: string[];
  userId: string;
  workspaceId: string;
  objectId: string;
  collabType: number;
  version?: string | null;
  payload: Uint8Array;
  createdAt: number;
  beforeStateVector?: Uint8Array;
  source?: 'manifest';
}

let mockRecords: MockSyncOutboxRecord[] = [];
const mockReceipts = new Map<string, SyncReceiptRecord>();
let mockNextId = 1;
let mockTransactionQueue: Promise<unknown> = Promise.resolve();

function mockMatchesIndex(index: string, key: unknown[], record: MockSyncOutboxRecord) {
  if (index === '[userId+workspaceId]') {
    return record.userId === key[0] && record.workspaceId === key[1];
  }

  if (index === '[userId+workspaceId+objectId]') {
    return record.userId === key[0] && record.workspaceId === key[1] && record.objectId === key[2];
  }

  if (index === '[userId+workspaceId+objectId+id]') {
    return record.userId === key[0] && record.workspaceId === key[1] && record.objectId === key[2];
  }

  throw new Error(`Unsupported mock index: ${index}`);
}

const mockSyncOutboxTable = {
  add: jest.fn(async (row: Omit<MockSyncOutboxRecord, 'id'>) => {
    const id = mockNextId++;

    mockRecords.push({ ...row, id });
    return id;
  }),
  bulkPut: jest.fn(async (rows: MockSyncOutboxRecord[]) => {
    rows.forEach((row) => {
      const index = mockRecords.findIndex((record) => record.id === row.id);

      if (index !== -1) mockRecords[index] = { ...row };
    });
  }),
  bulkDelete: jest.fn(async (ids: number[]) => {
    const idsToDelete = new Set(ids);

    mockRecords = mockRecords.filter((record) => !idsToDelete.has(record.id ?? -1));
  }),
  clear: jest.fn(async () => {
    mockRecords = [];
  }),
  where: jest.fn((index: string) => ({
    equals: (key: unknown[]) => ({
      count: async () => mockRecords.filter((record) => mockMatchesIndex(index, key, record)).length,
      delete: async () => {
        mockRecords = mockRecords.filter((record) => !mockMatchesIndex(index, key, record));
      },
      each: async (callback: (record: MockSyncOutboxRecord) => void) => {
        mockRecords.filter((record) => mockMatchesIndex(index, key, record)).forEach(callback);
      },
      sortBy: async (field: keyof MockSyncOutboxRecord) =>
        mockRecords
          .filter((record) => mockMatchesIndex(index, key, record))
          .slice()
          .sort((a, b) => Number(a[field] ?? 0) - Number(b[field] ?? 0)),
    }),
    between: (lower: unknown[], _upper: unknown[], includeLower = true) => ({
      limit: (count: number) => ({
        toArray: async () =>
          mockRecords
            .filter(
              (record) =>
                mockMatchesIndex(index, lower, record) &&
                (typeof lower[3] !== 'number' || (includeLower ? record.id! >= lower[3] : record.id! > lower[3]))
            )
            .slice()
            .sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0))
            .slice(0, count),
      }),
    }),
  })),
};

const mockSyncReceiptTable = {
  bulkDelete: jest.fn(async (ids: string[]) => {
    ids.forEach((id) => mockReceipts.delete(id));
  }),
  bulkGet: jest.fn(async (ids: string[]) =>
    ids.map((id) => {
      const record = mockReceipts.get(id);

      return record && { ...record };
    })
  ),
  bulkPut: jest.fn(async (records: SyncReceiptRecord[]) => {
    records.forEach((record) => mockReceipts.set(record.syncId, { ...record }));
  }),
  clear: jest.fn(async () => {
    mockReceipts.clear();
  }),
  where: jest.fn((index: string) => ({
    anyOf: (keys: string[][]) => ({
      modify: async (callback: (record: SyncReceiptRecord) => void) => {
        expect(index).toBe('[userId+workspaceId+receiptKey]');
        for (const record of mockReceipts.values()) {
          if (
            keys.some(
              ([uid, wid, key]) => uid === record.userId && wid === record.workspaceId && key === record.receiptKey
            )
          ) {
            callback(record);
          }
        }
      },
    }),
    equals: ([uid, wid, oid]: string[]) => ({
      delete: async () => {
        expect(index).toBe('[userId+workspaceId+objectId]');
        for (const record of mockReceipts.values()) {
          if (uid === record.userId && wid === record.workspaceId && oid === record.objectId)
            mockReceipts.delete(record.syncId);
        }
      },
    }),
    between: (lower: number, upper: number) => ({
      delete: async () => {
        expect(index).toBe('savedAt');
        for (const record of mockReceipts.values()) {
          if (record.savedAt >= lower && record.savedAt < upper) mockReceipts.delete(record.syncId);
        }
      },
    }),
  })),
};

const mockTransaction = jest.fn((_mode: string, ...tablesAndCallback: unknown[]) => {
  const callback = tablesAndCallback[tablesAndCallback.length - 1] as () => Promise<unknown>;
  const transaction = mockTransactionQueue.then(callback);

  // IndexedDB serializes read-write transactions that touch the same store.
  mockTransactionQueue = transaction.catch(() => undefined);
  return transaction;
});

jest.mock('@/application/db', () => ({
  db: {
    sync_outbox: mockSyncOutboxTable,
    sync_receipts: mockSyncReceiptTable,
    transaction: mockTransaction,
  },
}));

jest.mock('@/utils/log', () => ({
  Log: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  clearDrainConfig,
  configureDrain,
  deleteOutboxByObjectId,
  enqueueOutboxUpdate,
  getCurrentOutboxSession,
  purgeAllOutbox,
  resumePermissionBlockedSync,
  setCurrentSession,
  shouldRouteUpdateThroughOutbox,
  startDrainAll,
  restartSyncDelivery,
} from '@/application/sync-outbox';

import {
  configureReceiptRecovery,
  discardSyncObject,
  markSyncError,
  markSyncSent,
  receiveSyncReceipt,
  refreshSyncReceipts,
  resetReceiptSession,
  resetSyncDelivery,
  trackSyncRecord,
  wasSyncSent,
} from '@/application/sync-outbox/receipts';

const userId = 'user-1';
const workspaceId = 'workspace-1';
const objectId = '11111111-1111-4111-8111-111111111111';

function makeUpdate(value: string) {
  const doc = new Y.Doc({ guid: objectId });

  doc.getMap('root').set('value', value);
  return Y.encodeStateAsUpdate(doc);
}

async function flushPromises() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe('sync outbox live send', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockRecords = [];
    mockReceipts.clear();
    mockNextId = 1;
    mockTransactionQueue = Promise.resolve();
    clearDrainConfig();
    setCurrentSession({ userId, workspaceId });

    // Most tests model the steady state after the one-time persisted-backlog
    // discovery. Dedicated startup tests reset the session and exercise the
    // barrier itself.
    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => false,
    });
    startDrainAll();
    await flushPromises();
    clearDrainConfig();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await purgeAllOutbox();
    clearDrainConfig();
    setCurrentSession(null);
  });

  function enableReceipts() {
    const send = jest.fn();

    configureDrain({ userId, workspaceId, send, isReady: () => true, trackReceipts: true });
    setSyncConnected(true);
    markSyncReady(objectId);
    return send;
  }

  async function receipt(stage: collab.SyncReceipt.Stage, syncIds: string[], counter = 1, version = '') {
    await receiveSyncReceipt(workspaceId, {
      objectId,
      syncReceipt: {
        stage,
        syncIds,
        version,
        messageIds: [{ timestamp: 42, counter }],
      },
    });
    await flushPromises();
  }

  it('shows synced on acceptance but retains recovery copies until saved, including newer edits', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('first') });
    await flushPromises();
    const first = mockRecords[0].syncId!;

    expect(getSyncStatus(objectId)).toBe('syncing');
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [first]);
    expect(mockRecords).toHaveLength(1);
    expect(getSyncStatus(objectId)).toBe('synced');
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('second') });
    await flushPromises();
    const second = mockRecords[1].syncId!;

    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(mockRecords.map((record) => record.syncId)).toEqual([second]);
    expect(getSyncStatus(objectId)).toBe('syncing');
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [second], 2);
    expect(getSyncStatus(objectId)).toBe('synced');
    expect(mockRecords.map((record) => record.syncId)).toEqual([second]);
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 2);
    expect(mockRecords).toHaveLength(0);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('does not treat a higher saved RID, another object, or another version as evidence', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('value'), version: 'v1' });
    await flushPromises();
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [mockRecords[0].syncId!], 1, 'v1');
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 2, 'v1');
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 1, 'v2');
    await receiveSyncReceipt(workspaceId, {
      objectId: 'another-object',
      syncReceipt: {
        stage: collab.SyncReceipt.Stage.SAVED,
        version: 'v1',
        messageIds: [{ timestamp: 42, counter: 1 }],
      },
    });
    expect(mockRecords).toHaveLength(1);
    expect(getSyncStatus(objectId)).toBe('synced');
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 1, 'v1');
    expect(mockRecords).toHaveLength(0);
  });

  it('handles saved-before-accepted notifications and delete-only edits', async () => {
    enableReceipts();
    const doc = new Y.Doc();

    doc.getText('text').insert(0, 'delete me');
    const before = Y.encodeStateVector(doc);
    let deletion!: Uint8Array;

    doc.on('update', (update) => {
      deletion = update;
    });
    doc.getText('text').delete(0, 9);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: deletion, beforeStateVector: before });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(mockRecords).toHaveLength(1);
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    expect(mockRecords).toHaveLength(0);
  });

  it('advances the indexed cursor past 64 pending receipts without blocking later edits', async () => {
    const send = enableReceipts();

    for (let i = 0; i < 70; i++) {
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate(String(i)) });
      await flushPromises();
    }

    expect(mockRecords).toHaveLength(70);
    const sentIds = new Set(send.mock.calls.flatMap(([message]) => message.collabMessage.update.syncIds));

    expect(sentIds.size).toBe(70);
    expect(send.mock.calls.length).toBeLessThanOrEqual(70);
  });

  it('includes a separately edited row document in its database status', async () => {
    enableReceipts();
    setSyncParent(objectId, 'row');
    setSyncParent('row', 'database');
    markSyncReady('database');
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('row content') });
    await flushPromises();
    expect(mockRecords[0].syncAncestors).toEqual(['row', 'database']);
    expect(getSyncStatus('database')).toBe('syncing');
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [mockRecords[0].syncId!]);
    expect(getSyncStatus('database')).toBe('synced');
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(getSyncStatus('database')).toBe('synced');
  });

  it.each([false, true])('shows synced for an accepted HTTP upload and only retires it when saved=%s', async (saved) => {
    enableReceipts();
    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      trackReceipts: true,
      maxUpdateBytes: 1,
      maxSlowSyncUpdateBytes: 4096,
      slowSync: jest.fn(async () => ({
        outcome: 'confirmed' as const,
        saved,
        messageId: { timestamp: 42, counter: 1 },
      })),
    });
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('large') });
    for (let i = 0; i < 8; i++) await flushPromises();
    expect(getSyncStatus(objectId)).toBe('synced');
    expect(mockRecords).toHaveLength(saved ? 0 : 1);
    if (!saved) await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(mockRecords).toHaveLength(0);
  });

  it('retries retained identities after reconnect without claiming transport delivery is a save', async () => {
    const send = enableReceipts();

    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('retained') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    restartSyncDelivery();
    startDrainAll();
    await flushPromises();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].collabMessage.update.syncIds).toEqual([id]);
    expect(mockRecords).toHaveLength(1);
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(mockRecords).toHaveLength(0);
  });

  it('rehydrates a retained database edit after a page reload', async () => {
    enableReceipts();
    setSyncParent(objectId, 'database');
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('reload') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    clearDrainConfig();
    setCurrentSession(null);
    setCurrentSession({ userId, workspaceId });
    const send = enableReceipts();

    markSyncReady('database');
    startDrainAll();
    await flushPromises();
    expect(send.mock.calls[0][0].collabMessage.update.syncIds).toEqual([id]);
    expect(getSyncStatus('database')).toBe('syncing');
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(getSyncStatus('database')).toBe('synced');
  });

  it('recovers acceptance when a tab joins before the saved notification', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('late tab') });
    await flushPromises();
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [mockRecords[0].syncId!]);
    clearDrainConfig();
    setCurrentSession(null);
    setCurrentSession({ userId, workspaceId });
    configureDrain({ userId, workspaceId, send: jest.fn(), isReady: () => false, trackReceipts: true });
    setSyncConnected(true);
    markSyncReady(objectId);
    startDrainAll();
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(getSyncStatus(objectId)).toBe('synced');
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(mockRecords).toHaveLength(0);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('recovers a missed saved broadcast after another tab retires the payload', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('suspended tab') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    // Simulate the other tab's atomic saved-proof write and outbox deletion.
    mockReceipts.get(id)!.savedAt = Date.now();
    mockRecords = [];
    await refreshSyncReceipts();
    expect(getSyncStatus(objectId)).toBe('synced');
    expect(mockReceipts.get(id)!.savedAt).toBeGreaterThan(0);
  });

  it('does not infer saved state from a missing outbox row without receipt evidence', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('not proven') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    mockRecords = [];
    await refreshSyncReceipts();
    expect(getSyncStatus(objectId)).toBe('synced');
    expect([...mockReceipts.values()][0].savedAt).toBe(0);
    await receipt(collab.SyncReceipt.Stage.RETRY, [id]);
    expect(getSyncStatus(objectId)).toBe('syncing');
  });

  it("preserves another tab's saved proof when a delayed accepted receipt arrives", async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('delayed ack') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    mockReceipts.get(id)!.savedAt = Date.now();
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id], 2);
    expect(getSyncStatus(objectId)).toBe('synced');
    expect(mockReceipts.get(id)!.savedAt).toBeGreaterThan(0);
  });

  it('waits for manifest repair after RETRY and saves the original and repair identities independently', async () => {
    const send = enableReceipts();
    const doc = new Y.Doc({ guid: objectId });

    doc.getText('text').insert(0, 'missing');
    const before = Y.encodeStateVector(doc);

    doc.getText('text').insert(7, ' dependency');
    const dependent = Y.encodeStateAsUpdate(doc, before);
    const server = new Y.Doc();

    Y.applyUpdate(server, dependent);
    expect(server.store.pendingStructs).not.toBeNull();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: dependent, beforeStateVector: before });
    await flushPromises();
    const original = mockRecords[0].syncId!;

    await receipt(collab.SyncReceipt.Stage.RETRY, [original, 'unknown']);
    expect(getSyncStatus(objectId)).toBe('syncing');
    expect(send).toHaveBeenCalledTimes(1); // RETRY must not create a send/reject loop.
    expect(wasSyncSent(mockRecords[0])).toBe(false);

    const repair = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(server));

    await enqueueOutboxUpdate(
      { objectId, collabType: Types.Document, payload: repair },
      { source: 'manifest', broadcast: false }
    );
    for (let i = 0; i < 4; i++) await flushPromises();
    const repairId = mockRecords.find((record) => record.source === 'manifest')!.syncId!;

    Y.applyUpdate(server, repair);
    expect(server.store.pendingStructs).toBeNull();
    expect(server.getText('text').toString()).toBe(doc.getText('text').toString());
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [original], 2);
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [repairId], 3);
    expect(getSyncStatus(objectId)).toBe('synced');
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 3);
    expect(mockRecords.map((record) => record.syncId)).toEqual([original]);
    expect(getSyncStatus(objectId)).toBe('synced');
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 2);
    expect(getSyncStatus(objectId)).toBe('synced');
    doc.destroy();
    server.destroy();
  });

  it('makes a rejected accepted attempt retryable without accepting unrelated identities', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('retry') });
    await flushPromises();
    const record = mockRecords[0];

    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [record.syncId!]);
    await receiveSyncReceipt(workspaceId, {
      objectId: 'other-object',
      syncReceipt: {
        stage: collab.SyncReceipt.Stage.RETRY,
        syncIds: [record.syncId!],
      },
    });
    expect(getSyncStatus(objectId)).toBe('synced');
    await receipt(collab.SyncReceipt.Stage.RETRY, [record.syncId!]);
    expect(getSyncStatus(objectId)).toBe('syncing');
    expect(wasSyncSent(record)).toBe(false);
    expect(mockReceipts.has(record.syncId!)).toBe(false);
    await refreshSyncReceipts();
    expect(getSyncStatus(objectId)).toBe('syncing');
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [record.syncId!], 2);
    expect(getSyncStatus(objectId)).toBe('synced');
    expect(mockRecords).toHaveLength(1);
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 2);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('shows synced through a two-minute snapshot delay without another send or discarding recovery data', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      const send = enableReceipts();

      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('delayed snapshot') });
      await flushPromises();
      const id = mockRecords[0].syncId!;

      expect(getSyncStatus(objectId)).toBe('syncing');
      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
      expect(getSyncStatus(objectId)).toBe('synced');
      expect(mockRecords).toHaveLength(1);
      expect(mockReceipts.get(id)!.savedAt).toBe(0);
      await jest.advanceTimersByTimeAsync(2 * 60_000);
      expect(getSyncStatus(objectId)).toBe('synced');
      expect(send).toHaveBeenCalledTimes(1);
      expect(mockRecords).toHaveLength(1);
      await receipt(collab.SyncReceipt.Stage.SAVED, []);
      expect(mockRecords).toHaveLength(0);
      expect(getSyncStatus(objectId)).toBe('synced');
    } finally {
      configureReceiptRecovery(undefined);
      jest.useRealTimers();
    }
  });

  it('rearms a lost predecessor with its rejected dependent without resending accepted or unrelated edits', async () => {
    const send = enableReceipts();
    const doc = new Y.Doc();

    doc.getText('text').insert(0, 'missing');
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: Y.encodeStateAsUpdate(doc) });
    await flushPromises();
    const predecessor = mockRecords[0];
    const before = Y.encodeStateVector(doc);

    doc.getText('text').insert(7, ' dependent');
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: Y.encodeStateAsUpdate(doc, before) });
    await flushPromises();
    const dependent = mockRecords[1];

    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('accepted') });
    await flushPromises();
    const accepted = mockRecords[2];

    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [accepted.syncId!]);
    await enqueueOutboxUpdate({ objectId: 'another-object', collabType: Types.Document, payload: makeUpdate('unrelated') });
    await flushPromises();
    const unrelated = mockRecords[3];
    const sends = send.mock.calls.length;

    await receipt(collab.SyncReceipt.Stage.RETRY, [dependent.syncId!]);
    expect(send).toHaveBeenCalledTimes(sends);
    expect(wasSyncSent(predecessor)).toBe(false);
    expect(wasSyncSent(dependent)).toBe(false);
    expect(wasSyncSent(accepted)).toBe(true);
    expect(wasSyncSent(unrelated)).toBe(true);

    await enqueueOutboxUpdate(
      { objectId, collabType: Types.Document, payload: Y.encodeStateAsUpdate(doc) },
      { source: 'manifest', broadcast: false }
    );
    for (let i = 0; i < 4; i++) await flushPromises();
    const repairedIds = send.mock.calls.slice(sends).flatMap(([message]) => message.collabMessage.update.syncIds);

    expect(repairedIds).toContain(predecessor.syncId);
    expect(repairedIds).toContain(dependent.syncId);
    expect(repairedIds).not.toContain(accepted.syncId);
    expect(repairedIds).not.toContain(unrelated.syncId);
  });

  it('retries a lost acceptance after five seconds while leaving accepted snapshot work alone', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      const send = enableReceipts();

      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('accepted') });
      await flushPromises();
      const accepted = mockRecords[0].syncId!;

      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [accepted]);
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('lost ack') });
      await flushPromises();
      const lost = mockRecords[1].syncId!;
      const sends = send.mock.calls.length;

      await jest.advanceTimersByTimeAsync(4_999);
      expect(send).toHaveBeenCalledTimes(sends);
      await jest.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(sends + 1);
      expect(send.mock.calls.at(-1)![0].collabMessage.update.syncIds).toEqual([lost]);
      expect(getSyncStatus(objectId)).toBe('syncing');
      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [lost], 2);
      await jest.advanceTimersByTimeAsync(2 * 60_000);
      expect(send).toHaveBeenCalledTimes(sends + 1);
      expect(getSyncStatus(objectId)).toBe('synced');
      expect(mockRecords).toHaveLength(2);
    } finally {
      configureReceiptRecovery(undefined);
      jest.useRealTimers();
    }
  });

  it('backs off missing acceptance retries to thirty seconds and cancels on acknowledgement', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      enableReceipts();
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('lost ack') });
      await flushPromises();
      const id = mockRecords[0].syncId!;
      const retry = jest.fn(() => markSyncSent([id]));

      configureReceiptRecovery(retry);
      for (const delay of [5, 10, 20, 30, 30]) {
        const calls = retry.mock.calls.length;

        await jest.advanceTimersByTimeAsync(delay * 1_000 - 1);
        expect(retry).toHaveBeenCalledTimes(calls);
        await jest.advanceTimersByTimeAsync(1);
        expect(retry).toHaveBeenCalledTimes(calls + 1);
        expect(retry).toHaveBeenLastCalledWith(objectId);
      }

      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(retry).toHaveBeenCalledTimes(5);
    } finally {
      configureReceiptRecovery(undefined);
      jest.useRealTimers();
    }
  });

  it('recovers a sibling tab acceptance before retrying a missing ACK', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      const send = enableReceipts();

      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('sibling ack') });
      await flushPromises();
      const id = mockRecords[0].syncId!;

      mockReceipts.set(id, {
        syncId: id, userId, workspaceId, objectId, receiptKey: `${objectId}\u0000\u000042-1`, savedAt: 0,
      });
      await jest.advanceTimersByTimeAsync(5_000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(getSyncStatus(objectId)).toBe('synced');
      expect(mockRecords).toHaveLength(1);
    } finally {
      configureReceiptRecovery(undefined);
      jest.useRealTimers();
    }
  });

  it.each(['session', 'disconnect', 'owner'] as const)(
    'fences an acceptance timeout already reading IndexedDB after a %s change',
    async (change) => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        enableReceipts();
        await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('stale retry') });
        await flushPromises();
        const deferred = createDeferred<Array<SyncReceiptRecord | undefined>>();
        const retry = jest.fn();

        configureReceiptRecovery(retry);
        mockSyncReceiptTable.bulkGet.mockImplementationOnce(() => deferred.promise);
        await jest.advanceTimersByTimeAsync(5_000);
        if (change === 'session') setCurrentSession({ userId, workspaceId: 'new-workspace' });
        else if (change === 'disconnect') resetSyncDelivery();
        else configureReceiptRecovery(undefined);
        deferred.resolve([]);
        await flushPromises();
        expect(retry).not.toHaveBeenCalled();
      } finally {
        configureReceiptRecovery(undefined);
        jest.useRealTimers();
      }
    }
  );

  it('does not retry a new edit early when an older acceptance lookup is still pending', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      const send = enableReceipts();

      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('old') });
      await flushPromises();
      const first = mockRecords[0].syncId!;
      const deferred = createDeferred<Array<SyncReceiptRecord | undefined>>();

      mockSyncReceiptTable.bulkGet.mockImplementationOnce(() => deferred.promise);
      await jest.advanceTimersByTimeAsync(5_000);
      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [first]);
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('new') });
      await flushPromises();
      const second = mockRecords[1].syncId!;
      const sends = send.mock.calls.length;

      deferred.resolve([]);
      await flushPromises();
      expect(send).toHaveBeenCalledTimes(sends);
      await jest.advanceTimersByTimeAsync(4_999);
      expect(send).toHaveBeenCalledTimes(sends);
      await jest.advanceTimersByTimeAsync(1);
      expect(send.mock.calls.at(-1)![0].collabMessage.update.syncIds).toEqual([second]);
    } finally {
      configureReceiptRecovery(undefined);
      jest.useRealTimers();
    }
  });

  it('keeps a live rejection unsynced when deleting cached acceptance fails', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('retry cache failure') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    mockSyncReceiptTable.bulkDelete.mockRejectedValueOnce(new Error('database unavailable'));
    await receipt(collab.SyncReceipt.Stage.RETRY, [id]);
    await refreshSyncReceipts();
    expect(getSyncStatus(objectId)).toBe('syncing');
    expect(mockRecords).toHaveLength(1);
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id], 2);
    expect(getSyncStatus(objectId)).toBe('synced');
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 2);
    expect(mockRecords).toHaveLength(0);
  });

  it.each(['savedAt', 'userId', 'workspaceId', 'syncId', 'receiptKey'] as const)(
    'does not remove saved, foreign, or newer receipt metadata when retry cleanup finds different %s',
    async (field) => {
      enableReceipts();
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('scoped retry') });
      await flushPromises();
      const id = mockRecords[0].syncId!;

      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
      const record = mockReceipts.get(id)!;

      mockSyncReceiptTable.bulkGet.mockResolvedValueOnce([
        { ...record, [field]: field === 'savedAt' ? Date.now() : 'newer-or-foreign' },
      ]);
      await receipt(collab.SyncReceipt.Stage.RETRY, [id]);
      expect(mockReceipts.has(id)).toBe(true);
      expect(getSyncStatus(objectId)).toBe('syncing');
    }
  );

  it('does not restore an old acceptance when its metadata write finishes after RETRY', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('delayed acceptance') });
    await flushPromises();
    const id = mockRecords[0].syncId!;
    const write = createDeferred<void>();

    mockSyncReceiptTable.bulkPut.mockImplementationOnce(async (records) => {
      await write.promise;
      records.forEach((record) => mockReceipts.set(record.syncId, { ...record }));
    });
    const accepted = receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);

    await flushPromises();
    expect(getSyncStatus(objectId)).toBe('synced');
    const rejected = receipt(collab.SyncReceipt.Stage.RETRY, [id]);

    expect(getSyncStatus(objectId)).toBe('syncing');
    write.resolve();
    await Promise.all([accepted, rejected]);
    expect(mockReceipts.has(id)).toBe(false);
    expect(getSyncStatus(objectId)).toBe('syncing');
  });

  it('retries missing receipts with bounded backoff and stops when saved', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      enableReceipts();
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('lost receipt') });
      await flushPromises();
      const record = mockRecords[0];
      const retry = jest.fn();

      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [record.syncId!]);
      configureReceiptRecovery(retry);
      for (const delay of [5, 10, 20, 30, 30]) {
        await jest.advanceTimersByTimeAsync(delay * 60_000 - 1);
        const calls = retry.mock.calls.length;

        await jest.advanceTimersByTimeAsync(1);
        expect(retry).toHaveBeenCalledTimes(calls + 1);
        expect(wasSyncSent(record)).toBe(false);
        expect(getSyncStatus(objectId)).toBe('synced');
        markSyncSent([record.syncId!]);
      }

      await receipt(collab.SyncReceipt.Stage.SAVED, []);
      await jest.advanceTimersByTimeAsync(60 * 60_000);
      expect(retry).toHaveBeenCalledTimes(5);
      expect(getSyncStatus(objectId)).toBe('synced');
    } finally {
      configureReceiptRecovery(undefined);
      jest.useRealTimers();
    }
  });

  it('recovers a missed cross-tab saved receipt before retrying its payload', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      enableReceipts();
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('saved in sibling') });
      await flushPromises();
      const id = mockRecords[0].syncId!;
      const retry = jest.fn();

      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
      mockReceipts.get(id)!.savedAt = Date.now();
      configureReceiptRecovery(retry);
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(retry).not.toHaveBeenCalled();
      expect(mockRecords).toHaveLength(0);
      expect(getSyncStatus(objectId)).toBe('synced');
    } finally {
      configureReceiptRecovery(undefined);
      jest.useRealTimers();
    }
  });

  it('retains live confirmation when the acceptance metadata write fails', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('quota') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    mockSyncReceiptTable.bulkPut.mockRejectedValueOnce(new Error('quota exceeded'));
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    expect(getSyncStatus(objectId)).toBe('synced');
    expect(mockRecords).toHaveLength(1);
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('retains live confirmation when the indexed saved-proof lookup fails', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('lookup unavailable') });
    await flushPromises();
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [mockRecords[0].syncId!]);
    mockSyncReceiptTable.where.mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('retains the payload when atomic saved cleanup fails and recovers it later', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('cleanup unavailable') });
    await flushPromises();
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [mockRecords[0].syncId!]);
    mockSyncOutboxTable.bulkDelete.mockRejectedValueOnce(new Error('transaction aborted'));
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(mockRecords).toHaveLength(1);
    expect(getSyncStatus(objectId)).toBe('synced');
    await refreshSyncReceipts();
    expect(mockRecords).toHaveLength(0);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('keeps pending edits when shared receipt recovery fails', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('read failed') });
    await flushPromises();
    mockSyncReceiptTable.bulkGet.mockRejectedValueOnce(new Error('database unavailable'));
    await refreshSyncReceipts();
    expect(mockRecords).toHaveLength(1);
    expect(getSyncStatus(objectId)).toBe('syncing');
  });

  it('shows a failed local enqueue until its best-effort upload receives actual saved evidence', async () => {
    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      sendBestEffort: jest.fn(),
      isReady: () => true,
      trackReceipts: true,
    });
    setSyncConnected(true);
    const record = {
      userId,
      workspaceId,
      objectId,
      collabType: Types.Document,
      payload: makeUpdate('not durable'),
      createdAt: Date.now(),
      syncId: 'failed-enqueue',
    };

    trackSyncRecord(record);
    markSyncError('unknown');
    markSyncError(record.syncId);
    markSyncError(record.syncId);
    expect(getSyncStatus(objectId)).toBe('error');
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [record.syncId]);
    expect(getSyncStatus(objectId)).toBe('error');
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('handles save evidence before an enqueue settles or fails', async () => {
    enableReceipts();
    const record = {
      userId,
      workspaceId,
      objectId,
      collabType: Types.Document,
      payload: makeUpdate('race'),
      createdAt: Date.now(),
      syncId: 'enqueue-race',
    };

    trackSyncRecord(record);
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [record.syncId]);
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(getSyncStatus(objectId)).toBe('synced');
    markSyncError(record.syncId);
    await flushPromises();
    expect(getSyncStatus(objectId)).toBe('synced');
    expect(wasSyncSent(record)).toBe(true);
    trackSyncRecord(record); // A stale IndexedDB discovery must not resurrect a settled edit.
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('ignores foreign, missing, unsupported, and version-mismatched receipt identities', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('scoped'), version: 'v1' });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    await receiveSyncReceipt('another-workspace', { objectId, syncReceipt: {} });
    await receiveSyncReceipt(workspaceId, { syncReceipt: {} });
    await receiveSyncReceipt(workspaceId, { objectId });
    await receiveSyncReceipt(workspaceId, { objectId, syncReceipt: { stage: 99 } });
    await receiveSyncReceipt(workspaceId, { objectId, syncReceipt: { stage: collab.SyncReceipt.Stage.ACCEPTED } });
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id, 'unknown'], 1, 'v2');
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 1, 'v1');
    expect(mockRecords).toHaveLength(1);
    expect(getSyncStatus(objectId)).toBe('syncing');
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id], 1, 'v1');
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('keeps uint64 RIDs exact above JavaScript integer precision', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('exact rid') });
    await flushPromises();
    const id = mockRecords[0].syncId!;
    const actual = collab.Rid.fromObject({ timestamp: '9007199254740993', counter: 1 });
    const rounded = collab.Rid.fromObject({ timestamp: '9007199254740992', counter: 1 });

    await receiveSyncReceipt(workspaceId, {
      objectId,
      syncReceipt: { stage: collab.SyncReceipt.Stage.ACCEPTED, syncIds: [id], messageIds: [actual] },
    });
    await receiveSyncReceipt(workspaceId, {
      objectId,
      syncReceipt: { stage: collab.SyncReceipt.Stage.SAVED, messageIds: [rounded] },
    });
    expect(mockRecords).toHaveLength(1);
    await receiveSyncReceipt(workspaceId, {
      objectId,
      syncReceipt: { stage: collab.SyncReceipt.Stage.SAVED, messageIds: [actual] },
    });
    expect(mockRecords).toHaveLength(0);
  });

  it('bounds retries per identity without losing confirmation for the current attempt', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('many retries') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    for (let counter = 1; counter <= 10; counter++) await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id], counter);
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 1);
    expect(mockRecords).toHaveLength(1);
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 10);
    expect(mockRecords).toHaveLength(0);
  });

  it('bounds early receipt caching and safely replays an evicted confirmation', async () => {
    enableReceipts();
    for (let counter = 0; counter < 514; counter++) await receipt(collab.SyncReceipt.Stage.SAVED, [], counter);
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('evicted hint') });
    await flushPromises();
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [mockRecords[0].syncId!], 0);
    expect(mockRecords).toHaveLength(1);
    await receipt(collab.SyncReceipt.Stage.SAVED, [], 0);
    expect(mockRecords).toHaveLength(0);
  });

  it('discards only the specified object and ignores records outside the current session', async () => {
    enableReceipts();
    const record = {
      userId,
      workspaceId,
      objectId,
      collabType: Types.Document,
      payload: makeUpdate('discard'),
      createdAt: Date.now(),
      syncId: 'discarded',
    };

    trackSyncRecord({ ...record, syncId: undefined });
    trackSyncRecord({ ...record, userId: 'another-user' });
    expect(getSyncStatus(objectId)).toBe('synced');
    trackSyncRecord(record);
    trackSyncRecord({ ...record, syncId: 'other', objectId: 'other-object' });
    discardSyncObject('missing');
    discardSyncObject(objectId);
    expect(getSyncStatus(objectId)).toBe('synced');
    expect(getSyncStatus('other-object')).toBe('syncing');
    discardSyncObject(objectId);
    resetReceiptSession(`${userId}\u0000${workspaceId}`);
    expect(getSyncStatus('other-object')).toBe('syncing');
  });

  it('settles saved evidence when a delayed durable enqueue finally receives its ID', async () => {
    enableReceipts();
    const record = {
      userId,
      workspaceId,
      objectId,
      collabType: Types.Document,
      payload: makeUpdate('late ID'),
      createdAt: Date.now(),
      syncId: 'late-id',
    };

    trackSyncRecord(record);
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [record.syncId]);
    await receipt(collab.SyncReceipt.Stage.SAVED, []);
    expect(getSyncStatus(objectId)).toBe('synced');
    mockRecords.push({ ...record, id: 100 });
    trackSyncRecord({ ...record, id: 100 });
    await flushPromises();
    expect(mockRecords).toHaveLength(0);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('bounds settled-identity bookkeeping during long editing sessions', () => {
    enableReceipts();
    const base = {
      userId,
      workspaceId,
      objectId,
      collabType: Types.Document,
      payload: new Uint8Array(),
      createdAt: Date.now(),
    };

    for (let index = 0; index < 8193; index++) {
      trackSyncRecord({ ...base, syncId: String(index) });
      discardSyncObject(objectId);
    }

    expect(wasSyncSent({ ...base, syncId: '0' })).toBe(false);
    expect(wasSyncSent({ ...base, syncId: '8192' })).toBe(true);
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('ignores empty receipt lists and handles protobuf default RID fields consistently', async () => {
    enableReceipts();
    await receiveSyncReceipt(workspaceId, { objectId, syncReceipt: { stage: collab.SyncReceipt.Stage.SAVED } });
    await receiveSyncReceipt(workspaceId, { objectId, syncReceipt: { stage: collab.SyncReceipt.Stage.RETRY } });
    await receiveSyncReceipt(workspaceId, {
      objectId,
      syncReceipt: { stage: collab.SyncReceipt.Stage.ACCEPTED, messageIds: [{}] },
    });
    await receiveSyncReceipt(workspaceId, {
      objectId,
      syncReceipt: { stage: collab.SyncReceipt.Stage.SAVED, messageIds: [{}] },
    });
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it.each(['userId', 'workspaceId', 'objectId', 'version'] as const)(
    'rejects persisted receipt metadata with a mismatched %s',
    async (field) => {
      enableReceipts();
      await enqueueOutboxUpdate({
        objectId,
        collabType: Types.Document,
        payload: makeUpdate('bad metadata'),
        version: 'v1',
      });
      await flushPromises();
      const id = mockRecords[0].syncId!;

      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id], 1, 'v1');
      mockReceipts.set(id, { ...mockReceipts.get(id)!, [field]: 'foreign', savedAt: Date.now() });
      await refreshSyncReceipts();
      expect(mockRecords).toHaveLength(1);
      expect(getSyncStatus(objectId)).toBe('synced');
    }
  );

  it('does not resurrect a pending identity discarded during its receipt lookup', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('discard during lookup') });
    await flushPromises();
    const id = mockRecords[0].syncId!;

    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
    const stored = { ...mockReceipts.get(id)!, savedAt: Date.now() };
    const deferred = createDeferred<Array<SyncReceiptRecord | undefined>>();

    mockSyncReceiptTable.bulkGet.mockImplementationOnce(() => deferred.promise);
    const refreshing = refreshSyncReceipts();

    discardSyncObject(objectId);
    deferred.resolve([stored]);
    await refreshing;
    expect(getSyncStatus(objectId)).toBe('synced');
  });

  it('does not apply receipt recovery or retry callbacks to a replacement session', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      enableReceipts();
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('workspace switch') });
      await flushPromises();
      const id = mockRecords[0].syncId!;

      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
      const deferred = createDeferred<Array<SyncReceiptRecord | undefined>>();
      const retry = jest.fn();

      mockSyncReceiptTable.bulkGet.mockImplementationOnce(() => deferred.promise);
      configureReceiptRecovery(retry);
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      setCurrentSession({ userId, workspaceId: 'new-workspace' });
      deferred.resolve([{ ...mockReceipts.get(id)!, savedAt: Date.now() }]);
      await flushPromises();
      expect(retry).not.toHaveBeenCalled();
      expect(mockRecords).toHaveLength(1);
      expect(getSyncStatus(objectId)).toBe('checking');
    } finally {
      configureReceiptRecovery(undefined);
      jest.useRealTimers();
    }
  });

  it.each(['session', 'discard'] as const)(
    'does not change live counters after %s during saved cleanup',
    async (change) => {
      enableReceipts();
      await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('cleanup race') });
      await flushPromises();
      const id = mockRecords[0].syncId!;

      await receipt(collab.SyncReceipt.Stage.ACCEPTED, [id]);
      const deleting = createDeferred<void>();

      mockSyncOutboxTable.bulkDelete.mockImplementationOnce(() => deleting.promise);
      const saving = receipt(collab.SyncReceipt.Stage.SAVED, []);

      await flushPromises();
      expect(mockSyncOutboxTable.bulkDelete).toHaveBeenCalled();
      if (change === 'session') setCurrentSession({ userId, workspaceId: 'new-workspace' });
      else discardSyncObject(objectId);
      deleting.resolve();
      await saving;
      expect(getSyncStatus(objectId)).toBe(change === 'session' ? 'checking' : 'synced');
    }
  );

  it('keeps a saved notification scoped when its IndexedDB transaction spans a session change', async () => {
    enableReceipts();
    await enqueueOutboxUpdate({ objectId, collabType: Types.Document, payload: makeUpdate('saved during switch') });
    await flushPromises();
    await receipt(collab.SyncReceipt.Stage.ACCEPTED, [mockRecords[0].syncId!]);
    const deferred = createDeferred<unknown>();

    mockTransaction.mockImplementationOnce(() => deferred.promise);
    const saving = receipt(collab.SyncReceipt.Stage.SAVED, []);

    setCurrentSession({ userId, workspaceId: 'new-workspace' });
    deferred.resolve(undefined);
    await saving;
    expect(mockRecords).toHaveLength(1);
    expect(getSyncStatus(objectId)).toBe('checking');
  });

  it('sends immediately when the transport is ready and removes the durable copy after enqueue lands', async () => {
    const send = jest.fn();

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => true,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('draft'),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(1);

    await flushPromises();

    expect(send).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(0);
  });

  it('notifies the socket owner only after the outbox row is durable', async () => {
    const onPersisted = jest.fn();

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => false,
      onPersisted,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('draft'),
    });

    expect(onPersisted).not.toHaveBeenCalled();

    await flushPromises();

    expect(onPersisted).toHaveBeenCalledWith(workspaceId, objectId);
    expect(mockRecords).toHaveLength(1);
  });

  it('atomically replaces older manifests without removing local edit records', async () => {
    const firstManifest = makeUpdate('first manifest');
    const localEdit = makeUpdate('local edit');
    const latestManifest = makeUpdate('latest manifest');

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => false,
    });

    const [firstPersisted, localPersisted, latestPersisted] = await Promise.all([
      enqueueOutboxUpdate(
        {
          objectId,
          collabType: Types.Database,
          version: null,
          payload: firstManifest,
        },
        { broadcast: false, source: 'manifest' }
      ),
      enqueueOutboxUpdate({
        objectId,
        collabType: Types.Database,
        version: null,
        payload: localEdit,
      }),
      enqueueOutboxUpdate(
        {
          objectId,
          collabType: Types.Database,
          version: null,
          payload: latestManifest,
        },
        { broadcast: false, source: 'manifest' }
      ),
    ]);

    await flushPromises();

    expect([firstPersisted, localPersisted, latestPersisted]).toEqual([true, true, true]);
    expect(mockRecords).toHaveLength(2);
    expect(mockRecords.filter((record) => record.source === 'manifest')).toEqual([
      expect.objectContaining({ payload: latestManifest }),
    ]);
    expect(mockRecords.filter((record) => record.source === undefined)).toEqual([
      expect.objectContaining({ payload: localEdit }),
    ]);
  });

  it('drains queued records when startDrainAll runs after the transport becomes ready', async () => {
    let ready = false;
    const send = jest.fn();

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => ready,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('draft'),
    });

    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(mockRecords).toHaveLength(1);

    ready = true;
    startDrainAll();
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(0);
  });

  it('uses the queued row when the immediate send fails', async () => {
    const send = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('transient send failure');
      })
      .mockImplementation(() => undefined);

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => true,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('draft'),
    });

    await flushPromises();

    expect(send).toHaveBeenCalledTimes(2);
    expect(mockRecords).toHaveLength(0);
  });

  it('attaches the before state vector to an immediately sent update (and no after)', async () => {
    const send = jest.fn();

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => true,
    });

    const beforeStateVector = new Uint8Array([1, 2, 3]);

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('draft'),
      beforeStateVector,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const update = send.mock.calls[0][0].collabMessage.update;

    expect(update.beforeStateVector).toBe(beforeStateVector);
    expect(update.afterStateVector).toBeUndefined();
  });

  it('takes the merged drain before vector from the first record (and sends no after)', async () => {
    let ready = false;
    const send = jest.fn();

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => ready,
    });

    const firstBefore = new Uint8Array([10]);
    const lastBefore = new Uint8Array([20]);

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('old'),
      beforeStateVector: firstBefore,
    });
    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('new'),
      beforeStateVector: lastBefore,
    });
    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(mockRecords).toHaveLength(2);

    ready = true;
    startDrainAll();
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(1);
    const update = send.mock.calls[0][0].collabMessage.update;

    // Merged payload covers first->last, so before = the first record's before.
    expect(update.beforeStateVector).toBe(firstBefore);
    expect(update.afterStateVector).toBeUndefined();
    expect(mockRecords).toHaveLength(0);
  });

  it('live sends the current update and drains older queued records', async () => {
    let ready = false;
    const send = jest.fn();

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => ready,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('old'),
    });
    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(mockRecords).toHaveLength(1);

    ready = true;

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('new'),
    });

    expect(send).toHaveBeenCalledTimes(1);

    await flushPromises();

    expect(send).toHaveBeenCalledTimes(2);
    expect(mockRecords).toHaveLength(0);
  });

  it('keeps an individually oversized update off WebSocket and retires it only after slow-sync success', async () => {
    const send = jest.fn();
    const slowSync = jest.fn().mockResolvedValue({
      outcome: 'confirmed',
      messageId: { timestamp: 1, counter: 0 },
    });
    const payload = makeUpdate('oversized');

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => true,
      maxUpdateBytes: payload.byteLength - 1,
      maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
      slowSync,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: 'version-1',
      payload,
    });

    expect(send).not.toHaveBeenCalled();
    expect(mockRecords).toHaveLength(1);

    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(slowSync).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId,
        collabType: Types.Document,
        version: 'version-1',
        docState: payload,
        stateVector: expect.any(Uint8Array),
      }),
      expect.any(AbortSignal)
    );
    expect(mockRecords).toHaveLength(0);
  });

  it('budgets the advertised slow limit against doc_state without charging the state vector twice', async () => {
    const payload = makeUpdate('exact slow limit');
    const slowSync = jest.fn().mockResolvedValue({
      outcome: 'confirmed',
      messageId: { timestamp: 1, counter: 0 },
    });

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      maxUpdateBytes: payload.byteLength - 1,
      maxSlowSyncUpdateBytes: payload.byteLength,
      slowSync,
    });
    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload,
    });
    await flushPromises();

    expect(slowSync).toHaveBeenCalledTimes(1);
    expect(slowSync.mock.calls[0][0].docState.byteLength).toBe(payload.byteLength);
    expect(slowSync.mock.calls[0][0].stateVector.byteLength).toBeGreaterThan(0);
    expect(mockRecords).toHaveLength(0);
  });

  it('holds a fresh edit behind a persisted oversized predecessor during startup discovery', async () => {
    const persisted = makeUpdate('x'.repeat(512));
    const fresh = makeUpdate('fresh');
    const persistedStateVector = Y.encodeStateVector(Y.parseUpdateMeta(persisted).to);
    const events: string[] = [];
    const send = jest.fn(() => {
      events.push('send');
    });
    const slowSync = jest.fn(async () => {
      events.push('slow');
      return {
        outcome: 'confirmed' as const,
        messageId: { timestamp: 1, counter: 0 },
      };
    });

    clearDrainConfig();
    setCurrentSession(null);
    mockRecords = [
      {
        id: 1,
        userId,
        workspaceId,
        objectId,
        collabType: Types.Document,
        version: null,
        payload: persisted,
        createdAt: 1,
      },
    ];
    mockNextId = 2;
    setCurrentSession({ userId, workspaceId });
    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => true,
      maxUpdateBytes: persisted.byteLength - 1,
      // Both records can share one ordered slow-sync prefix. The key invariant
      // is that the fresh edit cannot take the immediate WebSocket path first.
      maxSlowSyncUpdateBytes: Y.mergeUpdates([persisted, fresh]).byteLength + persistedStateVector.byteLength + 1_024,
      slowSync,
    });

    startDrainAll();
    expect(shouldRouteUpdateThroughOutbox(fresh.byteLength)).toBe(true);
    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: fresh,
    });

    expect(send).not.toHaveBeenCalled();
    expect(slowSync).not.toHaveBeenCalled();

    await flushPromises();

    expect(events).toEqual(['slow']);
    expect(slowSync.mock.calls[0][0].docState).toEqual(Y.mergeUpdates([persisted, fresh]));
    expect(shouldRouteUpdateThroughOutbox(fresh.byteLength)).toBe(false);
    expect(mockRecords).toHaveLength(0);
  });

  it('uses the safe realtime fallback while server-info is unresolved', async () => {
    const send = jest.fn();
    const payload = makeUpdate('limits are loading');

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => true,
      syncLimitsLoaded: false,
    });

    expect(shouldRouteUpdateThroughOutbox(payload.byteLength)).toBe(false);

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Database,
      version: null,
      payload,
    });
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(0);

    expect(shouldRouteUpdateThroughOutbox(4 * 1024 * 1024 + 1)).toBe(true);
  });

  it('drains a persisted small update while server-info is unresolved', async () => {
    let ready = false;
    const send = jest.fn();
    const payload = makeUpdate('persisted while limits load');

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => ready,
      syncLimitsLoaded: false,
    });
    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Database,
      version: null,
      payload,
    });
    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(mockRecords).toHaveLength(1);

    ready = true;
    startDrainAll();
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(0);
  });

  it('uses the safe 4 MiB realtime limit when an older server omits the optional limit', () => {
    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      syncLimitsLoaded: true,
    });

    expect(shouldRouteUpdateThroughOutbox(4 * 1024 * 1024 + 1)).toBe(true);
  });

  it('honours an explicitly advertised zero realtime limit as unlimited', () => {
    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      maxUpdateBytes: 0,
    });

    expect(shouldRouteUpdateThroughOutbox(8 * 1024 * 1024)).toBe(false);
  });

  it('keeps an oversized update pending when the server does not advertise a slow lane', async () => {
    const send = jest.fn();
    const slowSync = jest.fn();
    const payload = makeUpdate('oversized');

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => true,
      maxUpdateBytes: payload.byteLength - 1,
      slowSync,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload,
    });
    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(slowSync).not.toHaveBeenCalled();
    expect(mockRecords).toHaveLength(1);
  });

  it('drains a merged oversized backlog in realtime prefixes when each atomic record fits', async () => {
    let ready = false;
    const send = jest.fn();
    const slowSync = jest.fn();
    const first = makeUpdate('first');
    const second = makeUpdate('second');
    const merged = Y.mergeUpdates([first, second]);
    const maxIndividualBytes = Math.max(first.byteLength, second.byteLength);

    expect(merged.byteLength).toBeGreaterThan(maxIndividualBytes);

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => ready,
      maxUpdateBytes: maxIndividualBytes,
      maxSlowSyncUpdateBytes: merged.byteLength + 1_024,
      slowSync,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: first,
    });
    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: second,
    });
    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(slowSync).not.toHaveBeenCalled();
    expect(mockRecords).toHaveLength(2);

    ready = true;
    startDrainAll();
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(2);
    expect(slowSync).not.toHaveBeenCalled();
    expect(mockRecords).toHaveLength(0);
  });

  it('deletes only the exact records acknowledged by an in-flight slow-sync', async () => {
    let resolveFirst!: (result: { outcome: 'confirmed'; messageId: { timestamp: number; counter: number } }) => void;
    const firstResult = new Promise<{
      outcome: 'confirmed';
      messageId: { timestamp: number; counter: number };
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const slowSync = jest
      .fn()
      .mockImplementationOnce(() => firstResult)
      .mockRejectedValueOnce(new Error('second request stays pending'));
    const first = makeUpdate('first oversized');
    const second = makeUpdate('newer oversized');
    const slowLimit = Math.max(first.byteLength, second.byteLength) + 1_024;

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      maxUpdateBytes: 1,
      maxSlowSyncUpdateBytes: slowLimit,
      slowSync,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: first,
    });
    await flushPromises();
    expect(slowSync).toHaveBeenCalledTimes(1);

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: second,
    });
    await flushPromises();
    expect(mockRecords.map((record) => record.id)).toEqual([1, 2]);

    resolveFirst({ outcome: 'confirmed', messageId: { timestamp: 3, counter: 0 } });
    await flushPromises();

    expect(mockSyncOutboxTable.bulkDelete).toHaveBeenCalledWith([1]);
    expect(mockRecords.map((record) => record.id)).toEqual([2]);
  });

  it('keeps the locked reread, oversized upload, and exact-ID delete in one cross-tab critical section', async () => {
    const originalLocksDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
    let lockHeld = false;
    const requestLock = jest.fn(async (_name: string, _options: LockOptions, callback: () => Promise<unknown>) => {
      lockHeld = true;
      try {
        return await callback();
      } finally {
        lockHeld = false;
      }
    });

    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request: requestLock },
    });

    try {
      const payload = makeUpdate('locked oversized');
      const slowSync = jest.fn(async () => {
        expect(lockHeld).toBe(true);
        return {
          outcome: 'confirmed' as const,
          messageId: { timestamp: 3, counter: 0 },
        };
      });

      mockSyncOutboxTable.bulkDelete.mockImplementationOnce(async (ids: number[]) => {
        expect(lockHeld).toBe(true);
        const idsToDelete = new Set(ids);

        mockRecords = mockRecords.filter((record) => !idsToDelete.has(record.id ?? -1));
      });
      configureDrain({
        userId,
        workspaceId,
        send: jest.fn(),
        isReady: () => true,
        maxUpdateBytes: payload.byteLength - 1,
        maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
        slowSync,
      });

      enqueueOutboxUpdate({
        objectId,
        collabType: Types.Document,
        version: null,
        payload,
      });
      await flushPromises();

      expect(requestLock).toHaveBeenCalledTimes(1);
      expect(slowSync).toHaveBeenCalledTimes(1);
      expect(mockRecords).toHaveLength(0);
    } finally {
      if (originalLocksDescriptor) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocksDescriptor);
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks');
      }
    }
  });

  it('re-reads after acquiring the cross-tab lock and skips a stale batch already retired by another tab', async () => {
    const originalLocksDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
    const requestLock = jest.fn(async (_name: string, _options: LockOptions, callback: () => Promise<unknown>) => {
      // Simulate the previous lock owner completing this exact prefix while
      // the current tab was waiting to acquire ownership.
      mockRecords = [];
      return callback();
    });

    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request: requestLock },
    });

    try {
      const payload = makeUpdate('stale oversized');
      const slowSync = jest.fn();

      configureDrain({
        userId,
        workspaceId,
        send: jest.fn(),
        isReady: () => true,
        maxUpdateBytes: payload.byteLength - 1,
        maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
        slowSync,
      });
      enqueueOutboxUpdate({
        objectId,
        collabType: Types.Document,
        version: null,
        payload,
      });
      await flushPromises();

      expect(requestLock).toHaveBeenCalledTimes(1);
      expect(slowSync).not.toHaveBeenCalled();
      expect(mockRecords).toHaveLength(0);
    } finally {
      if (originalLocksDescriptor) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocksDescriptor);
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks');
      }
    }
  });

  it('cancels a pending cross-tab lock when the object is discarded', async () => {
    const originalLocksDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
    const requestLock = jest.fn((_name: string, options: LockOptions) => {
      const signal = options.signal;

      if (!signal) throw new Error('expected a cancellable Web Lock request');

      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request: requestLock },
    });

    try {
      const payload = makeUpdate('discard while waiting for lock');
      const slowSync = jest.fn();

      configureDrain({
        userId,
        workspaceId,
        send: jest.fn(),
        isReady: () => true,
        maxUpdateBytes: payload.byteLength - 1,
        maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
        slowSync,
      });

      await enqueueOutboxUpdate({
        objectId,
        collabType: Types.Document,
        version: null,
        payload,
      });
      await flushPromises();

      const signal = requestLock.mock.calls[0]?.[1].signal;

      expect(signal).toEqual(expect.any(AbortSignal));
      expect(signal?.aborted).toBe(false);

      await deleteOutboxByObjectId(objectId);

      expect(signal?.aborted).toBe(true);
      expect(slowSync).not.toHaveBeenCalled();
      expect(mockRecords).toHaveLength(0);
    } finally {
      if (originalLocksDescriptor) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocksDescriptor);
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks');
      }
    }
  });

  it('cancels a pending cross-tab lock before purging on logout', async () => {
    const originalLocksDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
    const requestLock = jest.fn((_name: string, options: LockOptions) => {
      const signal = options.signal;

      if (!signal) throw new Error('expected a cancellable Web Lock request');

      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request: requestLock },
    });

    try {
      const payload = makeUpdate('logout while waiting for lock');

      configureDrain({
        userId,
        workspaceId,
        send: jest.fn(),
        isReady: () => true,
        maxUpdateBytes: payload.byteLength - 1,
        maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
        slowSync: jest.fn(),
      });

      await enqueueOutboxUpdate({
        objectId,
        collabType: Types.Document,
        version: null,
        payload,
      });
      await flushPromises();

      const signal = requestLock.mock.calls[0]?.[1].signal;

      await purgeAllOutbox();

      expect(signal?.aborted).toBe(true);
      expect(mockRecords).toHaveLength(0);

      clearDrainConfig();
      await expect(
        enqueueOutboxUpdate({
          objectId,
          collabType: Types.Document,
          version: null,
          payload: makeUpdate('new session work'),
        })
      ).resolves.toBe(true);
    } finally {
      if (originalLocksDescriptor) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocksDescriptor);
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks');
      }
    }
  });

  it('derives the desired state vector from a nonzero-clock incremental update', async () => {
    const doc = new Y.Doc({ guid: objectId });
    const values = doc.getArray<number>('values');

    values.insert(
      0,
      Array.from({ length: 10 }, (_, index) => index)
    );
    const beforeStateVector = Y.encodeStateVector(doc);
    let incremental = new Uint8Array();

    doc.once('update', (update: Uint8Array) => {
      incremental = update;
    });
    values.insert(10, [10]);
    const expectedAfterStateVector = Y.encodeStateVector(doc);
    const slowSync = jest.fn().mockResolvedValue({ outcome: 'confirmed' });

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      maxUpdateBytes: incremental.byteLength - 1,
      maxSlowSyncUpdateBytes: incremental.byteLength + expectedAfterStateVector.byteLength + 1_024,
      slowSync,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: incremental,
      beforeStateVector,
    });
    await flushPromises();

    const desiredStateVector = slowSync.mock.calls[0][0].stateVector as Uint8Array;

    expect(Y.decodeStateVector(desiredStateVector)).toEqual(Y.decodeStateVector(expectedAfterStateVector));
    expect(mockRecords).toHaveLength(0);
  });

  it('reads and retires a long backlog in bounded compound-index prefixes', async () => {
    let ready = false;
    const send = jest.fn();

    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => ready,
      maxUpdateBytes: 0,
    });

    for (let index = 0; index < 65; index += 1) {
      enqueueOutboxUpdate({
        objectId,
        collabType: Types.Document,
        version: null,
        payload: makeUpdate(`queued-${index}`),
      });
    }

    await flushPromises();
    ready = true;
    startDrainAll();
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(2);
    expect(mockSyncOutboxTable.where).toHaveBeenCalledWith('[userId+workspaceId+objectId+id]');
    expect(mockSyncOutboxTable.bulkDelete.mock.calls[0][0]).toHaveLength(64);
    expect(mockSyncOutboxTable.bulkDelete.mock.calls[1][0]).toEqual([65]);
    expect(mockRecords).toHaveLength(0);
  });

  it('keeps a terminally blocked oversized update without scheduling another upload', async () => {
    const payload = makeUpdate('blocked');
    const slowSync = jest.fn().mockResolvedValue({
      outcome: 'blocked',
      reason: 'permission_denied',
    });

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      maxUpdateBytes: payload.byteLength - 1,
      maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
      slowSync,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload,
    });
    await flushPromises();
    startDrainAll();
    await flushPromises();

    expect(slowSync).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(1);
  });

  it('retries a permission-blocked oversized update after access changes', async () => {
    const payload = makeUpdate('permission restored');
    const slowSync = jest
      .fn()
      .mockResolvedValueOnce({ outcome: 'blocked', reason: 'permission_denied' })
      .mockResolvedValueOnce({ outcome: 'confirmed', messageId: { timestamp: 1, counter: 0 } });

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      maxUpdateBytes: payload.byteLength - 1,
      maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
      slowSync,
    });

    await enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload,
    });
    await flushPromises();

    expect(slowSync).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(1);

    resumePermissionBlockedSync(objectId);
    await flushPromises();

    expect(slowSync).toHaveBeenCalledTimes(2);
    expect(mockRecords).toHaveLength(0);
  });

  it('invalidates an update-too-large block when a newer manifest replaces its records', async () => {
    const rejected = createDeferred<{
      outcome: 'blocked';
      reason: 'update_too_large';
    }>();
    const oversizedManifest = makeUpdate('x'.repeat(4_096));
    const replacementManifest = makeUpdate('smaller manifest');
    const send = jest.fn();
    const slowSync = jest.fn(() => rejected.promise);

    expect(oversizedManifest.byteLength).toBeGreaterThan(replacementManifest.byteLength);
    configureDrain({
      userId,
      workspaceId,
      send,
      isReady: () => true,
      maxUpdateBytes: replacementManifest.byteLength,
      maxSlowSyncUpdateBytes: oversizedManifest.byteLength + 1_024,
      slowSync,
    });

    await enqueueOutboxUpdate(
      {
        objectId,
        collabType: Types.Database,
        version: null,
        payload: oversizedManifest,
      },
      { broadcast: false, source: 'manifest' }
    );
    await flushPromises();

    expect(slowSync).toHaveBeenCalledTimes(1);

    await enqueueOutboxUpdate(
      {
        objectId,
        collabType: Types.Database,
        version: null,
        payload: replacementManifest,
      },
      { broadcast: false, source: 'manifest' }
    );
    expect(mockRecords).toEqual([expect.objectContaining({ id: 2, payload: replacementManifest })]);

    rejected.resolve({ outcome: 'blocked', reason: 'update_too_large' });
    await flushPromises();

    expect(slowSync).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(0);
  });

  it('deletes an object only from an explicitly captured session', async () => {
    const originSession = { userId, workspaceId };
    const replacementSession = { userId, workspaceId: 'workspace-2' };

    clearDrainConfig();
    setCurrentSession(originSession);
    await enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('workspace one'),
    });

    setCurrentSession(replacementSession);
    await enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload: makeUpdate('workspace two'),
    });

    expect(getCurrentOutboxSession()).toEqual(replacementSession);
    await deleteOutboxByObjectId(objectId, { session: originSession });

    expect(mockRecords).toEqual([
      expect.objectContaining({
        objectId,
        userId: replacementSession.userId,
        workspaceId: replacementSession.workspaceId,
      }),
    ]);
  });

  it('honours the server retry delay for a retryable slow-sync failure', async () => {
    jest.useFakeTimers();

    try {
      const payload = makeUpdate('retry later');
      const retryableError = Object.assign(new Error('busy'), { retryAfterSecs: 7 });
      const slowSync = jest
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce({ outcome: 'blocked', reason: 'permission_denied' });

      configureDrain({
        userId,
        workspaceId,
        send: jest.fn(),
        isReady: () => true,
        maxUpdateBytes: payload.byteLength - 1,
        maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
        slowSync,
      });

      enqueueOutboxUpdate({
        objectId,
        collabType: Types.Document,
        version: null,
        payload,
      });
      await flushPromises();

      expect(slowSync).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(6_999);
      await flushPromises();
      expect(slowSync).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(slowSync).toHaveBeenCalledTimes(2);
      expect(mockRecords).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows an authoritative version reset to discard rows from inside the active slow drain', async () => {
    const payload = makeUpdate('stale version');
    const slowSync = jest.fn(async () => {
      await deleteOutboxByObjectId(objectId, { skipActiveDrain: true });
      return { outcome: 'confirmed' as const };
    });

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      maxUpdateBytes: payload.byteLength - 1,
      maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
      slowSync,
    });

    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: 'old-version',
      payload,
    });
    await flushPromises();

    expect(slowSync).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveLength(0);
  });

  it('retires exact confirmed IDs after a same-session drain configuration rebuild', async () => {
    let resolveSlowSync!: (result: { outcome: 'confirmed' }) => void;
    const pending = new Promise<{ outcome: 'confirmed' }>((resolve) => {
      resolveSlowSync = resolve;
    });
    const payload = makeUpdate('slow across reconnect');
    const slowSync = jest.fn(() => pending);

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => true,
      maxUpdateBytes: payload.byteLength - 1,
      maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
      slowSync,
    });
    enqueueOutboxUpdate({
      objectId,
      collabType: Types.Document,
      version: null,
      payload,
    });
    await flushPromises();

    configureDrain({
      userId,
      workspaceId,
      send: jest.fn(),
      isReady: () => false,
      maxUpdateBytes: payload.byteLength - 1,
      maxSlowSyncUpdateBytes: payload.byteLength + 1_024,
      slowSync,
    });
    resolveSlowSync({ outcome: 'confirmed' });
    await flushPromises();

    expect(mockSyncOutboxTable.bulkDelete).toHaveBeenCalledWith([1]);
    expect(mockRecords).toHaveLength(0);
  });
});
