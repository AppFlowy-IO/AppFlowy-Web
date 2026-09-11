import EventEmitter from 'events';

import { act, renderHook } from '@testing-library/react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import * as Y from 'yjs';

import { invalidateDatabaseBlobAfterRestore, prefetchDatabaseBlobDiff } from '@/application/database-blob';
import { captureDatabaseStorageFence, db, deleteCollabDB, openCollabDB, openRowCollabDBWithProvider } from '@/application/db';
import { getDatabaseRestoreState } from '@/application/services/domains/database-history';
import { getCollab } from '@/application/services/js-services/http/collab-api';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import { Types, YDoc } from '@/application/types';

import { SyncRefs } from '../syncRefs';
import { useDatabaseHistoryRestoreSync } from '../useDatabaseHistoryRestoreSync';

jest.mock('@/application/database-blob', () => ({
  invalidateDatabaseBlobAfterRestore: jest.fn(), prefetchDatabaseBlobDiff: jest.fn(),
}));
jest.mock('@/application/db', () => ({
  db: { rows: { where: jest.fn(), filter: jest.fn() }, sync_outbox: { where: jest.fn() } }, deleteCollabDB: jest.fn(),
  openCollabDB: jest.fn(), openRowCollabDBWithProvider: jest.fn(), captureDatabaseStorageFence: jest.fn(),
}));
jest.mock('@/application/services/domains/database-history', () => ({ getDatabaseRestoreState: jest.fn() }));
jest.mock('@/application/services/js-services/http/collab-api', () => ({ getCollab: jest.fn() }));
jest.mock('@/application/services/js-services/http/cloud-config', () => ({ defaultConfig: { baseURL: 'server' } }));
jest.mock('@/application/services/js-services/cache', () => ({
  cacheCanonicalRowDoc: jest.fn(), getCachedDatabaseRowIds: () => ['row'],
  getCachedRowDatabaseId: () => 'database', invalidateDatabaseRowCache: jest.fn(),
}));
jest.mock('@/application/sync-outbox', () => ({ deleteOutboxByObjectId: jest.fn() }));

function fixture() {
  const root: YDoc = new Y.Doc({ guid: 'database' });
  const row: YDoc = new Y.Doc({ guid: 'row' });
  const document: YDoc = new Y.Doc({ guid: 'row-document' });
  const map = new Y.Map();

  map.set('database_id', 'database');
  row.getMap('data').set('data', map);
  const rootContext = { doc: root, collabType: Types.Database, emit: jest.fn(), _cleanup: jest.fn() };
  const rowContext = { doc: row, collabType: Types.DatabaseRow, emit: jest.fn(), _cleanup: jest.fn() };
  const documentContext = { doc: document, collabType: Types.Document, emit: jest.fn() };
  const contexts = new Map([['database', rootContext], ['row', rowContext], ['row-document', documentContext]]);
  const refs = {
    latestUserRef: { current: { uid: '42', uuid: 'user' } }, isDisposedRef: { current: false },
    registeredContexts: { current: contexts }, contextRefCounts: { current: new Map() },
    pendingCleanups: { current: new Map() }, resettingObjectIds: { current: new Set() },
    queuedMessagesDuringReset: { current: new Map([['row', [{}]]]) },
  } as unknown as SyncRefs;
  const register = jest.fn((context) => {
    const next = { ...context, emit: jest.fn() };

    contexts.set(context.doc.guid, next);
    return next;
  });
  const unregister = jest.fn((id: string) => { contexts.delete(id); });
  const nextRoot = new Y.Doc({ guid: 'database' });
  const nextRow = new Y.Doc({ guid: 'row' });

  jest.mocked(openCollabDB).mockResolvedValue(nextRoot);
  jest.mocked(openRowCollabDBWithProvider).mockResolvedValue({ doc: nextRow } as never);
  jest.mocked(getCollab).mockResolvedValue({ data: Y.encodeStateAsUpdate(nextRoot) });
  return { refs, register, unregister, contexts, root, row, document, nextRoot, nextRow };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(deleteOutboxByObjectId).mockReset();
  localStorage.clear();
  jest.mocked(captureDatabaseStorageFence).mockResolvedValue({ databaseId: 'database', epoch: null, cacheEpoch: null });
  jest.mocked(db.rows.where).mockReturnValue({ startsWith: () => ({ toArray: async () => [{ row_id: 'row' }] }) } as never);
  jest.mocked(deleteCollabDB).mockResolvedValue(true);
  jest.mocked(getDatabaseRestoreState).mockResolvedValue({ database_restore_id: 'restore-new', version: 'same-version' });
});

