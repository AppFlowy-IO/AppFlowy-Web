import * as Y from 'yjs';

import { __dbTestUtils, db } from '@/application/db';
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
  afterEach(() => {
    jest.restoreAllMocks();
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

    expect(transactionSpy).toHaveBeenCalledWith('r', db.collab_snapshots, db.collab_updates, expect.any(Function));
    expect(snapshotGetSpy).toHaveBeenCalledWith('row-1');
    expect(updatesWhereSpy).toHaveBeenCalledWith('[objectId+id]');
    expect(between).toHaveBeenCalledTimes(1);
    expect(between.mock.calls[0][0][0]).toBe('row-1');
    expect(between.mock.calls[0][1][0]).toBe('row-1');
    expect(result).toEqual({ snapshot, updates: [updateRecord] });
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
});
