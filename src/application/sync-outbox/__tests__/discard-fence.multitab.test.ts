/**
 * Several browser tabs share IndexedDB and localStorage but not module state.
 * A page whose paused edits were discarded in one tab may still be held in
 * memory by another tab, which must not rebuild and upload those edits later.
 */
import * as Y from 'yjs';

import { Types } from '@/application/types';

interface MockSyncOutboxRecord {
  id?: number;
  userId: string;
  workspaceId: string;
  objectId: string;
  collabType: number;
  payload: Uint8Array;
  createdAt: number;
  source?: 'manifest';
  permissionBlocked?: boolean;
  serverUrl?: string;
}

const mockPermissionBlocks = new Map<string, { revision: string }>();
let mockRecords: MockSyncOutboxRecord[] = [];
let mockNextId = 1;
let mockTransactionQueue: Promise<unknown> = Promise.resolve();

function mockMatchesIndex(index: string, key: unknown[], record: MockSyncOutboxRecord) {
  if (index === '[userId+workspaceId]') return record.userId === key[0] && record.workspaceId === key[1];
  if (index === '[userId+workspaceId+objectId]' || index === '[userId+workspaceId+objectId+id]') {
    return record.userId === key[0] && record.workspaceId === key[1] && record.objectId === key[2];
  }

  throw new Error(`Unsupported mock index: ${index}`);
}

function mockCollection(predicate: (record: MockSyncOutboxRecord) => boolean) {
  return {
    count: async () => mockRecords.filter(predicate).length,
    modify: async (patch: Partial<MockSyncOutboxRecord>) => {
      mockRecords.filter(predicate).forEach((row) => Object.assign(row, patch));
    },
    delete: async () => {
      mockRecords = mockRecords.filter((record) => !predicate(record));
    },
    filter: (next: (record: MockSyncOutboxRecord) => boolean) =>
      mockCollection((record) => predicate(record) && next(record)),
    each: async (callback: (record: MockSyncOutboxRecord) => void) => {
      mockRecords.filter(predicate).forEach(callback);
    },
    limit: (count: number) => ({
      toArray: async () =>
        mockRecords.filter(predicate).slice().sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0)).slice(0, count),
    }),
  };
}

jest.mock('@/application/db', () => ({
  matchesDatabaseStorageFence: jest.fn(async () => true),
  db: {
    sync_outbox: {
      add: async (row: Omit<MockSyncOutboxRecord, 'id'>) => {
        const id = mockNextId++;

        mockRecords.push({ ...row, id });
        return id;
      },
      bulkDelete: async (ids: number[]) => {
        mockRecords = mockRecords.filter((record) => !ids.includes(record.id ?? -1));
      },
      clear: async () => {
        mockRecords = [];
      },
      where: (index: string) => ({
        equals: (key: unknown[]) => mockCollection((record) => mockMatchesIndex(index, key, record)),
        between: (lower: unknown[]) => mockCollection((record) => mockMatchesIndex(index, lower, record)),
      }),
    },
    sync_permission_blocks: {
      get: async (key: string[]) => mockPermissionBlocks.get(JSON.stringify(key)),
      put: async (row: { serverUrl: string; userId: string; workspaceId: string; objectId: string; revision: string }) => {
        mockPermissionBlocks.set(JSON.stringify([row.serverUrl, row.userId, row.workspaceId, row.objectId]), row);
      },
      delete: async (key: string[]) => {
        mockPermissionBlocks.delete(JSON.stringify(key));
      },
    },
    collab_custom: {},
    transaction: (...args: unknown[]) => {
      const callback = args[args.length - 1] as () => Promise<unknown>;
      const transaction = mockTransactionQueue.then(callback);

      // IndexedDB serializes read-write transactions on the same stores, across tabs too.
      mockTransactionQueue = transaction.catch(() => undefined);
      return transaction;
    },
  },
}));

jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