test('same-version restore replaces root and rows, clears old queues, and preserves row Documents', async () => {
  const f = fixture();
  const documentDestroyed = jest.fn();

  f.document.on('destroy', documentDestroyed);
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  let admitted = true;

  await act(async () => { admitted = await result.current.ensureDatabaseRestoreCurrent('database', Types.Database); });
  expect(admitted).toBe(false);
  expect(invalidateDatabaseBlobAfterRestore).toHaveBeenCalledWith('database', 'restore-new', null);
  expect(prefetchDatabaseBlobDiff).toHaveBeenCalledWith('workspace', 'database', { forceFullSync: true, reuseSettled: true, requirePersistence: true });
  expect(deleteOutboxByObjectId).toHaveBeenCalledWith('row', {
    skipActiveDrain: true, preserveDatabaseRestoreId: 'restore-new',
    storageFence: { databaseId: 'database', epoch: 'restore-new', cacheEpoch: 'restore-new' },
    session: { userId: 'user', workspaceId: 'workspace' },
  });
  expect(deleteCollabDB).toHaveBeenCalledWith('database_rows_row', { destroyDoc: false, databaseId: 'database', databaseRestoreId: 'restore-new' });
  expect(f.contexts.get('database')?.doc).toBe(f.nextRoot);
  expect(f.contexts.get('row')?.doc).toBe(f.nextRow);
  expect(f.contexts.get('row-document')?.doc).toBe(f.document);
  expect(documentDestroyed).not.toHaveBeenCalled();
  expect(f.refs.queuedMessagesDuringReset.current.size).toBe(0);
});

test('verification fails closed before capability resolution and when the server is unavailable', async () => {
  const f = fixture();
  const { result, rerender } = renderHook(({ loaded }) => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: loaded,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }), { initialProps: { loaded: false } });

  expect(await result.current.ensureDatabaseRestoreCurrent('database', Types.Database)).toBe(false);
  expect(getDatabaseRestoreState).not.toHaveBeenCalled();
  expect(await result.current.ensureDatabaseRestoreCurrent('row-document', Types.Document)).toBe(true);
  rerender({ loaded: true });
  jest.mocked(getDatabaseRestoreState).mockRejectedValue(new Error('Offline'));
  expect(await result.current.ensureDatabaseRestoreCurrent('database', Types.Database)).toBe(false);
  expect(deleteCollabDB).not.toHaveBeenCalled();
});

test('a failed reload retains owners and automatically retries after its contexts were retired', async () => {
  jest.useFakeTimers();
  const f = fixture();

  f.refs.contextRefCounts.current.set('database', 2);
  jest.mocked(getCollab).mockRejectedValueOnce(new Error('Temporary fetch failure'))
    .mockResolvedValue({ data: Y.encodeStateAsUpdate(f.nextRoot) });
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  await act(async () => { await result.current.ensureDatabaseRestoreCurrent('database', Types.Database); });
  expect(f.contexts.has('database')).toBe(false);
  expect(f.refs.resettingObjectIds.current.has('database')).toBe(true);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(f.contexts.get('database')?.doc).toBe(f.nextRoot);
  expect(f.contexts.get('row')?.doc).toBe(f.nextRow);
  expect(f.register.mock.calls.filter(([value]) => value.doc.guid === 'database')).toHaveLength(2);
  expect(f.refs.resettingObjectIds.current.size).toBe(0);
  jest.useRealTimers();
});


test('a stale notification hint verifies authority without resetting the current database', async () => {
  const f = fixture();

  localStorage.setItem('af_database_restore:v1:server:user:workspace:database', 'restore-new');
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  await act(async () => {
    result.current.handleRestoreNotification({ databaseId: 'database', databaseRestoreId: 'older-restore', version: 'same-version' });
  });
  expect(getDatabaseRestoreState).toHaveBeenCalledWith('workspace', 'database');
  expect(deleteCollabDB).not.toHaveBeenCalled();
  expect(f.contexts.get('database')?.doc).toBe(f.root);
});

