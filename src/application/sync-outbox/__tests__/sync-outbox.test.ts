import * as Y from 'yjs';

import { Types } from '@/application/types';

interface MockSyncOutboxRecord {
  id?: number;
  userId: string;
  workspaceId: string;
  objectId: string;
  collabType: number;
  version?: string | null;
  payload: Uint8Array;
  createdAt: number;
  beforeStateVector?: Uint8Array;
}

let mockRecords: MockSyncOutboxRecord[] = [];
let mockNextId = 1;

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
    between: (lower: unknown[]) => ({
      limit: (count: number) => ({
        toArray: async () =>
          mockRecords
            .filter((record) => mockMatchesIndex(index, lower, record))
            .slice()
            .sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0))
            .slice(0, count),
      }),
    }),
  })),
};

jest.mock('@/application/db', () => ({
  db: {
    sync_outbox: mockSyncOutboxTable,
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
  purgeAllOutbox,
  setCurrentSession,
  shouldRouteUpdateThroughOutbox,
  startDrainAll,
} from '@/application/sync-outbox';

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

describe('sync outbox live send', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockRecords = [];
    mockNextId = 1;
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
      })
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
