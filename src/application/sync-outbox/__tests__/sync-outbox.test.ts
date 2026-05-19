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
  enqueueOutboxUpdate,
  setCurrentSession,
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
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('sync outbox live send', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecords = [];
    mockNextId = 1;
    clearDrainConfig();
    setCurrentSession({ userId, workspaceId });
  });

  afterEach(() => {
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
});