test('discarding a stale payload retains freshly queued edits from the current generation', async () => {
  const f = fixture();
  const remove = jest.fn(async () => 1);
  let predicate: ((record: { databaseRestoreId?: string }) => boolean) | undefined;

  localStorage.setItem('af_database_restore:v1:server:user:workspace:database', 'restore-new');
  jest.mocked(db.sync_outbox.where).mockReturnValue({ equals: () => ({ filter: (value: typeof predicate) => {
    predicate = value;
    return { delete: remove };
  } }) } as never);
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  expect(await result.current.ensureDatabaseRestoreCurrent('row', Types.DatabaseRow, 'older-restore')).toBe(false);
  expect(remove).toHaveBeenCalled();
  expect(predicate?.({ databaseRestoreId: 'older-restore' })).toBe(true);
  expect(predicate?.({})).toBe(true);
  expect(predicate?.({ databaseRestoreId: 'restore-new' })).toBe(false);
  expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
});


test('restored rows absent from current orders and row-key metadata discard unreachable old caches', async () => {
  const f = fixture();
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();

  view.set('row_orders', Y.Array.from([{ id: 'historical-row' }]));
  views.set('view', view);
  database.set('views', views);
  f.nextRoot.getMap('data').set('database', database);
  jest.mocked(getCollab).mockResolvedValue({ data: Y.encodeStateAsUpdate(f.nextRoot) });
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  await act(async () => { await result.current.ensureDatabaseRestoreCurrent('database', Types.Database); });
  expect(deleteCollabDB).toHaveBeenCalledWith('historical-row', { destroyDoc: false, databaseId: 'database', databaseRestoreId: 'restore-new' });
  expect(deleteCollabDB).toHaveBeenCalledWith('database_rows_historical-row', { destroyDoc: false, databaseId: 'database', databaseRestoreId: 'restore-new' });
  expect(f.refs.resettingObjectIds.current.size).toBe(0);
});


test('a slower tab reload preserves edits queued after another tab completed the same restore', async () => {
  const f = fixture();
  let queued = [
    { objectId: 'row', databaseRestoreId: undefined },
    { objectId: 'row', databaseRestoreId: 'restore-old' },
    { objectId: 'row', databaseRestoreId: 'restore-new' },
  ];

  jest.mocked(deleteOutboxByObjectId).mockImplementation(async (objectId, options) => {
    queued = queued.filter((record) => record.objectId !== objectId ||
      (record.databaseRestoreId ?? '00000000-0000-0000-0000-000000000000') === options?.preserveDatabaseRestoreId);
  });
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  // The sibling has published the new cache marker, but this tab's documents
  // and tracker still belong to the old branch and must reload independently.
  localStorage.setItem('af_database_restore:v1:server:user:workspace:database', 'restore-new');
  await act(async () => { await result.current.ensureDatabaseRestoreCurrent('database', Types.Database); });
  expect(f.contexts.get('row')?.doc).toBe(f.nextRow);
  expect(queued).toEqual([{ objectId: 'row', databaseRestoreId: 'restore-new' }]);
});


test('independent tabs resetting the same committed restore use one stable storage generation', async () => {
  const older = fixture();
  const newer = fixture();
  const renderTab = (f: ReturnType<typeof fixture>) => renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));
  const olderTab = renderTab(older);
  const newerTab = renderTab(newer);

  await act(async () => { await newerTab.result.current.ensureDatabaseRestoreCurrent('database', Types.Database); });
  newer.nextRow.getMap('data').set('after-restore-edit', 'keep');
  const newerDestroyed = jest.fn();

  newer.nextRow.on('destroy', newerDestroyed);
  jest.mocked(captureDatabaseStorageFence).mockResolvedValue({ databaseId: 'database', epoch: 'restore-new', cacheEpoch: 'restore-new' });
  jest.mocked(openCollabDB).mockResolvedValue(older.nextRoot);
  jest.mocked(openRowCollabDBWithProvider).mockResolvedValue({ doc: older.nextRow } as never);
  jest.mocked(getCollab).mockResolvedValue({ data: Y.encodeStateAsUpdate(older.nextRoot) });
  await act(async () => { await olderTab.result.current.ensureDatabaseRestoreCurrent('database', Types.Database); });
  expect(invalidateDatabaseBlobAfterRestore).toHaveBeenNthCalledWith(1, 'database', 'restore-new', null);
  expect(invalidateDatabaseBlobAfterRestore).toHaveBeenNthCalledWith(2, 'database', 'restore-new', 'restore-new');
  expect(openCollabDB).toHaveBeenLastCalledWith('database', {
    expectedVersion: 'same-version', currentUser: '42', databaseRestoreId: 'restore-new',
  });
  expect(newerDestroyed).not.toHaveBeenCalled();
  newer.nextRow.getMap('data').set('later-edit', 'still writable');
  expect(newer.nextRow.getMap('data').get('after-restore-edit')).toBe('keep');
  expect(newer.nextRow.getMap('data').get('later-edit')).toBe('still writable');
  expect(older.refs.resettingObjectIds.current.size).toBe(0);
});


