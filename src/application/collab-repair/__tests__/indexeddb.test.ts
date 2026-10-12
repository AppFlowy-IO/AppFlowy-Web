/** @jest-environment node */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as Y from 'yjs';

import { readPersistedRepairUpdate } from '../indexeddb';
import { NIL_RESTORE_ID, REPAIR_MAX_SOURCE_BYTES, REPAIR_MAX_SOURCE_UPDATES, type RepairRequest } from '../types';

const objectId = '11111111-1111-1111-1111-111111111111';
const databaseId = '22222222-2222-2222-2222-222222222222';
const version = '33333333-3333-3333-3333-333333333333';
const restored = '44444444-4444-4444-4444-444444444444';
const sharedName = 'af_database_cache';
const shadow = new Map<string, string>();

function request(type: 0 | 1 | 4 = 0, patch: Partial<RepairRequest> = {}): RepairRequest {
  return {
    objectId,
    collabType: type,
    requestId: '55555555-5555-5555-5555-555555555555',
    stateVector: new Uint8Array([0]),
    maxUpdateBytes: 4 * 1024 * 1024,
    version: undefined,
    databaseId: type === 0 ? undefined : type === 1 ? objectId : databaseId,
    databaseRestoreId: type === 0 ? undefined : NIL_RESTORE_ID,
    ...patch,
  };
}

function document(type: 0 | 1 | 4 = 0): Y.Doc {
  const doc = new Y.Doc({ guid: objectId });
  const body = new Y.Map();

  body.set('id', objectId);
  if (type === 4) body.set('database_id', databaseId);
  body.set('title', 'retained local edit');
  doc.getMap('data').set(type === 0 ? 'document' : type === 1 ? 'database' : 'data', body);
  return doc;
}

function open(name: string, shared = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);

    open.onupgradeneeded = () => {
      const db = open.result;

      if (shared) {
        db.createObjectStore('collab_snapshots', { keyPath: 'objectId' });
        db.createObjectStore('collab_custom', { keyPath: ['objectId', 'key'] });
        db.createObjectStore('collab_updates', { keyPath: 'id', autoIncrement: true }).createIndex('[objectId+id]', [
          'objectId',
          'id',
        ]);
      } else {
        db.createObjectStore('updates', { autoIncrement: true });
        db.createObjectStore('custom');
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function write(name: string, shared: boolean, action: (transaction: IDBTransaction) => void): Promise<void> {
  const database = await open(name, shared);

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(Array.from(database.objectStoreNames), 'readwrite');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      action(transaction);
    });
  } finally {
    database.close();
  }
}

async function persist(doc: Y.Doc, req: RepairRequest, updates = [Y.encodeStateAsUpdate(doc)]): Promise<void> {
  if (req.collabType === 4) {
    await write(sharedName, true, (transaction) => {
      transaction.objectStore('collab_snapshots').put({ objectId, update: updates[0], version: req.version });
      updates.slice(1).forEach((update) => transaction.objectStore('collab_updates').add({ objectId, update }));
      if (req.version)
        transaction.objectStore('collab_custom').put({ objectId, key: `${objectId}/version`, value: req.version });
      if (req.databaseRestoreId)
        transaction.objectStore('collab_custom').put({ objectId, key: '__storage_epoch', value: req.databaseRestoreId });
    });
  } else {
    const name = req.databaseRestoreId ? `${objectId}:database-restore:${req.databaseRestoreId}` : objectId;

    await write(name, false, (transaction) => {
      updates.forEach((update) => transaction.objectStore('updates').add(update));
      if (req.version) transaction.objectStore('custom').put(req.version, `${objectId}/version`);
    });
  }
  if (req.databaseRestoreId) {
    await write(sharedName, true, (transaction) => {
      transaction.objectStore('collab_custom').put({
        objectId: `database-blob-epoch:${req.databaseId}`,
        key: '__storage_epoch',
        value: req.databaseRestoreId,
      });
    });
    shadow.set(`af_database_blob_epoch:${req.databaseId}`, req.databaseRestoreId);
  }
}

