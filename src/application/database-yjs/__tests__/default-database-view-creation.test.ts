import * as Y from 'yjs';

import { createDefaultDatabaseView } from '@/application/database-yjs/creation/create-default-view';
import { DatabaseViewLayout, Types, ViewLayout, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { atomicRead, findPendingAtomicCreation, recoverAtomicCreation, runAtomicCreation } from '@/application/atomic-creation';
import { collabFullSyncBatch } from '@/application/services/js-services/http/collab-api';
import { readPersistedDatabaseSource } from '@/application/database-yjs/creation/source-readiness';

const mockCurrent = jest.fn();
const mockAvailable = jest.fn();
jest.mock('@/application/atomic-creation', () => ({
  captureAtomicCreationOwner: (_workspace: string, guard: () => void) => ({ assertCurrent: () => { mockCurrent(); guard(); } }),
  assertAtomicCreationAvailable: () => mockAvailable(), atomicRead: jest.fn(), findPendingAtomicCreation: jest.fn(),
  parseAtomicCreationRequest: (record: { requestJson: string }) => JSON.parse(record.requestJson),
  runAtomicCreation: jest.fn(), recoverAtomicCreation: jest.fn(),
}));
jest.mock('@/application/db', () => ({
  captureDatabaseStorageFence: jest.fn(async () => ({ databaseId: 'db', epoch: null, cacheEpoch: null })),
  matchesDatabaseStorageFence: jest.fn(async () => true),
  publishWithDatabaseStorageFence: jest.fn(async (_fence: unknown, publish: () => void) => { publish(); return true; }),
}));
jest.mock('@/application/db/database-storage-fence', () => ({
  isDatabaseStorageFenceCurrent: () => true,
  withDatabaseStorageFence: (_doc: unknown, _fence: unknown, publish: () => void) => publish(),
}));
jest.mock('@/application/services/js-services/http/collab-api', () => ({ collabFullSyncBatch: jest.fn() }));
jest.mock('@/application/database-yjs/creation/source-readiness', () => ({
  ...jest.requireActual('@/application/database-yjs/creation/source-readiness'), readPersistedDatabaseSource: jest.fn(),
}));

function fixture() {
  const doc = new Y.Doc({ guid: 'db' }) as YDoc;
  const root = new Y.Map();
  const views = new Y.Map();
  const source = new Y.Map();

  root.set(YjsDatabaseKey.id, 'db');
  source.set(YjsDatabaseKey.id, 'source');
  source.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  source.set('filters', 'original');
  views.set('source', source);
  root.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, root);
  const remote = new Y.Doc();

  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  jest.mocked(readPersistedDatabaseSource).mockImplementation(async () => Y.encodeStateAsUpdate(doc));
  jest.mocked(collabFullSyncBatch).mockImplementation(async () => [{ objectId: 'db', collabType: Types.Database,
    missingUpdate: Y.encodeStateAsUpdate(remote), serverStateVector: Y.encodeStateVector(remote) }]);
  const folder = new Map<string, { view_id: string; parent_view_id: string; layout: ViewLayout; extra: { database_id: string } }>();

  jest.mocked(atomicRead).mockImplementation(async (_owner, url) => {
    if (url.endsWith('restore-state')) return { database_restore_id: null, version: null } as never;
    return folder.get(url.split('/').pop() ?? '') as never;
  });
  const publish = (request: { view: { view_id: string; responses_view_id: string | null; layout: DatabaseViewLayout } }) => {
    const database = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    [request.view.view_id, request.view.responses_view_id].filter(Boolean).forEach((id, index) => {
      const view = new Y.Map();
      const layout = index ? DatabaseViewLayout.Grid : request.view.layout;

      view.set(YjsDatabaseKey.id, id);
      view.set(YjsDatabaseKey.database_id, 'db');
      view.set(YjsDatabaseKey.layout, layout);
      view.set('filters', 'server-current');
      database.get(YjsDatabaseKey.views).set(id as string, view as never);
      folder.set(id as string, { view_id: id as string, parent_view_id: 'parent', extra: { database_id: 'db' },
        layout: [ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar, ViewLayout.Chart, ViewLayout.List,
          ViewLayout.Gallery, ViewLayout.Feed, ViewLayout.Form, ViewLayout.Timeline][layout] });
    });
  };
  const activate = jest.fn(async () => undefined);
  const intent = { workspaceId: 'workspace', databaseDoc: doc, databaseId: 'db', parentViewId: 'parent',
    layout: DatabaseViewLayout.Grid, name: 'Created', embedded: false, activate };

  return { doc, remote, folder, publish, activate, intent };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrent.mockReset(); mockAvailable.mockReset();
  jest.mocked(findPendingAtomicCreation).mockResolvedValue(undefined);
});