test('retry after a partial rebuild replaces the displayed new root and preserves its latest owners', async () => {
  const f = fixture();
  const secondRoot = new Y.Doc({ guid: 'database' });
  const events = new EventEmitter();
  const receiver = jest.fn();

  events.on(APP_EVENTS.COLLAB_DOC_RESET, receiver);
  f.refs.contextRefCounts.current.set('database', 2);
  jest.mocked(openCollabDB).mockResolvedValueOnce(f.nextRoot).mockResolvedValue(secondRoot);
  jest.mocked(openRowCollabDBWithProvider).mockRejectedValueOnce(new Error('Row storage temporarily unavailable'))
    .mockResolvedValue({ doc: f.nextRow } as never);
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: events, register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  await act(async () => { await result.current.ensureDatabaseRestoreCurrent('database', Types.Database); });
  expect(f.contexts.get('database')?.doc).toBe(f.nextRoot);
  expect(f.contexts.has('row')).toBe(false);
  // Another mounted view acquired the replacement root while row recovery waited.
  f.refs.contextRefCounts.current.set('database', 3);
  await act(async () => { await result.current.ensureDatabaseRestoreCurrent('database', Types.Database); });
  expect(f.contexts.get('database')?.doc).toBe(secondRoot);
  expect(f.contexts.get('row')?.doc).toBe(f.nextRow);
  expect(f.register.mock.calls.filter(([value]) => value.doc.guid === 'database')).toHaveLength(5);
  expect(receiver.mock.calls.filter(([value]) => value.objectId === 'database').map(([value]) => value.doc))
    .toEqual([f.nextRoot, secondRoot]);
  expect(f.refs.resettingObjectIds.current.size).toBe(0);
});


test('a passive tab retries a transient first notification read and coalesces duplicate hints', async () => {
  jest.useFakeTimers();
  const f = fixture();

  jest.mocked(getDatabaseRestoreState).mockRejectedValueOnce({
    code: ERROR_CODE.TOO_MANY_REQUESTS, httpStatus: 429, message: 'Restore publication fence',
  }).mockResolvedValue({ database_restore_id: 'restore-new', version: 'same-version' });
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));
  const hint = { databaseId: 'database', databaseRestoreId: 'restore-new', version: 'same-version' };

  await act(async () => {
    result.current.handleRestoreNotification(hint);
    result.current.handleRestoreNotification(hint);
  });
  expect(getDatabaseRestoreState).toHaveBeenCalledTimes(1);
  expect(invalidateDatabaseBlobAfterRestore).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(f.contexts.get('database')?.doc).toBe(f.nextRoot);
  expect(f.contexts.get('row')?.doc).toBe(f.nextRow);
  expect(getDatabaseRestoreState).toHaveBeenCalledTimes(3);
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(getDatabaseRestoreState).toHaveBeenCalledTimes(3);
  jest.useRealTimers();
});

test('a definitive permission denial does not keep polling a retained restore hint', async () => {
  jest.useFakeTimers();
  const f = fixture();

  jest.mocked(getDatabaseRestoreState).mockRejectedValue({ code: ERROR_CODE.NOT_HAS_PERMISSION, httpStatus: 403 });
  const { result } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  await act(async () => {
    result.current.handleRestoreNotification({ databaseId: 'database', databaseRestoreId: 'restore-new', version: 'same-version' });
  });
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(getDatabaseRestoreState).toHaveBeenCalledTimes(1);
  expect(invalidateDatabaseBlobAfterRestore).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test('a verification failure resolving after session disposal cannot schedule a retry', async () => {
  jest.useFakeTimers();
  const f = fixture();
  let fail!: (error: Error) => void;

  jest.mocked(getDatabaseRestoreState).mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  const { result, unmount } = renderHook(() => useDatabaseHistoryRestoreSync({
    refs: f.refs, workspaceId: 'workspace', userId: 'user', enabled: true, capabilityLoaded: true,
    eventEmitter: new EventEmitter(), register: f.register, unregister: f.unregister,
    scheduleDeferredCleanup: jest.fn(),
  }));

  await act(async () => {
    result.current.handleRestoreNotification({ databaseId: 'database', databaseRestoreId: 'restore-new', version: 'same-version' });
  });
  unmount();
  await act(async () => { fail(new Error('Offline')); });
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(getDatabaseRestoreState).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
