import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { openRowCollabDBWithProvider } from '@/application/db';
import { withRetry } from '@/application/services/js-services/http/core';
import { collabFullSyncBatch } from '@/application/services/js-services/http/http_api';
import { Types, YDoc, YjsEditorKey } from '@/application/types';

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
  withRetry: jest.fn((fn: () => Promise<unknown>) => fn()), handleAPIError: jest.fn(),
}));
jest.mock('@/application/sync-outbox', () => ({ waitForDrain: async () => true }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(collabFullSyncBatch).mockResolvedValue([]);
  jest.mocked(withRetry).mockImplementation((fn) => fn());
});
afterEach(() => jest.useRealTimers());

test.each([false, true])('overlapping explicit syncs share an upload unless newer edits require another: %s', async (edit) => {
  const doc: YDoc = new Y.Doc({ guid: 'document' });
  let finish!: () => void;

  jest.mocked(collabFullSyncBatch).mockImplementationOnce(() => new Promise((resolve) => {
    finish = () => resolve([]);
  }));
  const { result, unmount } = renderHook(() => {
    const refs = useSyncRefs();

    refs.registeredContexts.current.set(doc.guid, { doc, collabType: Types.Document, emit: jest.fn() });
    return useBatchSync(refs, { workspaceId: 'workspace', wsReadyState: 1 });
  });
  let first!: Promise<void>;
  let second!: Promise<void>;

  await act(async () => { first = result.current.syncAllToServer('workspace'); });
  expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
  await act(async () => {
    if (edit) {
      doc.getMap('data').set('latest', 'edit');
      result.current.notifyLocalEdit(doc.guid);
    }

    second = result.current.syncAllToServer('workspace');
  });
  expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
  if (!edit) expect(second).toBe(first);
  await act(async () => { finish(); await Promise.all([first, second]); });
  expect(collabFullSyncBatch).toHaveBeenCalledTimes(edit ? 2 : 1);
  if (edit) {
    const sent = new Y.Doc();

    Y.applyUpdate(sent, jest.mocked(collabFullSyncBatch).mock.calls[1][1][0].docState);
    expect(sent.getMap('data').get('latest')).toBe('edit');
    sent.destroy();
  }

  unmount();
  doc.destroy();
});

test.each(['request', 'restore guard'])('reconnecting cancels fallback at the %s boundary', async (boundary) => {
  jest.useFakeTimers();
  const doc: YDoc = new Y.Doc({ guid: 'database' });
  let releaseGuard!: (allowed: boolean) => void;
  const beforeSend = boundary === 'restore guard'
    ? jest.fn(() => new Promise<boolean>((resolve) => { releaseGuard = resolve; })) : undefined;
  let signal: AbortSignal | undefined;

  jest.mocked(collabFullSyncBatch).mockImplementation((_workspace, _items, options) => {
    signal = options?.signal;
    return new Promise((resolve) => signal?.addEventListener('abort', () => resolve([]), { once: true }));
  });
  const { result, rerender, unmount } = renderHook(({ readyState }) => {
    const refs = useSyncRefs();

    refs.registeredContexts.current.set(doc.guid, { doc, collabType: Types.Database, emit: jest.fn() });
    return useBatchSync(refs, { workspaceId: 'workspace', wsReadyState: readyState, beforeSend });
  }, { initialProps: { readyState: 1 } });

  result.current.notifyLocalEdit(doc.guid);
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(collabFullSyncBatch).not.toHaveBeenCalled();
  rerender({ readyState: 3 });
  await act(async () => { jest.advanceTimersByTime(5000); });
  if (boundary === 'request') expect(signal?.aborted).toBe(false);
  else expect(beforeSend).toHaveBeenCalledTimes(1);
  rerender({ readyState: 1 });
  await act(async () => { releaseGuard?.(true); });
  if (boundary === 'request') expect(signal?.aborted).toBe(true);
  else expect(collabFullSyncBatch).not.toHaveBeenCalled();
  unmount();
  doc.destroy();
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
  root.getMap(YjsEditorKey.data_section).set('database', database);
  rowDoc.getMap(YjsEditorKey.data_section).set('data', new Y.Map());
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
  const beforeSend = jest.fn((objectId: string) => tracker.checkIfStale(objectId.split(':')[0]));
  const serverDocs = docs.map((doc) => {
    const server = new Y.Doc({ guid: doc.guid });

    server.getMap(YjsEditorKey.data_section).set('title', doc.guid);
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
  expect(readState).toHaveBeenCalledTimes(2);
  expect(beforeSend).toHaveBeenCalledTimes(docs.length * 2);
  docs.forEach((doc) => expect(doc.getMap(YjsEditorKey.data_section).get('title')).toBe(doc.guid));
  unmount();
  [...docs, ...serverDocs].forEach((doc) => doc.destroy());
});

test.each([Types.Database, Types.DatabaseRow])('concurrent batch guards reject stale type %s before sending and applying', async (collabType) => {
  const docs: YDoc[] = ['stale', 'current', 'restored-in-flight'].map((guid) => new Y.Doc({ guid }));
  const server = new Y.Doc();

  server.getMap(YjsEditorKey.data_section).set('fromServer', true);
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
      { doc, collabType, emit: jest.fn() }));
    return useBatchSync(refs, { beforeSend, databaseHistoryEnabled: true });
  });

  await act(async () => { await result.current.syncAllToServer('workspace'); });
  expect(jest.mocked(collabFullSyncBatch).mock.calls[0][1].map((item) => item.objectId))
    .toEqual(['current', 'restored-in-flight']);
  expect(docs[0].getMap(YjsEditorKey.data_section).has('fromServer')).toBe(false);
  expect(docs[1].getMap(YjsEditorKey.data_section).get('fromServer')).toBe(true);
  expect(docs[2].getMap(YjsEditorKey.data_section).has('fromServer')).toBe(false);
  unmount();
  [...docs, server].forEach((doc) => doc.destroy());
});

