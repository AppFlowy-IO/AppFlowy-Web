import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { YDoc, YDocWithMeta } from '@/application/types';

import { useDocumentLoader } from '../useDocumentLoader';

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn().mockResolvedValue(undefined),
}));

const mockDeleteCollabDB = deleteCollabDB as jest.MockedFunction<typeof deleteCollabDB>;

function createDoc(guid: string): YDoc {
  return new Y.Doc({ guid }) as YDoc;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('useDocumentLoader', () => {
  it('passes databaseId hint into loadView', async () => {
    const doc = createDoc('database-id');
    const loadView = jest.fn(async () => doc);

    renderHook(() =>
      useDocumentLoader({
        viewId: 'view-id',
        databaseId: 'database-id',
        loadView,
      })
    );

    await waitFor(() => {
      expect(loadView).toHaveBeenCalledWith('view-id', false, false, {
        databaseId: 'database-id',
        databaseMetadataOnly: true,
        preserveViewMetadata: true,
      });
    });
  });

  it.each([true, false])('shares a canonical database owned by another view (already bound: %s)', async (alreadyBound) => {
    const doc = createDoc('database-id') as YDocWithMeta;

    doc.object_id = 'database-id';
    doc.view_id = 'page-view-id';
    doc._syncBound = alreadyBound;
    const loadView = jest.fn(async () => doc);
    const bindViewSync = jest.fn().mockReturnValue({});
    const { result } = renderHook(() => useDocumentLoader({
      viewId: 'embedded-view-id',
      databaseId: 'database-id',
      loadView,
      bindViewSync,
    }));

    await waitFor(() => expect(result.current.doc).toBe(doc));
    expect(bindViewSync).toHaveBeenCalledTimes(alreadyBound ? 0 : 1);
    if (!alreadyBound) expect(bindViewSync).toHaveBeenCalledWith(doc);
    expect(doc.view_id).toBe('page-view-id');
  });

  it('reports noAccess without retrying when loadView fails with a permission error', async () => {
    const loadView = jest.fn(async () => {
      return Promise.reject({ code: 1012, message: 'user is not allowed to access this view' });
    });

    const { result } = renderHook(() =>
      useDocumentLoader({
        viewId: 'view-id',
        loadView,
      })
    );

    await waitFor(() => {
      expect(result.current.noAccess).toBe(true);
    });

    expect(result.current.notFound).toBe(true);
    expect(loadView).toHaveBeenCalledTimes(1);
  });

  it('evicts the cached collab when loadView fails with a permission error', async () => {
    mockDeleteCollabDB.mockClear();
    const loadView = jest.fn(async () => {
      return Promise.reject({ code: 1012, message: 'user is not allowed to access this view' });
    });

    renderHook(() =>
      useDocumentLoader({
        viewId: 'view-id',
        databaseId: 'database-id',
        loadView,
      })
    );

    await waitFor(() => {
      expect(mockDeleteCollabDB).toHaveBeenCalledWith('database-id', { destroyDoc: true });
    });
  });

  it('reports notFound but not noAccess for non-permission errors', async () => {
    const loadView = jest.fn(async () => {
      return Promise.reject(new Error('network down'));
    });

    const { result } = renderHook(() =>
      useDocumentLoader({
        viewId: 'view-id',
        loadView,
      })
    );

    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });

    expect(result.current.noAccess).toBe(false);
    expect(loadView).toHaveBeenCalledTimes(3);
  });

  it('shares one reset event listener across loader instances for the same emitter', async () => {
    const eventEmitter = new EventEmitter();
    const loadView = jest.fn(async (viewId: string) => createDoc(viewId));

    const first = renderHook(() =>
      useDocumentLoader({
        viewId: 'view-a',
        loadView,
        eventEmitter,
      })
    );
    const second = renderHook(() =>
      useDocumentLoader({
        viewId: 'view-b',
        loadView,
        eventEmitter,
      })
    );

    await waitFor(() => {
      expect(eventEmitter.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(1);
    });

    first.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(1);

    second.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.COLLAB_DOC_RESET)).toBe(0);
  });

  it('ignores stale load results after viewId changes', async () => {
    const oldLoad = deferred<YDoc>();
    const newLoad = deferred<YDoc>();
    const oldDoc = createDoc('old-database-id');
    const newDoc = createDoc('new-database-id');
    const loadView = jest.fn((viewId: string) => {
      return viewId === 'old-view-id' ? oldLoad.promise : newLoad.promise;
    });

    const { result, rerender } = renderHook(
      ({ databaseId, viewId }) =>
        useDocumentLoader({
          viewId,
          databaseId,
          loadView,
        }),
      {
        initialProps: {
          viewId: 'old-view-id',
          databaseId: 'old-database-id',
        },
      }
    );

    await waitFor(() => {
      expect(loadView).toHaveBeenCalledWith('old-view-id', false, false, {
        databaseId: 'old-database-id',
        databaseMetadataOnly: true,
        preserveViewMetadata: true,
      });
    });

    rerender({
      viewId: 'new-view-id',
      databaseId: 'new-database-id',
    });

    await waitFor(() => {
      expect(loadView).toHaveBeenCalledWith('new-view-id', false, false, {
        databaseId: 'new-database-id',
        databaseMetadataOnly: true,
        preserveViewMetadata: true,
      });
    });

    await act(async () => {
      newLoad.resolve(newDoc);
      await newLoad.promise;
    });

    await waitFor(() => {
      expect(result.current.doc).toBe(newDoc);
    });

    await act(async () => {
      oldLoad.resolve(oldDoc);
      await oldLoad.promise;
    });

    expect(result.current.doc).toBe(newDoc);
  });

  it('releases the previous database subscription while the next view is loading', async () => {
    const oldDoc = createDoc('old-database-id') as YDocWithMeta;
    const newDoc = createDoc('new-database-id') as YDocWithMeta;
    const newLoad = deferred<YDoc>();
    const loadView = jest.fn(async (viewId: string) => (viewId === 'old-view-id' ? oldDoc : newLoad.promise));
    const bindViewSync = jest.fn().mockImplementation((doc: YDoc) => ({ doc }));
    const scheduleDeferredCleanup = jest.fn();

    oldDoc.view_id = 'hosting-page-id';
    oldDoc._syncBound = true;
    const hook = renderHook(
      ({ databaseId, viewId }) =>
        useDocumentLoader({
          databaseId,
          viewId,
          loadView,
          bindViewSync,
          scheduleDeferredCleanup,
        }),
      { initialProps: { databaseId: oldDoc.guid, viewId: 'old-view-id' } }
    );

    try {
      await waitFor(() => expect(hook.result.current.doc).toBe(oldDoc));
      expect(bindViewSync).toHaveBeenCalledWith(oldDoc, { retain: true });

      hook.rerender({ databaseId: newDoc.guid, viewId: 'new-view-id' });
      expect(scheduleDeferredCleanup).toHaveBeenCalledWith(oldDoc.guid);
      expect(bindViewSync).toHaveBeenCalledTimes(1);

      await act(async () => newLoad.resolve(newDoc));
      await waitFor(() => expect(hook.result.current.doc).toBe(newDoc));
      expect(bindViewSync).toHaveBeenCalledTimes(2);
      expect(bindViewSync).toHaveBeenLastCalledWith(newDoc, { retain: true });
      expect(oldDoc.view_id).toBe('hosting-page-id');
      expect(oldDoc._syncBound).toBe(true);

      hook.unmount();
      expect(scheduleDeferredCleanup.mock.calls).toEqual([[oldDoc.guid], [newDoc.guid]]);
    } finally {
      oldDoc.destroy();
      newDoc.destroy();
    }
  });
});