type OutboxModule = typeof import('@/application/sync-outbox');
type FenceModule = typeof import('@/application/sync-outbox/discard-fence');
type Tab = OutboxModule & { fence: FenceModule };

const userId = 'user-1';
const workspaceId = 'workspace-1';
const serverUrl = 'https://server.test';
const session = { userId, workspaceId, serverUrl };
const pageId = '11111111-1111-4111-8111-111111111111';

function openTab(): Tab {
  let tab: Tab | undefined;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const outbox = require('@/application/sync-outbox') as OutboxModule;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fence = require('@/application/sync-outbox/discard-fence') as FenceModule;

    tab = { ...outbox, fence };
  });
  tab!.setCurrentSession(session);
  return tab!;
}

/** Only other tabs receive a storage event for a localStorage write. */
function deliverStorageEvent() {
  const key = Object.keys(localStorage).find((name) => name.startsWith('af_discarded_edits:'));

  window.dispatchEvent(new StorageEvent('storage', { key, newValue: key ? localStorage.getItem(key) : null }));
}

function update(text: string) {
  const doc = new Y.Doc({ guid: pageId });

  doc.getText('body').insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

async function flush() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

async function startOwner(tab: Tab, permission: () => 'allowed' | 'denied') {
  const send = jest.fn();

  tab.configureDrain({ ...session, send, isReady: () => true, checkPermission: async () => permission() });
  tab.startDrainAll();
  await flush();
  return send;
}

beforeEach(() => {
  localStorage.clear();
  mockRecords = [];
  mockPermissionBlocks.clear();
  mockNextId = 1;
  mockTransactionQueue = Promise.resolve();
});

test('a tab still holding a discarded page cannot upload the discarded edits, even after access returns', async () => {
  let permission: 'allowed' | 'denied' = 'denied';
  const tabA = openTab();
  const tabB = openTab();
  const sendA = await startOwner(tabA, () => permission);
  const discardedEdit = update('typed after the downgrade');

  await tabA.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: discardedEdit });
  await flush();
  expect(mockRecords).toEqual([expect.objectContaining({ permissionBlocked: true })]);

  const notifiedA = jest.fn();

  tabA.fence.subscribeDiscardedEdits(session, notifiedA);
  expect(await tabB.discardPermissionBlockedEdits(session)).toEqual([pageId]);
  deliverStorageEvent();
  // Tab A is told to reload the page it still holds.
  expect(notifiedA).toHaveBeenCalledWith([pageId]);

  // Until it does, the copy in its memory cannot come back: not through a
  // manifest reply after a reconnect, nor through a full sync.
  const manifest = Y.mergeUpdates([update('server state'), discardedEdit]);

  expect(await tabA.enqueueOutboxUpdate(
    { objectId: pageId, collabType: Types.Document, payload: manifest }, { broadcast: false, source: 'manifest' }
  )).toBe(false);
  permission = 'allowed';
  expect(await tabA.enqueueOutboxUpdate(
    { objectId: pageId, collabType: Types.Document, payload: manifest }, { broadcast: false, source: 'manifest' }
  )).toBe(false);
  expect(await tabA.mayUploadCollab(pageId, Types.Document, workspaceId)).toBe(false);
  await flush();
  expect(mockRecords).toEqual([]);
  expect(sendA).not.toHaveBeenCalled();

  // After the reload the page comes from the server and new edits are sent.
  tabA.clearDrainConfig();
  const reloadedA = openTab();
  const sendReloaded = await startOwner(reloadedA, () => permission);

  expect(await reloadedA.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: update('new') }))
    .toBe(true);
  await flush();
  expect(sendReloaded).toHaveBeenCalledTimes(1);
});