it.each([DatabaseViewLayout.Grid, DatabaseViewLayout.Board, DatabaseViewLayout.Calendar, DatabaseViewLayout.Chart,
  DatabaseViewLayout.List, DatabaseViewLayout.Gallery, DatabaseViewLayout.Feed, DatabaseViewLayout.Form,
  DatabaseViewLayout.Timeline])('leaves layout %s materialization to the server without a local creation write', async (layout) => {
  const f = fixture();
  const original = Y.encodeStateAsUpdate(f.doc);

  jest.mocked(runAtomicCreation).mockImplementation(async (options) => {
    await options.beforeSubmit?.({} as never);
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(original);
    expect(JSON.stringify(options.request)).not.toMatch(/encoded_collab|doc_state|field_settings|layout_settings|filters|group_settings/);
    f.publish(options.request as Parameters<typeof f.publish>[0]);
    return options.hydrate({} as never, {} as never);
  });
  const id = await createDefaultDatabaseView({ ...f.intent, layout });

  expect(runAtomicCreation).toHaveBeenCalledTimes(1);
  expect(f.activate).toHaveBeenCalledWith(id);
  expect((f.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
    .get(YjsDatabaseKey.views).get(id).get(YjsDatabaseKey.layout)).toBe(layout);
});

it('loads committed Folder metadata while the independent current-content read is held', async () => {
  const f = fixture();
  let entered!: () => void;
  let release!: () => void;
  const sourceEntered = new Promise<void>((resolve) => { entered = resolve; });
  const sourceReleased = new Promise<void>((resolve) => { release = resolve; });
  const read = jest.mocked(collabFullSyncBatch).getMockImplementation()!;
  let reads = 0;

  jest.mocked(collabFullSyncBatch).mockImplementation(async (...args) => {
    if (++reads === 2) { entered(); await sourceReleased; }
    return read(...args);
  });
  jest.mocked(runAtomicCreation).mockImplementation(async (options) => {
    await options.beforeSubmit?.({} as never);
    f.publish(options.request as Parameters<typeof f.publish>[0]);
    return options.hydrate({} as never, {} as never);
  });
  const creation = createDefaultDatabaseView(f.intent);

  await sourceEntered;
  const folderReadStarted = jest.mocked(atomicRead).mock.calls.some(([, url]) => url.includes('/view/'));

  expect(f.activate).not.toHaveBeenCalled();
  release();
  await creation;
  expect(folderReadStarted).toBe(true);
});

it('creates a compact Form/Responses graph and selects only after current Folder/content hydration', async () => {
  const f = fixture();

  jest.mocked(runAtomicCreation).mockImplementation(async (options) => {
    expect(f.activate).not.toHaveBeenCalled();
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);
    await options.beforeSubmit?.({ assertCurrent: mockCurrent } as never);
    const request = options.request as Parameters<typeof f.publish>[0];

    f.publish(request);
    return options.hydrate({} as never, {} as never);
  });
  const id = await createDefaultDatabaseView({ ...f.intent, layout: DatabaseViewLayout.Form });
  const request = jest.mocked(runAtomicCreation).mock.calls[0][0].request;

  expect(request).toMatchObject({ schema_version: 'v1', database_restore_id: '00000000-0000-0000-0000-000000000000',
    view: { layout: DatabaseViewLayout.Form, source_view_id: null, timezone_id: null } });
  expect(JSON.stringify(request)).not.toContain('filters');
  expect(f.folder.size).toBe(2);
  expect(collabFullSyncBatch).toHaveBeenCalledWith('workspace', expect.any(Array),
    expect.objectContaining({ atomicCreationOwner: expect.objectContaining({ assertCurrent: expect.any(Function) }) }));
  expect(f.activate).toHaveBeenCalledWith(id);
  const database = f.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  expect(database.get(YjsDatabaseKey.views).get(id).get('filters' as never)).toBe('server-current');
});

it('reuses the exact committed request and hydrates later edits without a new POST or recipe', async () => {
  const f = fixture();
  const request = { schema_version: 'v1', request_id: 'original-request', database_restore_id: '00000000-0000-0000-0000-000000000000',
    view: { database_id: 'db', view_id: 'original-view', responses_view_id: null, parent_view_id: 'parent',
      source_view_id: 'source', layout: DatabaseViewLayout.Grid, name: 'Created', embedded: false, timezone_id: null } };

  f.publish(request);
  const record = { requestJson: JSON.stringify(request), state: 'committed' };

  jest.mocked(findPendingAtomicCreation).mockResolvedValue(record as never);
  mockAvailable.mockImplementation(() => { throw new Error('capability now unavailable'); });
  jest.mocked(recoverAtomicCreation).mockImplementation(async (options) => options.hydrate({} as never, {} as never));
  await expect(createDefaultDatabaseView(f.intent)).resolves.toBe('original-view');
  expect(runAtomicCreation).not.toHaveBeenCalled();
  expect(mockAvailable).not.toHaveBeenCalled();
  expect(jest.mocked(recoverAtomicCreation).mock.calls[0][0].record).toBe(record);
});