it('retains shared database sync without taking the hosting page view identity', async () => {
  const doc = createDoc('shared-database') as YDocWithMeta;

  doc.view_id = 'hosting-page';
  doc.object_id = doc.guid;
  doc._syncBound = true;
  const loadView = jest.fn(async (_viewId, _sub, _awareness, options) => {
    if (!options.databaseMetadataOnly) doc.view_id = 'embedded-tab';
    return doc;
  });
  const bindViewSync = jest.fn(() => ({ doc }));
  const scheduleDeferredCleanup = jest.fn();
  const hook = renderHook(() =>
    useDocumentLoader({
      viewId: 'embedded-tab',
      databaseId: doc.guid,
      loadView,
      bindViewSync: bindViewSync as any,
      scheduleDeferredCleanup,
    })
  );

  try {
    await waitFor(() => expect(hook.result.current.doc).toBe(doc));
    expect(doc.view_id).toBe('hosting-page');
    expect(doc._syncBound).toBe(true);
    expect(bindViewSync).toHaveBeenCalledWith(doc, { retain: true });
    hook.rerender();
    expect(bindViewSync).toHaveBeenCalledTimes(1);
    hook.unmount();
    expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredCleanup).toHaveBeenCalledWith(doc.guid);
  } finally {
    doc.destroy();
  }
});