function read(req: RepairRequest, signal = new AbortController().signal) {
  return readPersistedRepairUpdate(req, signal);
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => shadow.get(key) ?? null },
  });
  shadow.clear();
});

afterEach(() => jest.restoreAllMocks());

test.each([0, 1, 4] as const)('closed persisted object type %i supplies a repair without a provider', async (type) => {
  const req = request(type, { version });
  const donor = document(type);

  await persist(donor, req);
  donor.destroy();
  const repair = await read(req);
  const server = new Y.Doc();

  expect(repair).toMatchObject({
    objectId,
    collabType: type,
    version,
    databaseRestoreId: type === 0 ? undefined : NIL_RESTORE_ID,
  });
  Y.applyUpdate(server, repair!.payload);
  expect(server.getMap('data').toJSON()).toEqual({
    [type === 0 ? 'document' : type === 1 ? 'database' : 'data']: {
      id: objectId,
      title: 'retained local edit',
      ...(type === 4 ? { database_id: databaseId } : {}),
    },
  });
  server.destroy();
});

test.each([0, 1, 4] as const)('missing object type %i does not create or initialize a database', async (type) => {
  expect(await read(request(type))).toBeUndefined();
  expect(await indexedDB.databases()).toEqual([]);
});

test.each([1, 4] as const)('restored object type %i requires its locally captured generation', async (type) => {
  const req = request(type, { version, databaseRestoreId: restored });
  const donor = document(type);

  await persist(donor, req);
  const response = await read(req);

  expect(response?.databaseRestoreId).toBe(restored);
  expect(await read({ ...req, databaseRestoreId: NIL_RESTORE_ID })).toBeUndefined();
  expect(await read({ ...req, version: undefined })).toBeUndefined();
  // A sibling starts a newer restore after these bytes were cached.
  shadow.set(`af_database_blob_epoch:${req.databaseId}`, version);
  expect(await read(req)).toBeUndefined();
  donor.destroy();
});

test('a request never resets a mismatching persisted version', async () => {
  const donor = document();
  const req = request(0, { version });

  await persist(donor, req);
  expect(await read({ ...req, version: restored })).toBeUndefined();
  expect((await read(req))?.version).toBe(version);
  donor.destroy();
});

test('row parent mismatch cannot donate or be relabeled with the requested parent', async () => {
  const donor = document(4);
  const req = request(4);

  await persist(donor, req);
  expect(await read({ ...req, databaseId: version })).toBeUndefined();
  expect(await read(req)).toBeDefined();
  donor.destroy();
});

test('snapshot and update tail reconstruct the predecessor missing on the server', async () => {
  const donor = document(4);
  const base = Y.encodeStateAsUpdate(donor);
  const before = Y.encodeStateVector(donor);

  (donor.getMap('data').get('data') as Y.Map<unknown>).set('title', 'after predecessor');
  const dependent = Y.encodeStateAsUpdate(donor, before);
  const server = new Y.Doc();

  Y.applyUpdate(server, dependent);
  expect(server.store.pendingStructs).not.toBeNull();
  const req = request(4, { stateVector: Y.encodeStateVector(server) });

  await persist(donor, req, [base, dependent]);
  Y.applyUpdate(server, (await read(req))!.payload);
  expect(server.store.pendingStructs).toBeNull();
  expect(server.getMap('data').toJSON()).toEqual(donor.getMap('data').toJSON());
  donor.destroy();
  server.destroy();
});

test('deletion-only differences are sent even when state vectors match', async () => {
  const donor = document();
  const server = new Y.Doc();

  Y.applyUpdate(server, Y.encodeStateAsUpdate(donor));
  (donor.getMap('data').get('document') as Y.Map<unknown>).delete('title');
  expect(Y.encodeStateVector(server)).toEqual(Y.encodeStateVector(donor));
  const req = request(0, { stateVector: Y.encodeStateVector(server) });

  await persist(donor, req);
  const repair = await read(req);

  expect(repair).toBeDefined();
  Y.applyUpdate(server, repair!.payload);
  expect(server.getMap('data').toJSON()).toEqual(donor.getMap('data').toJSON());
  donor.destroy();
  server.destroy();
});

