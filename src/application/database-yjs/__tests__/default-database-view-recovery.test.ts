import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'v8';
import * as Y from 'yjs';

import { db } from '@/application/db';
import { AtomicCreationPendingError } from '@/application/atomic-creation/journal';
import { CreateDefaultDatabaseViewRequest } from '@/application/atomic-creation/types';
import { waitForCreatedDatabaseView } from '@/application/database-yjs/creation/created-view-readiness';
import { createDefaultDatabaseView } from '@/application/database-yjs/creation/create-default-view';
import { readPersistedDatabaseSource } from '@/application/database-yjs/creation/source-readiness';
import { atomicRead, postAtomicCreation } from '@/application/services/js-services/http/atomic-creation-api';
import { readCollabStates } from '@/application/services/js-services/http/collab-api';
import { DatabaseViewLayout, Types, ViewLayout, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

const mockCurrent = jest.fn();
jest.mock('@/application/atomic-creation/owner', () => ({
  captureAtomicCreationOwner: (_workspace: string, guard: () => void) => ({
    serverUrl: 'https://test.appflowy.cloud', userId: 'user', workspaceId: 'workspace',
    assertCurrent: () => { mockCurrent(); guard(); },
  }),
  assertAtomicCreationAvailable: (owner: { assertCurrent(): void }) => owner.assertCurrent(),
}));
jest.mock('@/application/db', () => ({
  ...jest.requireActual('@/application/db'),
  captureDatabaseStorageFence: jest.fn(async () => ({ databaseId: 'db', epoch: null, cacheEpoch: null })),
  matchesDatabaseStorageFence: jest.fn(async () => true),
  publishWithDatabaseStorageFence: jest.fn(async (_fence: unknown, publish: () => void) => { publish(); return true; }),
}));
jest.mock('@/application/db/database-storage-fence', () => ({
  ...jest.requireActual('@/application/db/database-storage-fence'),
  isDatabaseStorageFenceCurrent: () => true,
  withDatabaseStorageFence: (_doc: unknown, _fence: unknown, publish: () => void) => publish(),
}));
jest.mock('@/application/services/js-services/http/atomic-creation-api', () => ({
  atomicRead: jest.fn(), postAtomicCreation: jest.fn(),
}));
jest.mock('@/application/services/js-services/http/collab-api', () => ({ readCollabStates: jest.fn() }));
jest.mock('@/application/database-yjs/creation/source-readiness', () => ({
  ...jest.requireActual('@/application/database-yjs/creation/source-readiness'), readPersistedDatabaseSource: jest.fn(),
}));

function fixture() {
  const doc = new Y.Doc({ guid: 'db' }) as YDoc;
  const root = new Y.Map();

  root.set(YjsDatabaseKey.id, 'db');
  root.set(YjsDatabaseKey.views, new Y.Map());
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, root);
  const remote = new Y.Doc();

  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const folder = new Map<string, unknown>();
  const activate = jest.fn(async () => undefined);
  let posted = false;

  jest.mocked(readPersistedDatabaseSource).mockImplementation(async () => Y.encodeStateAsUpdate(doc));
  jest.mocked(readCollabStates).mockImplementation(async () => [{ objectId: 'db', collabType: Types.Database,
    missingUpdate: Y.encodeStateAsUpdate(remote), serverStateVector: Y.encodeStateVector(remote) }]);
  jest.mocked(atomicRead).mockImplementation(async (_owner, url) => url.endsWith('/restore-state')
    ? { database_restore_id: null, version: null } as never : folder.get(url.split('/').pop()!) as never);
  const publish = (request: CreateDefaultDatabaseViewRequest) => {
    posted = true;
    const view = new Y.Map();

    view.set(YjsDatabaseKey.id, request.view.view_id);
    view.set(YjsDatabaseKey.database_id, 'db');
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
    (remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
      .get(YjsDatabaseKey.views).set(request.view.view_id, view as never);
    folder.set(request.view.view_id, { view_id: request.view.view_id, parent_view_id: 'parent',
      layout: ViewLayout.Grid, extra: { database_id: 'db' } });
    return { request_id: request.request_id, outcome: 'applied', result: {
      view_id: request.view.view_id, view_ids: [request.view.view_id], database_id: 'db',
      database_restore_id: request.database_restore_id, database_version: null,
      database_update_v1: 'AAA=', update_batch_id: '00000000-0000-4000-8000-000000000001',
    } };
  };

  jest.mocked(postAtomicCreation).mockImplementation(async (_owner, _kind, json) => publish(JSON.parse(json)) as never);
  return { doc, remote, folder, activate, publish, isPosted: () => posted,
    intent: { workspaceId: 'workspace', databaseDoc: doc, databaseId: 'db', parentViewId: 'parent',
      layout: DatabaseViewLayout.Grid, name: 'Grid', embedded: false, activate } };
}

beforeAll(() => Object.assign(globalThis, { structuredClone: (value: unknown) => deserialize(serialize(value)) }));
beforeEach(async () => {
  jest.clearAllMocks();
  mockCurrent.mockReset();
  await db.open();
  await db.atomic_creation.clear();
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
afterAll(() => db.close());

it('opens a view acknowledged near the write deadline without resubmitting its committed command', async () => {
  const f = fixture();
  let now = 1_000;

  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.mocked(postAtomicCreation).mockImplementation(async (_owner, _kind, json) => {
    now += 28_000;
    return f.publish(JSON.parse(json)) as never;
  });
  const read = jest.mocked(readCollabStates).getMockImplementation()!;

  jest.mocked(readCollabStates).mockImplementation(async (...args) => {
    if (f.isPosted()) now += 3_000;
    return read(...args);
  });
  const viewId = await createDefaultDatabaseView(f.intent);

  expect(f.activate).toHaveBeenCalledWith(viewId);
  expect(postAtomicCreation).toHaveBeenCalledTimes(1);
  expect(await db.atomic_creation.count()).toBe(0);
  f.doc.destroy(); f.remote.destroy();
});


it('waits for the created identity after ACK instead of accepting only the pre-create source', async () => {
  const f = fixture();
  const before = Y.encodeStateAsUpdate(f.remote);
  const beforeVector = Y.encodeStateVector(f.remote);
  const read = jest.mocked(readCollabStates).getMockImplementation()!;
  let committedReads = 0;

  jest.mocked(readCollabStates).mockImplementation(async (...args) => {
    if (f.isPosted() && ++committedReads === 1) return [{ objectId: 'db', collabType: Types.Database,
      missingUpdate: before, serverStateVector: beforeVector }];
    return read(...args);
  });
  const viewId = await createDefaultDatabaseView(f.intent);

  expect(committedReads).toBe(2);
  expect(f.activate).toHaveBeenCalledWith(viewId);
  expect(postAtomicCreation).toHaveBeenCalledTimes(1);
  expect(await db.atomic_creation.count()).toBe(0);
  f.doc.destroy(); f.remote.destroy();
});

it.each([-5, 1079, -2])('retries transient current-read code %s after ACK without another POST', async (code) => {
  const f = fixture();
  const read = jest.mocked(readCollabStates).getMockImplementation()!;
  let committedReads = 0;

  jest.mocked(readCollabStates).mockImplementation(async (...args) => {
    if (f.isPosted() && ++committedReads === 1) throw { code };
    return read(...args);
  });
  const viewId = await createDefaultDatabaseView(f.intent);

  expect(committedReads).toBe(2);
  expect(f.activate).toHaveBeenCalledWith(viewId);
  expect(postAtomicCreation).toHaveBeenCalledTimes(1);
  f.doc.destroy(); f.remote.destroy();
});

it('retains the receipt when its read-only budget expires and an explicit retry sends no POST', async () => {
  const f = fixture();
  let now = 1_000;
  const read = jest.mocked(readCollabStates).getMockImplementation()!;

  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.mocked(readCollabStates).mockImplementation(async (...args) => {
    if (f.isPosted()) now += 10_001;
    return read(...args);
  });
  const failure = await createDefaultDatabaseView(f.intent).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(AtomicCreationPendingError);
  expect(failure).toMatchObject({ committed: true, user_error: { reason: 'ATOMIC_CREATION_COMMITTED' } });
  expect(f.activate).not.toHaveBeenCalled();
  const [record] = await db.atomic_creation.toArray();
  const command = JSON.parse(record.requestJson) as CreateDefaultDatabaseViewRequest;

  expect(record.state).toBe('committed');
  jest.mocked(readCollabStates).mockImplementation(read);
  await expect(createDefaultDatabaseView(f.intent)).resolves.toBe(command.view.view_id);
  expect(postAtomicCreation).toHaveBeenCalledTimes(1);
  expect(await db.atomic_creation.count()).toBe(0);
  f.doc.destroy(); f.remote.destroy();
});

it('does not revive a write whose ACK arrives after its deadline, but retains the receipt', async () => {
  const f = fixture();
  let now = 1_000;

  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.mocked(postAtomicCreation).mockImplementation(async (_owner, _kind, json) => {
    now += 30_001;
    return f.publish(JSON.parse(json)) as never;
  });
  await expect(createDefaultDatabaseView(f.intent)).rejects.toMatchObject({ committed: true });
  expect(f.activate).not.toHaveBeenCalled();
  expect(readCollabStates).toHaveBeenCalledTimes(1);
  expect((await db.atomic_creation.toArray())[0].state).toBe('committed');
  // A later explicit opening has a new read budget and uses the retained receipt.
  await createDefaultDatabaseView(f.intent);
  expect(postAtomicCreation).toHaveBeenCalledTimes(1);
  expect(f.activate).toHaveBeenCalledTimes(1);
  f.doc.destroy(); f.remote.destroy();
});

it('retains an unknown-outcome command and explicit retry reuses its exact bytes', async () => {
  const f = fixture();
  const post = jest.mocked(postAtomicCreation).getMockImplementation()!;

  jest.mocked(postAtomicCreation).mockRejectedValueOnce(new Error('ACK lost'));
  await expect(createDefaultDatabaseView(f.intent)).rejects.toMatchObject({ committed: false,
    user_error: { reason: 'ATOMIC_CREATION_PENDING' } });
  const [record] = await db.atomic_creation.toArray();

  expect(record.state).toBe('pending');
  jest.mocked(postAtomicCreation).mockImplementation(post);
  await createDefaultDatabaseView(f.intent);
  expect(postAtomicCreation).toHaveBeenCalledTimes(2);
  expect(jest.mocked(postAtomicCreation).mock.calls.map((call) => call[2])).toEqual([record.requestJson, record.requestJson]);
  f.doc.destroy(); f.remote.destroy();
});

it.each(['access', 'parent', 'restore', 'owner'] as const)('does not retry or activate a permanent %s failure after ACK', async (failure) => {
  const f = fixture();
  const read = jest.mocked(readCollabStates).getMockImplementation()!;
  const atomic = jest.mocked(atomicRead).getMockImplementation()!;
  let committedReads = 0;

  jest.mocked(readCollabStates).mockImplementation(async (...args) => {
    if (f.isPosted()) {
      committedReads += 1;
      if (failure === 'access') throw { code: 1004 };
      if (failure === 'owner') f.doc.destroy();
    }
    return read(...args);
  });
  jest.mocked(atomicRead).mockImplementation(async (...args) => {
    const value = await atomic(...args) as Record<string, unknown>;

    if (f.isPosted() && args[1].endsWith('/restore-state') && failure === 'restore') {
      return { ...value, database_restore_id: '00000000-0000-4000-8000-000000000099' } as never;
    }
    if (f.isPosted() && !args[1].endsWith('/restore-state') && failure === 'parent') {
      return { ...value, parent_view_id: 'another-parent' } as never;
    }
    return value as never;
  });
  await expect(createDefaultDatabaseView(f.intent)).rejects.toMatchObject({ committed: true });
  expect(committedReads).toBeLessThanOrEqual(1);
  expect(postAtomicCreation).toHaveBeenCalledTimes(1);
  expect(f.activate).not.toHaveBeenCalled();
  f.doc.destroy(); f.remote.destroy();
});


it('cancels a paired source read before retrying a transient Folder failure', async () => {
  const f = fixture();
  const read = jest.mocked(readCollabStates).getMockImplementation()!;
  const atomic = jest.mocked(atomicRead).getMockImplementation()!;
  let releaseEntered!: () => void;
  const entered = new Promise<void>((resolve) => { releaseEntered = resolve; });
  let active = 0;
  let maxActive = 0;
  let cancelled = false;
  let folderReads = 0;

  jest.mocked(readCollabStates).mockImplementation(async (...args) => {
    if (!f.isPosted()) return read(...args);
    active += 1;
    maxActive = Math.max(active, maxActive);
    try {
      if (!cancelled) {
        const signal = args[2]!.signal!;

        releaseEntered();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true });
        });
      }
      return await read(...args);
    } finally { active -= 1; }
  });
  jest.mocked(atomicRead).mockImplementation(async (...args) => {
    if (f.isPosted() && !args[1].endsWith('/restore-state') && ++folderReads === 1) {
      await entered;
      throw { code: -5 };
    }
    return atomic(...args);
  });
  const viewId = await createDefaultDatabaseView(f.intent);

  expect(cancelled).toBe(true);
  expect(active).toBe(0);
  expect(maxActive).toBe(1);
  expect(folderReads).toBe(2);
  expect(f.activate).toHaveBeenCalledWith(viewId);
  expect(postAtomicCreation).toHaveBeenCalledTimes(1);
  f.doc.destroy(); f.remote.destroy();
});


it('honors the server read-admission retry delay before another hydration read', async () => {
  jest.useFakeTimers();
  const read = jest.fn().mockRejectedValueOnce({ code: 1079, retryAfterSecs: 3 }).mockResolvedValue('ready');
  const ready = waitForCreatedDatabaseView({ read, assertCurrent: jest.fn(),
    signal: new AbortController().signal, deadline: Date.now() + 10_000 });

  await jest.advanceTimersByTimeAsync(2_999);
  expect(read).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  await expect(ready).resolves.toBe('ready');
  expect(read).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

it('expires its read budget without another GET when the server retry delay exceeds it', async () => {
  jest.useFakeTimers();
  const read = jest.fn().mockRejectedValue({ code: -5, retryAfterSecs: 20 });
  const ready = waitForCreatedDatabaseView({ read, assertCurrent: jest.fn(),
    signal: new AbortController().signal, deadline: Date.now() + 10_000 });
  const rejected = expect(ready).rejects.toThrow('not readable yet');

  await jest.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(read).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
