import * as Y from 'yjs';

import { withDatabaseStorageFence } from '@/application/db/database-storage-fence';
import {
  __dbTestUtils,
  db,
  captureDatabaseStorageFence,
  publishWithDatabaseStorageFence,
  rotateDatabaseStorageFence,
} from '@/application/db';
import { type CollabSnapshotRecord, type CollabUpdateRecord } from '@/application/db/tables/collab_storage';
import { type YDoc } from '@/application/types';

class FakeProvider {
  synced = false;
  destroy = jest.fn().mockResolvedValue(undefined);

  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>();

    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, args: unknown[] = []) {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
}

describe('collab IndexedDB persistence internals', () => {
  const originalIndexedDB = globalThis.indexedDB;

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(db.collab_custom, 'get').mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDB,
    });
    jest.restoreAllMocks();
    jest.useRealTimers();
    localStorage.clear();
  });

  it('settles waiters when a pending provider is destroyed before synced', async () => {
    const provider = new FakeProvider();
    const doc = new Y.Doc({ guid: 'pending-object' }) as YDoc;
    const entry = __dbTestUtils.createCachedProviderEntry('pending-object', Date.now(), doc, provider as never);

    const waitPromise = __dbTestUtils.waitForProviderEntry('pending-object', entry);

    await __dbTestUtils.destroyProviderEntry(entry, { destroyDoc: false });

    await expect(waitPromise).rejects.toThrow('Collab provider was disposed while opening: pending-object');
    expect(provider.destroy).toHaveBeenCalledTimes(1);
  });

  it('reads shared snapshots and update tails in one transaction', async () => {
    const snapshot: CollabSnapshotRecord = {
      objectId: 'row-1',
      update: new Uint8Array([1]),
      stateVector: new Uint8Array([2]),
      updatedAt: 1,
      byteLength: 1,
    };
    const updateRecord: CollabUpdateRecord = {
      id: 1,
      objectId: 'row-1',
      update: new Uint8Array([3]),
      createdAt: 2,
      byteLength: 1,
    };
    const toArray = jest.fn().mockResolvedValue([updateRecord]);
    const between = jest.fn().mockReturnValue({ toArray });
    const transactionSpy = jest.spyOn(db, 'transaction').mockImplementation((async (...args: unknown[]) => {
      const callback = args[args.length - 1] as () => Promise<unknown>;

      return callback();
    }) as never);
    const snapshotGetSpy = jest.spyOn(db.collab_snapshots, 'get').mockResolvedValue(snapshot);
    const updatesWhereSpy = jest.spyOn(db.collab_updates, 'where').mockReturnValue({ between } as never);

    const result = await __dbTestUtils.readSharedCollabRecordsForSync('row-1');

    expect(transactionSpy).toHaveBeenCalledWith(
      'r',
      db.collab_snapshots,
      db.collab_updates,
      db.collab_custom,
      expect.any(Function)
    );
    expect(snapshotGetSpy).toHaveBeenCalledWith('row-1');
    expect(updatesWhereSpy).toHaveBeenCalledWith('[objectId+id]');
    expect(between).toHaveBeenCalledTimes(1);
    expect(between.mock.calls[0][0][0]).toBe('row-1');
    expect(between.mock.calls[0][1][0]).toBe('row-1');
    expect(result).toEqual({ snapshot, updates: [updateRecord], storageEpoch: null });
  });

  it('prevents an old tab provider from persisting after an authoritative epoch change', async () => {
    let epoch: string | null = null;
    jest
      .mocked(db.collab_custom.get)
      .mockImplementation(async () =>
        epoch === null ? undefined : { objectId: 'row', key: '__storage_epoch', value: epoch }
      );
    jest
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)()) as never);
    jest.spyOn(db.collab_snapshots, 'get').mockResolvedValue(undefined);
    jest.spyOn(db.collab_updates, 'where').mockReturnValue({ between: () => ({ toArray: async () => [] }) } as never);
    const add = jest.spyOn(db.collab_updates, 'add').mockResolvedValue(1);
    const oldDoc = new Y.Doc({ guid: 'row' });
    const oldProvider = new __dbTestUtils.SharedIndexeddbPersistence('row', oldDoc);

    await oldProvider.whenSynced;
    epoch = 'restored-storage-epoch';
    oldDoc.getMap('row').set('title', 'stale edit');
    await oldProvider.destroy();
    expect(add).not.toHaveBeenCalled();

    const freshDoc = new Y.Doc({ guid: 'row' });
    const freshProvider = new __dbTestUtils.SharedIndexeddbPersistence('row', freshDoc);

    await freshProvider.whenSynced;
    freshDoc.getMap('row').set('title', 'fresh edit');
    await freshProvider.destroy();
    expect(add).toHaveBeenCalledTimes(1);
    oldDoc.destroy();
    freshDoc.destroy();
  });

  it('rejects old aggregate seed bytes even when the row provider opens after restore with a current row epoch', async () => {
    jest.mocked(db.collab_custom.get).mockImplementation(async (key) => {
      const [objectId] = key as string[];

      return {
        objectId,
        key: '__storage_epoch',
        value: objectId.startsWith('database-blob-epoch:') ? 'new-database-epoch' : 'current-row-epoch',
      };
    });
    jest
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)()) as never);
    jest.spyOn(db.collab_snapshots, 'get').mockResolvedValue(undefined);
    jest.spyOn(db.collab_updates, 'where').mockReturnValue({ between: () => ({ toArray: async () => [] }) } as never);
    const add = jest.spyOn(db.collab_updates, 'add').mockResolvedValue(1);
    const doc = new Y.Doc({ guid: 'newly-discovered-row' }) as YDoc;
    const provider = new __dbTestUtils.SharedIndexeddbPersistence(doc.guid, doc);

    await provider.whenSynced;
    withDatabaseStorageFence(doc, { databaseId: 'database', epoch: null, cacheEpoch: null }, () => {
      doc.getMap('row').set('title', 'response captured before restore');
    });
    // A later ordinary update must not make the poisoned in-memory CRDT persistable.
    doc.getMap('row').set('another', 'edit');
    await provider.destroy();
    expect(add).not.toHaveBeenCalled();
    doc.destroy();

    const fresh = new Y.Doc({ guid: 'newly-discovered-row' }) as YDoc;
    const freshProvider = new __dbTestUtils.SharedIndexeddbPersistence(fresh.guid, fresh);

    await freshProvider.whenSynced;
    withDatabaseStorageFence(
      fresh,
      { databaseId: 'database', epoch: 'new-database-epoch', cacheEpoch: 'new-database-epoch' },
      () => {
        fresh.getMap('row').set('title', 'new response');
      }
    );
    await freshProvider.destroy();
    expect(add).toHaveBeenCalledTimes(1);
    fresh.destroy();
  });

  it('preserves ordinary reads without IndexedDB before any restore, but required reloads fail closed', async () => {
    jest.spyOn(db, 'transaction').mockRejectedValue(new Error('IndexedDB unavailable'));
    const fence = await captureDatabaseStorageFence('ordinary-database');
    const publish = jest.fn();

    expect(fence).toMatchObject({ databaseId: 'ordinary-database', epoch: null, nonDurable: true });
    await expect(publishWithDatabaseStorageFence(fence, publish)).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(captureDatabaseStorageFence('ordinary-database', { required: true })).rejects.toThrow('unavailable');
    localStorage.setItem('af_database_blob_epoch:ordinary-database', 'restore-epoch');
    await expect(captureDatabaseStorageFence('ordinary-database')).rejects.toThrow('unavailable');
    await expect(publishWithDatabaseStorageFence(fence, publish)).rejects.toThrow('unavailable');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('checks the durable generation in the transaction publishing a local RID checkpoint', async () => {
    const transaction = jest
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)()) as never);
    jest
      .mocked(db.collab_custom.get)
      .mockResolvedValue({ objectId: 'database-blob-epoch:database', key: '__storage_epoch', value: 'restored' });
    const publish = jest.fn();

    // Even if a synchronous shadow read has not observed the change, the
    // durable generation prevents publishing an obsolete resume checkpoint.
    await expect(
      publishWithDatabaseStorageFence({ databaseId: 'database', epoch: null, cacheEpoch: null }, publish)
    ).resolves.toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith('rw', db.collab_custom, expect.any(Function));
    localStorage.setItem('af_database_blob_epoch:database', 'restored');
    await expect(
      publishWithDatabaseStorageFence({ databaseId: 'database', epoch: 'restored', cacheEpoch: 'restored' }, publish)
    ).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('shares a stable epoch across tabs restoring the same version and rejects a delayed older head', async () => {
    let epoch: string | null = null;
    jest
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)()) as never);
    jest
      .mocked(db.collab_custom.get)
      .mockImplementation(async () =>
        epoch === null ? undefined : { objectId: 'database-blob-epoch:database', key: '__storage_epoch', value: epoch }
      );
    const put = jest.spyOn(db.collab_custom, 'put').mockImplementation(async (record) => {
      epoch = record.value as string;
      return [record.objectId, record.key];
    });

    await rotateDatabaseStorageFence('database', 'R1', null);
    const firstTabFence = await captureDatabaseStorageFence('database');
    await rotateDatabaseStorageFence('database', 'R1', null);
    expect(await captureDatabaseStorageFence('database')).toEqual(firstTabFence);
    expect(put).toHaveBeenCalledTimes(1);

    await rotateDatabaseStorageFence('database', 'R2', 'R1');
    await expect(rotateDatabaseStorageFence('database', 'R1', null)).rejects.toMatchObject({
      name: 'DatabaseStorageGenerationChangedError',
    });
    expect(epoch).toBe('R2');
    expect(localStorage.getItem('af_database_blob_epoch:database')).toBe('R2');
  });

  it('preserves hydrated row data and its active provider when a second tab clears the same restore', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
    const epochs = new Map<string, string>([['database-blob-epoch:database', 'R']]);
    jest.mocked(db.collab_custom.get).mockImplementation(async (key) => {
      const [objectId] = key as string[];
      const value = epochs.get(objectId);

      return value ? { objectId, key: '__storage_epoch', value } : undefined;
    });
    jest.spyOn(db.collab_custom, 'put').mockImplementation(async (record) => {
      epochs.set(record.objectId, record.value as string);
      return [record.objectId, record.key];
    });
    jest
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)()) as never);
    const deletion = jest.spyOn(db.collab_snapshots, 'delete').mockResolvedValue(undefined);
    jest.spyOn(db.collab_snapshots, 'get').mockResolvedValue(undefined);
    jest.spyOn(db.collab_custom, 'where').mockReturnValue({ equals: () => ({ delete: async () => {} }) } as never);
    jest.spyOn(db.collab_updates, 'where').mockReturnValue({
      equals: () => ({ delete: async () => {} }),
      between: () => ({ toArray: async () => [] }),
    } as never);
    const add = jest.spyOn(db.collab_updates, 'add').mockResolvedValue(1);
    const fence = { databaseId: 'database', epoch: 'R', cacheEpoch: 'R' };

    await expect(__dbTestUtils.deleteSharedCollabData('row', fence, 'R')).resolves.toBe(true);
    const doc = new Y.Doc({ guid: 'row' }) as YDoc;
    const provider = new __dbTestUtils.SharedIndexeddbPersistence('row', doc);

    await provider.whenSynced;
    withDatabaseStorageFence(doc, fence, () => doc.getMap('row').set('title', 'first tab edit'));
    await expect(__dbTestUtils.deleteSharedCollabData('row', fence, 'R')).resolves.toBe(true);
    doc.getMap('row').set('title', 'still writable after sibling reload');
    await provider.destroy();
    expect(deletion).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(2);
    expect(epochs.get('row')).toBe('R');
    epochs.set('database-blob-epoch:database', 'R2');
    await expect(__dbTestUtils.deleteSharedCollabData('row', fence, 'R')).resolves.toBe(false);
    expect(deletion).toHaveBeenCalledTimes(1);
    doc.destroy();
  });

  it('checks the aggregate epoch atomically before a delayed tombstone deletes shared row data', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
    jest
      .mocked(db.collab_custom.get)
      .mockResolvedValue({ objectId: 'database-blob-epoch:database', key: '__storage_epoch', value: 'new' });
    const transaction = jest
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)()) as never);
    const deletion = jest.spyOn(db.collab_snapshots, 'delete').mockResolvedValue(undefined);

    await expect(
      __dbTestUtils.deleteSharedCollabData('new-row', { databaseId: 'database', epoch: null, cacheEpoch: null })
    ).resolves.toBe(false);
    expect(deletion).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith(
      'rw',
      db.collab_snapshots,
      db.collab_updates,
      db.collab_custom,
      expect.any(Function)
    );
  });

  it('preserves an ordinary unmarked read when localStorage is unavailable', async () => {
    jest
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)()) as never);
    jest.mocked(db.collab_custom.get).mockResolvedValue(undefined);
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    const fence = await captureDatabaseStorageFence('ordinary-database');
    const publish = jest.fn();

    expect(fence).toMatchObject({ epoch: null, cacheEpoch: undefined, nonDurable: true });
    await expect(publishWithDatabaseStorageFence(fence, publish)).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(captureDatabaseStorageFence('ordinary-database', { required: true })).rejects.toThrow('unavailable');
  });

  it('registers user-scoped workspace database catalog indexes', () => {
    const schema = db.workspace_database_catalog.schema;

    expect(schema.primKey.src).toBe('[user_id+workspace_id+view_id]');
    expect(schema.indexes.map((index) => index.src)).toEqual(
      expect.arrayContaining(['[user_id+workspace_id]', '[user_id+workspace_id+database_id]'])
    );
  });

  it('clears all blob RID checkpoints when the shared collab cache database is deleted', () => {
    localStorage.setItem('af_database_blob_rid:database-1', JSON.stringify({ timestamp: 1, seqNo: 2 }));
    localStorage.setItem('af_database_blob_rid:database-2', JSON.stringify({ timestamp: 3, seqNo: 4 }));
    localStorage.setItem('unrelated-key', 'keep');

    __dbTestUtils.clearBlobRidCheckpointsForDeletedDatabases([{ name: db.name, deleted: true }]);

    expect(localStorage.getItem('af_database_blob_rid:database-1')).toBeNull();
    expect(localStorage.getItem('af_database_blob_rid:database-2')).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep');
  });

  it('waits for a blocked IndexedDB delete to succeed', async () => {
    const request = {} as IDBOpenDBRequest;
    const deleteDatabase = jest.fn(() => request);

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { deleteDatabase },
    });

    const deleted = __dbTestUtils.deleteIndexedDBDatabase('blocked-then-deleted');

    request.onblocked?.({} as Event);
    request.onsuccess?.({} as Event);

    await expect(deleted).resolves.toBe(true);
    expect(deleteDatabase).toHaveBeenCalledWith('blocked-then-deleted');
  });

  it('fails a blocked IndexedDB delete after the unblock timeout', async () => {
    jest.useFakeTimers();
    const request = {} as IDBOpenDBRequest;
    const deleteDatabase = jest.fn(() => request);

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { deleteDatabase },
    });

    const deleted = __dbTestUtils.deleteIndexedDBDatabase('blocked-forever', { blockedTimeoutMs: 10 });

    request.onblocked?.({} as Event);
    jest.advanceTimersByTime(10);

    await expect(deleted).resolves.toBe(false);
  });
});