it('refuses a current Folder mismatch without canonical mutation or compensating deletion', async () => {
  const f = fixture();
  const before = Y.encodeStateAsUpdate(f.doc);

  jest.mocked(runAtomicCreation).mockImplementation(async (options) => {
    await options.beforeSubmit?.({} as never);
    f.publish(options.request as Parameters<typeof f.publish>[0]);
    f.folder.forEach((view) => { view.parent_view_id = 'other-parent'; });
    return options.hydrate({} as never, {} as never);
  });
  await expect(createDefaultDatabaseView(f.intent)).rejects.toThrow('Folder and content');
  expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
  expect(f.activate).not.toHaveBeenCalled();
});

it('fails before compact submission when a source response has another version', async () => {
  const f = fixture();

  jest.mocked(collabFullSyncBatch).mockResolvedValue([{ objectId: 'db', collabType: Types.Database,
    missingUpdate: Y.encodeStateAsUpdate(f.remote), serverStateVector: Y.encodeStateVector(f.remote), collabVersion: 'new' }]);
  const post = jest.fn();

  jest.mocked(runAtomicCreation).mockImplementation(async (options) => {
    await options.beforeSubmit?.({} as never);
    post();
    return options.hydrate({} as never, {} as never);
  });
  await expect(createDefaultDatabaseView(f.intent)).rejects.toThrow('version changed');
  expect(post).not.toHaveBeenCalled();
  expect(f.activate).not.toHaveBeenCalled();
});


it('retains later local edits while hydrating the current server result', async () => {
  const f = fixture();
  jest.mocked(runAtomicCreation).mockImplementation(async (options) => {
    await options.beforeSubmit?.({} as never);
    f.publish(options.request as Parameters<typeof f.publish>[0]);
    const database = f.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    database.get(YjsDatabaseKey.views).get('source').set(YjsDatabaseKey.name, 'edit after capture');
    return options.hydrate({} as never, {} as never);
  });
  await createDefaultDatabaseView(f.intent);
  const database = f.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  expect(database.get(YjsDatabaseKey.views).get('source').get(YjsDatabaseKey.name)).toBe('edit after capture');
});

it('does not publish or select after the live document is destroyed following the receipt', async () => {
  const f = fixture();
  const before = Y.encodeStateAsUpdate(f.doc);
  jest.mocked(runAtomicCreation).mockImplementation(async (options) => {
    await options.beforeSubmit?.({} as never);
    f.publish(options.request as Parameters<typeof f.publish>[0]);
    f.doc.destroy();
    return options.hydrate({} as never, {} as never);
  });
  await expect(createDefaultDatabaseView(f.intent)).rejects.toThrow('retired');
  expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
  expect(f.activate).not.toHaveBeenCalled();
});

it('refuses unavailable atomic capability before allocating a command or reading source bytes', async () => {
  const f = fixture();
  mockAvailable.mockImplementation(() => { throw new Error('upgrade server'); });
  await expect(createDefaultDatabaseView(f.intent)).rejects.toThrow('upgrade server');
  expect(runAtomicCreation).not.toHaveBeenCalled();
  expect(readPersistedDatabaseSource).not.toHaveBeenCalled();
  expect(collabFullSyncBatch).not.toHaveBeenCalled();
});


it.each(['folder', 'view'] as const)('refuses a current %s attached to another Database', async (target) => {
  const f = fixture();
  const before = Y.encodeStateAsUpdate(f.doc);

  jest.mocked(runAtomicCreation).mockImplementation(async (options) => {
    await options.beforeSubmit?.({} as never);
    const request = options.request as Parameters<typeof f.publish>[0];

    f.publish(request);
    if (target === 'folder') f.folder.get(request.view.view_id)!.extra.database_id = 'other-database';
    else {
      const root = f.remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

      root.get(YjsDatabaseKey.views).get(request.view.view_id).set(YjsDatabaseKey.database_id, 'other-database');
    }
    return options.hydrate({} as never, {} as never);
  });
  await expect(createDefaultDatabaseView(f.intent)).rejects.toThrow('Folder and content');
  expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
  expect(f.activate).not.toHaveBeenCalled();
});
