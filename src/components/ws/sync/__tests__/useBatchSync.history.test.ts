import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { openRowCollabDBWithProvider } from '@/application/db';
import { collabFullSyncBatch } from '@/application/services/js-services/http/http_api';
import { Types, YDoc } from '@/application/types';

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