test('a tab that holds no copy of the discarded page keeps editing it after settling the discard', async () => {
  const tabA = openTab();
  const tabC = openTab();

  await startOwner(tabA, () => 'denied');
  await tabA.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: update('discard me') });
  await flush();
  await tabA.discardPermissionBlockedEdits(session);

  expect(tabC.fence.unsettledDiscards(session)).toEqual([pageId]);
  tabC.fence.settleDiscardedEdits(session, [pageId]);
  expect(tabC.fence.unsettledDiscards(session)).toEqual([]);

  tabA.clearDrainConfig();
  const sendC = await startOwner(tabC, () => 'allowed');

  expect(await tabC.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: update('fresh') }))
    .toBe(true);
  await flush();
  expect(sendC).toHaveBeenCalledTimes(1);
});

test('a tab opened after the discard is not fenced by it', async () => {
  const tabA = openTab();

  await startOwner(tabA, () => 'denied');
  await tabA.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: update('discard me') });
  await flush();
  await tabA.discardPermissionBlockedEdits(session);
  tabA.clearDrainConfig();

  const laterTab = openTab();

  expect(laterTab.fence.unsettledDiscards(session)).toEqual([]);
  const send = await startOwner(laterTab, () => 'allowed');

  expect(await laterTab.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: update('new') }))
    .toBe(true);
  await flush();
  expect(send).toHaveBeenCalledTimes(1);
});

test('a manifest whose check passed before the discard is refused when it is persisted after it', async () => {
  const tabA = openTab();
  const tabB = openTab();
  const sendA = await startOwner(tabA, () => 'allowed');

  // The enqueue passes its synchronous check, then the other tab's discard
  // commits before this tab's IndexedDB write runs.
  const pending = tabA.enqueueOutboxUpdate(
    { objectId: pageId, collabType: Types.Document, payload: update('rebuilt from memory') },
    { broadcast: false, source: 'manifest' }
  );

  tabB.fence.recordDiscardedEdits(session, [pageId]);

  expect(await pending).toBe(false);
  await flush();
  expect(mockRecords).toEqual([]);
  expect(sendA).not.toHaveBeenCalled();
});

test('a discard in another workspace does not fence this one', async () => {
  const tabA = openTab();
  const tabB = openTab();

  tabB.fence.recordDiscardedEdits({ ...session, workspaceId: 'workspace-2' }, [pageId]);
  const send = await startOwner(tabA, () => 'allowed');

  expect(await tabA.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: update('ok') }))
    .toBe(true);
  await flush();
  expect(send).toHaveBeenCalledTimes(1);
});

test('keeps the paused edits when the discard cannot be announced to other tabs', async () => {
  const tabA = openTab();

  await startOwner(tabA, () => 'denied');
  await tabA.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: update('keep me') });
  await flush();

  const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  });

  try {
    await expect(tabA.discardPermissionBlockedEdits(session)).rejects.toThrow('quota');
  } finally {
    setItem.mockRestore();
  }

  expect(mockRecords).toEqual([expect.objectContaining({ objectId: pageId, permissionBlocked: true })]);
  expect(mockPermissionBlocks.size).toBe(1);
});

test('a tab that missed the announcement is told to reload when it tries to upload the page', async () => {
  const tabA = openTab();
  const tabB = openTab();

  await startOwner(tabA, () => 'denied');
  await tabA.enqueueOutboxUpdate({ objectId: pageId, collabType: Types.Document, payload: update('quarantined') });
  await flush();
  const notifiedA = jest.fn();

  tabA.fence.subscribeDiscardedEdits(session, notifiedA);
  await tabB.discardPermissionBlockedEdits(session);
  // No storage event reaches tab A (it was frozen, for example).
  expect(notifiedA).not.toHaveBeenCalled();

  expect(await tabA.enqueueOutboxUpdate(
    { objectId: pageId, collabType: Types.Document, payload: update('rebuilt') }, { broadcast: false, source: 'manifest' }
  )).toBe(false);
  await flush();
  expect(notifiedA).toHaveBeenCalledWith([pageId]);
});
