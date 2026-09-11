import * as Y from 'yjs';

import { db, deleteCollabDB, openCollabDBWithProvider } from '@/application/db';
import { publishDatabaseCacheEpoch } from '@/application/db/database-storage-fence';

const mockStores = new Map<string, Uint8Array>();
const mockNames: string[] = [];

jest.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    synced = true;
    private readonly persist: () => void;

    constructor(public readonly name: string, private readonly doc: Y.Doc) {
      mockNames.push(name);
      const state = mockStores.get(name);

      if (state) Y.applyUpdate(doc, state);
      this.persist = () => mockStores.set(name, Y.encodeStateAsUpdate(doc));
      doc.on('update', this.persist);
    }

    async get() {
      return undefined;
    }
    async set() {}
    async destroy() {
      this.doc.off('update', this.persist);
    }
    on() {}
    off() {}
  },
}));

describe('database root storage generations', () => {
  beforeEach(() => {
    jest
      .spyOn(db, 'transaction')
      .mockImplementation((async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)()) as never);
    jest.spyOn(db.collab_custom, 'get').mockImplementation(async () => {
      const value = localStorage.getItem('af_database_blob_epoch:database');

      return value ? { objectId: 'database-blob-epoch:database', key: '__storage_epoch', value } : undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    mockStores.clear();
    mockNames.length = 0;
  });

  it('isolates the restored root from old providers and preserves it across a second tab reload', async () => {
    const old = await openCollabDBWithProvider('database', { skipCache: true });

    old.doc.getMap('database').set('title', 'old branch');
    publishDatabaseCacheEpoch('database', 'R');
    const fresh = await openCollabDBWithProvider('database', { skipCache: true, databaseRestoreId: 'R' });

    expect(fresh.doc.getMap('database').get('title')).toBeUndefined();
    fresh.doc.getMap('database').set('title', 'current edit');
    old.doc.getMap('database').set('title', 'delayed old-tab edit');
    await deleteCollabDB('database', { databaseId: 'database', databaseRestoreId: 'R' });
    // A fresh page open has no explicit restore option and must still use R.
    const sibling = await openCollabDBWithProvider('database', { skipCache: true });

    expect(sibling.doc.getMap('database').get('title')).toBe('current edit');
    expect([old.doc.guid, fresh.doc.guid, sibling.doc.guid]).toEqual(['database', 'database', 'database']);
    expect(mockNames).toEqual(['database', 'database:database-restore:R', 'database:database-restore:R']);
    publishDatabaseCacheEpoch('database', 'R2');
    await expect(openCollabDBWithProvider('database', { databaseRestoreId: 'R' })).rejects.toMatchObject({
      name: 'DatabaseStorageGenerationChangedError',
    });
    await Promise.all([old.provider.destroy(), fresh.provider.destroy(), sibling.provider.destroy()]);
    old.doc.destroy();
    fresh.doc.destroy();
    sibling.doc.destroy();
  });

  it('refuses the legacy namespace when the durable generation and shadow disagree', async () => {
    jest
      .mocked(db.collab_custom.get)
      .mockResolvedValue({ objectId: 'database-blob-epoch:database', key: '__storage_epoch', value: 'R' });

    await expect(openCollabDBWithProvider('database')).rejects.toMatchObject({
      name: 'DatabaseStorageGenerationChangedError',
    });
    expect(mockNames).toEqual([]);
  });

  it('initializes two same-generation roots without deleting their shared namespace for missing version metadata', async () => {
    publishDatabaseCacheEpoch('database', 'R');
    const [first, second] = await Promise.all([
      openCollabDBWithProvider('database', { skipCache: true, expectedVersion: 'version', databaseRestoreId: 'R' }),
      openCollabDBWithProvider('database', { skipCache: true, expectedVersion: 'version', databaseRestoreId: 'R' }),
    ]);

    // Exactly one provider each: neither caller deletes/reopens the new store.
    expect(mockNames).toEqual(['database:database-restore:R', 'database:database-restore:R']);
    expect(first.doc.version).toBe('version');
    expect(second.doc.version).toBe('version');
    await Promise.all([first.provider.destroy(), second.provider.destroy()]);
    first.doc.destroy();
    second.doc.destroy();
  });
});
