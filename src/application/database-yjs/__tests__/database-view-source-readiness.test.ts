import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'v8';

beforeAll(() => {
  if (!globalThis.structuredClone) globalThis.structuredClone = (value) => deserialize(serialize(value));
});
import * as Y from 'yjs';

import {
  DatabaseViewSourceRequirements,
  ORIGINAL_DATABASE_RESTORE_ID,
  readPersistedDatabaseSource,
  remoteDatabaseCoversSource,
  waitForDatabaseViewSource,
} from '@/application/database-yjs/creation/source-readiness';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

function database() {
  const doc = new Y.Doc();
  const root = new Y.Map();

  root.set(YjsDatabaseKey.id, 'database');
  root.set('rows', new Y.Array<string>());
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, root);
  return doc;
}

function rows(doc: Y.Doc): Y.Array<string> {
  return (doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>).get('rows') as Y.Array<string>;
}

function requirements(live: Y.Doc, persisted = live): DatabaseViewSourceRequirements {
  return { databaseId: 'database', restoreId: 'restore', version: 'version',
    live: Y.encodeStateAsUpdate(live), persisted: Y.encodeStateAsUpdate(persisted) };
}

function response(doc: Y.Doc) {
  return { objectId: 'database', collabType: Types.Database, collabVersion: 'version',
    missingUpdate: Y.encodeStateAsUpdate(doc), serverStateVector: Y.encodeStateVector(doc) };
}

function copy(doc: Y.Doc) {
  const remote = new Y.Doc();

  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  return remote;
}