test.each([Types.Database, Types.DatabaseRow])(
  'HTTP retries retire captured type %s bytes after restore and accept a fresh edit',
  async (collabType) => {
    const oldDoc: YDoc = new Y.Doc({ guid: 'database-collab' });
    const newDoc: YDoc = new Y.Doc({ guid: oldDoc.guid });
    let generation = 'old-generation';

    oldDoc.databaseRestoreId = generation;
    oldDoc.getMap(YjsEditorKey.data_section).set('title', 'old queued edit');
    newDoc.databaseRestoreId = 'restored-generation';
    newDoc.getMap(YjsEditorKey.data_section).set('title', 'fresh restored edit');
    const beforeSend = jest.fn(async (_id: string, _type: Types, marker?: string) => marker === generation);
    const { result, unmount } = renderHook(() => {
      const refs = useSyncRefs();

      return { refs, sync: useBatchSync(refs, { beforeSend, databaseHistoryEnabled: true }) };
    });

    result.current.refs.registeredContexts.current.set(oldDoc.guid, { doc: oldDoc, collabType, emit: jest.fn() });
    jest.mocked(collabFullSyncBatch).mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 503 }));
    // Model the normal HTTP retry boundary, with a peer restore while retry backoff is pending.
    jest.mocked(withRetry).mockImplementationOnce(async (send) => {
      try {
        return await send();
      } catch {
        generation = 'restored-generation';
        result.current.refs.registeredContexts.current.set(newDoc.guid, { doc: newDoc, collabType, emit: jest.fn() });
        return send();
      }
    });

    await act(async () => { await result.current.sync.syncAllToServer('workspace'); });
    expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
    expect(jest.mocked(collabFullSyncBatch).mock.calls[0][1][0].databaseRestoreId).toBe('old-generation');
    expect(beforeSend.mock.calls.filter(([, , marker]) => marker === 'old-generation')).toHaveLength(2);
    expect(newDoc.getMap(YjsEditorKey.data_section).get('title')).toBe('fresh restored edit');

    await act(async () => { await result.current.sync.syncAllToServer('workspace'); });
    expect(collabFullSyncBatch).toHaveBeenCalledTimes(2);
    const fresh = jest.mocked(collabFullSyncBatch).mock.calls[1][1][0];
    const server = new Y.Doc();

    Y.applyUpdate(server, fresh.docState);
    expect(fresh.databaseRestoreId).toBe('restored-generation');
    expect(server.getMap(YjsEditorKey.data_section).get('title')).toBe('fresh restored edit');
    unmount();
    [oldDoc, newDoc, server].forEach((doc) => doc.destroy());
  }
);

test.each([Types.Database, Types.DatabaseRow])(
  'a delayed admitted HTTP response cannot mutate a replacement type %s editor',
  async (collabType) => {
    const oldDoc: YDoc = new Y.Doc({ guid: 'database-collab' });
    const newDoc: YDoc = new Y.Doc({ guid: oldDoc.guid });
    const server = new Y.Doc();

    oldDoc.databaseRestoreId = 'old-generation';
    newDoc.databaseRestoreId = 'restored-generation';
    newDoc.getMap(YjsEditorKey.data_section).set('title', 'restored content');
    server.getMap(YjsEditorKey.data_section).set('old_response', 'must not resurrect');
    let release!: (allowed: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { release = resolve; });
    const beforeSend = jest.fn().mockResolvedValueOnce(true).mockReturnValueOnce(pending);

    jest.mocked(collabFullSyncBatch).mockResolvedValue([{
      objectId: oldDoc.guid, collabType,
      missingUpdate: Y.encodeStateAsUpdate(server), serverStateVector: Y.encodeStateVector(server),
    }]);
    const { result, unmount } = renderHook(() => {
      const refs = useSyncRefs();

      return { refs, sync: useBatchSync(refs, { beforeSend, databaseHistoryEnabled: true }) };
    });

    result.current.refs.registeredContexts.current.set(oldDoc.guid, { doc: oldDoc, collabType, emit: jest.fn() });
    let sync!: Promise<void>;

    await act(async () => { sync = result.current.sync.syncAllToServer('workspace'); });
    await waitFor(() => expect(beforeSend).toHaveBeenCalledTimes(2));
    await act(async () => {
      result.current.refs.registeredContexts.current.set(newDoc.guid, { doc: newDoc, collabType, emit: jest.fn() });
      release(true);
      await sync;
    });
    expect(newDoc.getMap(YjsEditorKey.data_section).get('title')).toBe('restored content');
    expect(newDoc.getMap(YjsEditorKey.data_section).has('old_response')).toBe(false);
    unmount();
    [oldDoc, newDoc, server].forEach((doc) => doc.destroy());
  }
);
