import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { hasRowDocSyncBinding, subscribeRowDocRelease } from '@/application/database-blob/row-doc-retention';
import { Types, YDoc } from '@/application/types';

import { useSyncRefs } from '../syncRefs';
import { useSyncContextLifecycle } from '../useSyncContextLifecycle';

jest.mock('@/application/sync-outbox', () => ({
  waitForDrain: async () => true,
  deleteOutboxByObjectId: async () => undefined,
  enqueueOutboxUpdate: jest.fn(async () => true),
  shouldRouteUpdateThroughOutbox: () => false,
}));

const rowId = '22222222-2222-4222-8222-222222222222';
const databaseId = '33333333-3333-4333-8333-333333333333';

function renderLifecycle() {
  return renderHook(() => {
    const refs = useSyncRefs();

    return useSyncContextLifecycle(refs, jest.fn(), jest.fn());
  });
}

describe('row doc references held by sync contexts', () => {
  const onRowUnbound = jest.fn();
  let unsubscribe: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    onRowUnbound.mockReset();
    unsubscribe = subscribeRowDocRelease({ onDatabaseReleased: jest.fn(), onRowUnbound });
  });

  afterEach(() => {
    unsubscribe();
    jest.useRealTimers();
  });

  it('references a row doc from registration until the deferred cleanup unregisters it', () => {
    const { result } = renderLifecycle();
    const doc = new Y.Doc({ guid: rowId }) as YDoc;

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.DatabaseRow });
    });
    expect(hasRowDocSyncBinding(rowId)).toBe(true);

    // The database view that rendered the row unmounts.
    act(() => {
      result.current.scheduleDeferredCleanup(rowId);
    });
    expect(hasRowDocSyncBinding(rowId)).toBe(true);
    expect(onRowUnbound).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(hasRowDocSyncBinding(rowId)).toBe(false);
    expect(onRowUnbound.mock.calls).toEqual([[rowId, doc, { docDestroyed: false }]]);
    doc.destroy();
  });

  it('keeps the reference while a second owner of the row remains', () => {
    const { result } = renderLifecycle();
    const doc = new Y.Doc({ guid: rowId }) as YDoc;

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.DatabaseRow });
      // A relation cell of another view binds the same row.
      result.current.registerSyncContext({ doc, collabType: Types.DatabaseRow });
      result.current.scheduleDeferredCleanup(rowId);
      jest.advanceTimersByTime(10_000);
    });
    expect(hasRowDocSyncBinding(rowId)).toBe(true);

    act(() => {
      result.current.scheduleDeferredCleanup(rowId);
      jest.advanceTimersByTime(10_000);
    });
    expect(hasRowDocSyncBinding(rowId)).toBe(false);
    expect(onRowUnbound).toHaveBeenCalledTimes(1);
    doc.destroy();
  });

  it('reports a context unregistered by the destruction of its doc as such', () => {
    const { result } = renderLifecycle();
    const doc = new Y.Doc({ guid: rowId }) as YDoc;

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.DatabaseRow });
    });
    doc.destroy();

    expect(hasRowDocSyncBinding(rowId)).toBe(false);
    // The doc is already going away: the cache must not destroy it again.
    expect(onRowUnbound.mock.calls).toEqual([[rowId, doc, { docDestroyed: true }]]);
  });

  it('does not track the sync context of a database document', () => {
    const { result } = renderLifecycle();
    const doc = new Y.Doc({ guid: databaseId }) as YDoc;

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Database });
    });
    expect(hasRowDocSyncBinding(databaseId)).toBe(false);

    act(() => {
      result.current.unregisterSyncContext(databaseId);
    });
    expect(onRowUnbound).not.toHaveBeenCalled();
    doc.destroy();
  });
});
