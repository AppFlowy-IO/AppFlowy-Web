import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { openRowCollabDBWithProvider } from '@/application/db';
import { collabFullSyncBatch } from '@/application/services/js-services/http/http_api';
import { Types, YDoc } from '@/application/types';

import { DatabaseRestoreTracker } from '../databaseRestoreState';
import { useSyncRefs } from '../syncRefs';
import { useBatchSync } from '../useBatchSync';

jest.mock('@/application/db', () => ({
  listCollabIndexedDBNames: async () => new Set(), collabIndexedDBExists: async () => false,
  openRowCollabDBWithProvider: jest.fn(), openCollabDBWithProvider: jest.fn(),
}));
jest.mock('@/application/services/js-services/cache', () => ({
  getCachedRowSubDocIds: () => [], getCachedRowSubDoc: jest.fn(),
  awaitPendingRowDocEnsures: jest.fn(), mergeLegacyRowDocIfExists: jest.fn(),
}));
jest.mock('@/application/services/js-services/http/http_api', () => ({ collabFullSyncBatch: jest.fn() }));
jest.mock('@/application/services/js-services/http/core', () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(), handleAPIError: jest.fn(),
}));
jest.mock('@/application/sync-outbox', () => ({ waitForDrain: async () => true }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(collabFullSyncBatch).mockResolvedValue([]);
});

test.each([true, false])('HTTP batch emits explicit baseline only when database history is enabled: %s', async (enabled) => {
  const doc: YDoc = new Y.Doc({ guid: 'row' });
  const guard = jest.fn(async () => true);
  const { result } = renderHook(() => {
    const refs = useSyncRefs();

    refs.registeredContexts.current.set('row', { doc, collabType: Types.DatabaseRow, emit: jest.fn() });
    return useBatchSync(refs, { beforeSend: guard, databaseHistoryEnabled: enabled });
  });

  await act(async () => { await result.current.syncAllToServer('workspace'); });
  const row = jest.mocked(collabFullSyncBatch).mock.calls[0][1][0];

  expect(row.databaseRestoreId).toBe(enabled ? '00000000-0000-0000-0000-000000000000' : undefined);
  doc.destroy();
});

test('unregistered row bytes retain their captured generation when root replacement races an IndexedDB open', async () => {
  const root: YDoc = new Y.Doc({ guid: 'database' });
  const rowDoc: YDoc = new Y.Doc({ guid: 'row' });
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();

  root.databaseRestoreId = 'before-restore';
  view.set('row_orders', Y.Array.from([{ id: 'row' }]));
  views.set('view', view);
  database.set('views', views);
  database.set('id', 'database');
  root.getMap('data').set('database', database);
  rowDoc.getMap('data').set('data', new Y.Map());
  let finishOpen!: (value: Awaited<ReturnType<typeof openRowCollabDBWithProvider>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof openRowCollabDBWithProvider>>>((resolve) => { finishOpen = resolve; });

  jest.mocked(openRowCollabDBWithProvider).mockReturnValue(pending);
  const { result } = renderHook(() => {
    const refs = useSyncRefs();

    refs.registeredContexts.current.set('database', { doc: root, collabType: Types.Database, emit: jest.fn() });
    return useBatchSync(refs, { beforeSend: async () => true, databaseHistoryEnabled: true });
  });
  let sync!: Promise<void>;

  await act(async () => { sync = result.current.syncAllToServer('workspace'); });
  expect(openRowCollabDBWithProvider).toHaveBeenCalled();
  root.databaseRestoreId = 'after-restore';
  await act(async () => {
    finishOpen({ doc: rowDoc, provider: { destroy: async () => undefined } } as never);
    await sync;
  });
  const row = jest.mocked(collabFullSyncBatch).mock.calls[0][1].find((item) => item.objectId === 'row');

  expect(row?.databaseRestoreId).toBe('before-restore');
  root.destroy();
});

test('coalesces restore checks per database before sending and applying a multi-row batch', async () => {
  const docs = ['a:1', 'a:2', 'a:3', 'b:1', 'b:2'].map((guid) => new Y.Doc({ guid }));
  const readState = jest.fn(async () => ({ database_restore_id: null, version: null }));
  const tracker = new DatabaseRestoreTracker('batch-test:', readState, jest.fn(), localStorage);
  const beforeSend = jest.fn((objectId: string) => tracker.check(objectId.split(':')[0]));
  const serverDocs = docs.map((doc) => {
    const server = new Y.Doc({ guid: doc.guid });

    server.getMap('values').set('title', doc.guid);
    return server;
  });

  jest.mocked(collabFullSyncBatch).mockImplementation(async (_workspaceId, items) => {
    expect(readState).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.objectId)).toEqual(docs.map((doc) => doc.guid));
    return serverDocs.map((doc) => ({
      objectId: doc.guid, collabType: Types.DatabaseRow,
      missingUpdate: Y.encodeStateAsUpdate(doc), serverStateVector: Y.encodeStateVector(doc),
    }));
  });
  const { result, unmount } = renderHook(() => {
    const refs = useSyncRefs();

    for (const doc of docs) {
      refs.registeredContexts.current.set(doc.guid, { doc, collabType: Types.DatabaseRow, emit: jest.fn() });
    }

    return useBatchSync(refs, { beforeSend, databaseHistoryEnabled: true });
  });

  await act(async () => { await result.current.syncAllToServer('workspace'); });
  expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
  expect(readState).toHaveBeenCalledTimes(4);
  expect(beforeSend).toHaveBeenCalledTimes(docs.length * 2);
  docs.forEach((doc) => expect(doc.getMap('values').get('title')).toBe(doc.guid));
  unmount();
  [...docs, ...serverDocs].forEach((doc) => doc.destroy());
});

test('concurrent batch guards still reject captured generations before sending and applying', async () => {
  const docs: YDoc[] = ['stale', 'current', 'restored-in-flight'].map((guid) => new Y.Doc({ guid }));
  const server = new Y.Doc();

  server.getMap('values').set('fromServer', true);
  docs.forEach((doc) => { doc.databaseRestoreId = doc.guid === 'stale' ? 'old' : 'R'; });
  let responded = false;
  const beforeSend = jest.fn(async (objectId: string, _type: Types, marker?: string) =>
    marker === 'R' && !(responded && objectId === 'restored-in-flight'));

  jest.mocked(collabFullSyncBatch).mockImplementation(async (_workspaceId, items) => {
    responded = true;
    return items.map((item) => ({
      objectId: item.objectId, collabType: item.collabType,
      missingUpdate: Y.encodeStateAsUpdate(server), serverStateVector: Y.encodeStateVector(server),
    }));
  });
  const { result, unmount } = renderHook(() => {
    const refs = useSyncRefs();

    docs.forEach((doc) => refs.registeredContexts.current.set(doc.guid,
      { doc, collabType: Types.DatabaseRow, emit: jest.fn() }));
    return useBatchSync(refs, { beforeSend, databaseHistoryEnabled: true });
  });

  await act(async () => { await result.current.syncAllToServer('workspace'); });
  expect(jest.mocked(collabFullSyncBatch).mock.calls[0][1].map((item) => item.objectId))
    .toEqual(['current', 'restored-in-flight']);
  expect(docs[0].getMap('values').has('fromServer')).toBe(false);
  expect(docs[1].getMap('values').get('fromServer')).toBe(true);
  expect(docs[2].getMap('values').has('fromServer')).toBe(false);
  unmount();
  [...docs, server].forEach((doc) => doc.destroy());
});