test('output byte cap and cancellation leave the stored donor available', async () => {
  const donor = document();
  const req = request();

  await persist(donor, req);
  expect(await read({ ...req, maxUpdateBytes: 1 })).toBeUndefined();
  const controller = new AbortController();

  controller.abort();
  await expect(read(req, controller.signal)).rejects.toThrow('cancelled');
  expect(await read(req)).toBeDefined();
  donor.destroy();
});

test('source cursor stops at the update-count budget without modifying storage', async () => {
  const donor = document();
  const req = request();

  await persist(
    donor,
    req,
    Array.from({ length: REPAIR_MAX_SOURCE_UPDATES + 1 }, () => new Uint8Array([0, 0]))
  );
  await expect(read(req)).rejects.toThrow('read budget');
  const database = await open(objectId);
  const count = await new Promise((resolve) => {
    const count = database.transaction('updates').objectStore('updates').count();

    count.onsuccess = () => resolve(count.result);
  });

  expect(count).toBe(REPAIR_MAX_SOURCE_UPDATES + 1);
  database.close();
  donor.destroy();
});

test('restore epoch changed during source replay suppresses the response', async () => {
  const donor = document(4);
  const req = request(4, { databaseRestoreId: restored });

  await persist(donor, req);
  const apply = Y.applyUpdate;

  jest.spyOn(Y, 'applyUpdate').mockImplementation((...args) => {
    apply(...args);
    shadow.set(`af_database_blob_epoch:${databaseId}`, version);
  });
  expect(await read(req)).toBeUndefined();
  donor.destroy();
});

test.each([1, 4] as const)(
  'untracked legacy object type %i cannot acquire baseline provenance from a request',
  async (type) => {
    const donor = document(type);
    const untracked = request(type, { databaseRestoreId: undefined });

    await persist(donor, untracked);
    expect(await read(request(type))).toBeUndefined();
    expect(shadow.size).toBe(0);
    donor.destroy();
  }
);

test('source byte budget rejects an oversized stored update before Yjs decoding', async () => {
  const donor = document();
  const req = request();

  await persist(donor, req, [new Uint8Array(REPAIR_MAX_SOURCE_BYTES + 1)]);
  const apply = jest.spyOn(Y, 'applyUpdate');

  await expect(read(req)).rejects.toThrow('read budget');
  expect(apply).not.toHaveBeenCalled();
  donor.destroy();
});

test('a donor missing a predecessor is not donated or modified', async () => {
  const donor = document();
  const foreign = new Y.Doc();
  const foreignText = foreign.getText('unrelated');

  foreignText.insert(0, 'missing');
  const before = Y.encodeStateVector(foreign);

  foreignText.insert(7, 'dependent');
  const dependent = Y.encodeStateAsUpdate(foreign, before);

  Y.applyUpdate(donor, dependent);
  expect(donor.store.pendingStructs).not.toBeNull();
  await persist(donor, request());
  expect(await read(request())).toBeUndefined();
  expect(await read(request())).toBeUndefined();
  expect(donor.store.pendingStructs).not.toBeNull();
  donor.destroy();
  foreign.destroy();
});

test('an unresolved deletion set is not donated', async () => {
  const donor = document();
  const foreign = new Y.Doc();

  foreign.getText('foreign').insert(0, 'missing');
  const before = Y.encodeStateVector(foreign);

  foreign.getText('foreign').delete(0, 7);
  Y.applyUpdate(donor, Y.encodeStateAsUpdate(foreign, before));
  expect(donor.store.pendingDs).not.toBeNull();
  await persist(donor, request());
  expect(await read(request())).toBeUndefined();
  donor.destroy();
  foreign.destroy();
});

test('elapsed replay deadline prevents a late response even before its abort timer fires', async () => {
  const donor = document();

  await persist(donor, request());
  let elapsed = 0;
  const apply = Y.applyUpdate;

  jest.spyOn(performance, 'now').mockImplementation(() => elapsed);
  jest.spyOn(Y, 'applyUpdate').mockImplementation((...args) => {
    apply(...args);
    elapsed = 3001;
  });
  await expect(read(request())).rejects.toThrow('deadline');
  donor.destroy();
});