describe('Database view source readiness', () => {
  it('waits for normal row sync without uploading, then accepts the first complete remote proof', async () => {
    const live = database();
    const remote = copy(live);

    rows(live).push(['new-row']);
    const captured = requirements(live);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const read = jest.fn(async () => {
      await held;
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(live));
      return response(remote);
    });
    const submit = jest.fn();
    const pending = waitForDatabaseViewSource(captured, {
      read, assertCurrent: () => undefined, signal: new AbortController().signal, deadline: Date.now() + 1000,
    }).then(submit);

    await Promise.resolve();
    expect(submit).not.toHaveBeenCalled();
    expect(rows(remote).toArray()).toEqual([]);
    release();
    await pending;
    expect(read).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('requires deletion coverage even when both state vectors are equal', () => {
    const live = database();

    rows(live).push(['deleted-row']);
    const remote = copy(live);

    rows(live).delete(0);
    expect(Y.encodeStateVector(live)).toEqual(Y.encodeStateVector(remote));
    expect(remoteDatabaseCoversSource(requirements(live), response(remote))).toBe(false);
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(live));
    expect(remoteDatabaseCoversSource(requirements(live), response(remote))).toBe(true);
  });

  it('checks durable history independently from the live document', () => {
    const live = database();
    const durable = copy(live);

    rows(durable).push(['other-tab-row']);
    expect(remoteDatabaseCoversSource(requirements(live, durable), response(live))).toBe(false);
    expect(remoteDatabaseCoversSource(requirements(live, durable), response(durable))).toBe(true);
  });

  it('refuses an unrelated durable root even if the server has the same clocks', () => {
    const live = database();
    const durable = copy(live);
    (durable.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>)
      .set(YjsDatabaseKey.id, 'other');
    expect(() => remoteDatabaseCoversSource(requirements(live, durable), response(live))).toThrow('different identity');
  });

  it('refuses missing prerequisite fragments instead of filling them from local history', () => {
    const live = database();
    const before = Y.encodeStateVector(live);

    rows(live).push(['row']);
    const partial = { ...response(live), missingUpdate: Y.encodeStateAsUpdate(live, before) };

    expect(() => remoteDatabaseCoversSource(requirements(live), partial)).toThrow('incomplete');
  });

  it.each([
    { objectId: 'other' }, { collabType: Types.Document }, { collabVersion: 'new-generation' },
    { error: 'denied' }, { serverStateVector: new Uint8Array([0]) },
  ])('refuses an unrelated, denied or incomplete server result: %j', (change) => {
    const doc = database();

    expect(() => remoteDatabaseCoversSource(requirements(doc), { ...response(doc), ...change })).toThrow();
  });

  it('does not accept a proof after owner retirement or deadline expiry', async () => {
    const doc = database();
    let current = true;
    const options = {
      read: async () => { current = false; return response(doc); },
      assertCurrent: () => { if (!current) throw new Error('owner retired'); },
      signal: new AbortController().signal, deadline: Date.now() + 1000,
    };

    await expect(waitForDatabaseViewSource(requirements(doc), options)).rejects.toThrow('owner retired');
    const read = jest.fn(async () => response(doc));

    await expect(waitForDatabaseViewSource(requirements(doc), {
      ...options, assertCurrent: () => undefined, read, deadline: Date.now() - 1,
    })).rejects.toThrow('not reached');
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, null],
    [ORIGINAL_DATABASE_RESTORE_ID, null],
    [ORIGINAL_DATABASE_RESTORE_ID, ORIGINAL_DATABASE_RESTORE_ID],
    ['restore', 'restore'],
  ])(
    'reads durable bytes for wire marker %s and storage epoch %s without changing the live root or storage',
    async (restoreId, storageEpoch) => {
      const live = database() as YDoc;

      live.databaseRestoreId = restoreId ?? undefined;
      live.version = 'version';
      const name = storageEpoch ? `${live.guid}:database-restore:${storageEpoch}` : live.guid;
      const connection = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(name);

        request.onupgradeneeded = () => {
          request.result.createObjectStore('updates', { autoIncrement: true });
          request.result.createObjectStore('custom');
        };
        request.onsuccess = () => resolve(request.result);
      });
      const durable = copy(live);

      rows(durable).push(['persisted-only']);
      await new Promise<void>((resolve) => {
        const tx = connection.transaction(['updates', 'custom'], 'readwrite');

        tx.objectStore('updates').add(Y.encodeStateAsUpdate(durable));
        tx.objectStore('custom').put('version', `${live.guid}/version`);
        tx.oncomplete = () => resolve();
      });
      const result = await readPersistedDatabaseSource(live, new AbortController().signal, {
        databaseId: live.guid,
        epoch: storageEpoch ?? null,
        cacheEpoch: storageEpoch ?? null,
      });
      const decoded = new Y.Doc();

      Y.applyUpdate(decoded, result);
      expect(rows(decoded).toArray()).toEqual(['persisted-only']);
      expect(rows(live).toArray()).toEqual([]);
      const count = await new Promise<number>((resolve) => {
        const request = connection.transaction('updates', 'readonly').objectStore('updates').count();

        request.onsuccess = () => resolve(request.result);
      });

      expect(count).toBe(1);
      expect(
        (await indexedDB.databases())
          .map(({ name: databaseName }) => databaseName)
          .filter((databaseName) => databaseName?.startsWith(live.guid))
      ).toEqual([name]);
      connection.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  );

  it('does not fall back to the original namespace when restored storage is missing', async () => {
    const live = database() as YDoc;
    const connection = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(live.guid);

      request.onupgradeneeded = () => {
        request.result.createObjectStore('updates', { autoIncrement: true });
        request.result.createObjectStore('custom');
      };
      request.onsuccess = () => resolve(request.result);
    });

    try {
      await new Promise<void>((resolve) => {
        const tx = connection.transaction('updates', 'readwrite');

        tx.objectStore('updates').add(Y.encodeStateAsUpdate(live));
        tx.oncomplete = () => resolve();
      });
      live.databaseRestoreId = 'missing-restore';
      await expect(
        readPersistedDatabaseSource(live, new AbortController().signal, {
          databaseId: live.guid,
          epoch: 'missing-restore',
          cacheEpoch: 'missing-restore',
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      const names = (await indexedDB.databases()).map(({ name }) => name);

      expect(names).toContain(live.guid);
      expect(names).not.toContain(`${live.guid}:database-restore:missing-restore`);
    } finally {
      connection.close();
      live.destroy();
      indexedDB.deleteDatabase(live.guid);
    }
  });

  it.each([
    { epoch: null, cacheEpoch: null },
    { epoch: 'older-restore', cacheEpoch: 'older-restore' },
    { epoch: 'current-restore', cacheEpoch: 'older-restore' },
    { epoch: 'current-restore', cacheEpoch: undefined },
  ])('refuses a mismatched or unavailable storage fence %j before opening IndexedDB', async (fence) => {
    const live = database() as YDoc;

    live.databaseRestoreId = 'current-restore';
    const open = jest.spyOn(indexedDB, 'open');

    try {
      await expect(
        readPersistedDatabaseSource(live, new AbortController().signal, {
          databaseId: live.guid,
          ...fence,
        })
      ).rejects.toThrow('Database source storage generation changed');
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      live.destroy();
    }
  });
});
