import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { BindViewSync, YDoc, YDocWithMeta } from '@/application/types';
import { DatabaseViewNotFoundError } from '@/application/view-loader';

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

    renderHook(() => useDocumentLoader({
      viewId: 'view-id',
      databaseId: 'database-id',
      loadView,
    }));

    await waitFor(() => {
      expect(loadView).toHaveBeenCalledWith('view-id', false, false, { databaseId: 'database-id' });
    });
  });

  it('reports noAccess without retrying when loadView fails with a permission error', async () => {
    const loadView = jest.fn(async () => {
      return Promise.reject({ code: 1012, message: 'user is not allowed to access this view' });
    });

    const { result } = renderHook(() => useDocumentLoader({
      viewId: 'view-id',
      loadView,
    }));

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

    renderHook(() => useDocumentLoader({
      viewId: 'view-id',
      databaseId: 'database-id',
      loadView,
    }));

    await waitFor(() => {
      expect(mockDeleteCollabDB).toHaveBeenCalledWith('database-id', { destroyDoc: true });
    });
  });

  it('reports notFound but not noAccess for non-permission errors', async () => {
    const loadView = jest.fn(async () => {
      return Promise.reject(new Error('network down'));
    });

    const { result } = renderHook(() => useDocumentLoader({
      viewId: 'view-id',
      loadView,
    }));

    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });

    expect(result.current.noAccess).toBe(false);
    expect(loadView).toHaveBeenCalledTimes(3);
  });

  it('reports offline for a network failure, so the source is not called deleted', async () => {
    const loadView = jest.fn(async () => Promise.reject({ code: -1, message: 'Network Error' }));

    const { result } = renderHook(() => useDocumentLoader({ viewId: 'view-id', loadView }));

    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });

    expect(result.current.offline).toBe(true);
    expect(result.current.noAccess).toBe(false);
  });

  it('does not retry a network failure, so the offline placeholder shows without waiting for three loads', async () => {
    const loadView = jest.fn(async () => Promise.reject({ code: -1, message: 'Network Error' }));

    const { result } = renderHook(() => useDocumentLoader({ viewId: 'view-id', loadView }));

    await waitFor(() => {
      expect(result.current.offline).toBe(true);
    });
    expect(loadView).toHaveBeenCalledTimes(1);
  });

  it('reports offline for any failure while the browser is offline', async () => {
    const onLine = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);

    try {
      const loadView = jest.fn(async () => Promise.reject(new Error('fetch failed')));
      const { result } = renderHook(() => useDocumentLoader({ viewId: 'view-id', loadView }));

      await waitFor(() => {
        expect(result.current.notFound).toBe(true);
      });
      expect(result.current.offline).toBe(true);
    } finally {
      onLine.mockRestore();
    }
  });

  it('never reports a permission failure as offline', async () => {
    const loadView = jest.fn(async () =>
      Promise.reject({ code: 1012, message: 'user is not allowed to access this view' })
    );

    const { result } = renderHook(() => useDocumentLoader({ viewId: 'view-id', loadView }));

    await waitFor(() => {
      expect(result.current.noAccess).toBe(true);
    });
    expect(result.current.offline).toBe(false);
  });

  it('loads again when the browser is back online and clears offline', async () => {
    const doc = createDoc('database-id');
    let online = false;
    const loadView = jest.fn(async () => (online ? doc : Promise.reject({ code: -1, message: 'Network Error' })));

    const { result } = renderHook(() => useDocumentLoader({ viewId: 'view-id', loadView }));

    await waitFor(() => {
      expect(result.current.offline).toBe(true);
    });
    const failedAttempts = loadView.mock.calls.length;

    online = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(result.current.doc).toBe(doc);
    });
    expect(loadView.mock.calls.length).toBe(failedAttempts + 1);
    expect(result.current.notFound).toBe(false);
    expect(result.current.offline).toBe(false);
  });

  it('does not reload on the online event after a load that did not fail offline', async () => {
    const loadView = jest.fn(async () => Promise.reject(new Error('view is gone')));

    const { result } = renderHook(() => useDocumentLoader({ viewId: 'view-id', loadView }));

    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });
    const attempts = loadView.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(loadView.mock.calls.length).toBe(attempts);
  });

  it('shares one reset event listener across loader instances for the same emitter', async () => {
    const eventEmitter = new EventEmitter();
    const loadView = jest.fn(async (viewId: string) => createDoc(viewId));

    const first = renderHook(() => useDocumentLoader({
      viewId: 'view-a',
      loadView,
      eventEmitter,
    }));
    const second = renderHook(() => useDocumentLoader({
      viewId: 'view-b',
      loadView,
      eventEmitter,
    }));

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
      ({ databaseId, viewId }) => useDocumentLoader({
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
      expect(loadView).toHaveBeenCalledWith('old-view-id', false, false, { databaseId: 'old-database-id' });
    });

    rerender({
      viewId: 'new-view-id',
      databaseId: 'new-database-id',
    });

    await waitFor(() => {
      expect(loadView).toHaveBeenCalledWith('new-view-id', false, false, { databaseId: 'new-database-id' });
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

  it('does not retry a view its database no longer holds', async () => {
    mockDeleteCollabDB.mockClear();
    const loadView = jest.fn(async () => Promise.reject(new DatabaseViewNotFoundError('view-id', 'database-id')));

    const { result } = renderHook(() => useDocumentLoader({ viewId: 'view-id', databaseId: 'database-id', loadView }));

    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });

    // Each retry would download the database again for the same answer.
    expect(loadView).toHaveBeenCalledTimes(1);
    expect(result.current.noAccess).toBe(false);
    expect(result.current.offline).toBe(false);
    // A missing view is no reason to drop the database other views still show.
    expect(mockDeleteCollabDB).not.toHaveBeenCalled();
  });

  it('stops retrying a failed load once the loader unmounted', async () => {
    jest.useFakeTimers();

    try {
      const loadView = jest.fn(async () => Promise.reject(new Error('server error')));
      const { unmount } = renderHook(() => useDocumentLoader({ viewId: 'view-id', loadView }));

      // The first attempt failed and the loader waits before the second.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(loadView).toHaveBeenCalledTimes(1);

      // The dashboard is left: the remaining attempts are for nobody.
      unmount();
      await jest.runAllTimersAsync();

      expect(loadView).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('sync binding', () => {
    const databaseId = '00000000-0000-4000-8000-0000000000d1';

    function createDatabaseDoc(viewId: string): YDoc {
      const doc = createDoc(databaseId) as YDocWithMeta;

      // As `loadView` leaves it: the doc of a database names the view that loaded it last.
      doc.object_id = databaseId;
      doc.view_id = viewId;
      doc._syncBound = false;
      return doc;
    }

    /** A binder like `useViewOperations.bindViewSync`: `retain` acquires another owner, otherwise once per doc. */
    function createBinder() {
      const owners = new Map<string, number>();
      const bindViewSync: jest.MockedFunction<BindViewSync> = jest.fn((doc, options) => {
        const docWithMeta = doc as YDocWithMeta;

        if (docWithMeta._syncBound && !options?.retain) return null;
        owners.set(doc.guid, (owners.get(doc.guid) ?? 0) + 1);
        if (!options?.retain) docWithMeta._syncBound = true;
        return { doc } as SyncContext;
      });
      const scheduleDeferredCleanup = jest.fn((objectId: string) => {
        owners.set(objectId, (owners.get(objectId) ?? 0) - 1);
      });

      return { owners, bindViewSync, scheduleDeferredCleanup };
    }

    it('owns one binding of the loaded doc and releases it on unmount', async () => {
      const doc = createDatabaseDoc('view-id');
      const { owners, bindViewSync, scheduleDeferredCleanup } = createBinder();
      const loadView = jest.fn(async () => doc);

      const { result, unmount } = renderHook(() =>
        useDocumentLoader({ viewId: 'view-id', databaseId, loadView, bindViewSync, scheduleDeferredCleanup })
      );

      await waitFor(() => {
        expect(result.current.doc).toBe(doc);
      });

      expect(bindViewSync).toHaveBeenCalledTimes(1);
      expect(bindViewSync).toHaveBeenCalledWith(doc, { retain: true });
      expect(owners.get(databaseId)).toBe(1);
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();

      unmount();

      expect(scheduleDeferredCleanup.mock.calls).toEqual([[databaseId]]);
      expect(owners.get(databaseId)).toBe(0);
    });

    it('gives every view of a shared database doc its own binding', async () => {
      const doc = createDatabaseDoc('view-a');
      const { owners, bindViewSync, scheduleDeferredCleanup } = createBinder();
      // Two widgets on two views of one database: both loads return the same doc,
      // and the second load renames it after its own view.
      const loadView = jest.fn(async (viewId: string) => {
        (doc as YDocWithMeta).view_id = viewId;
        return doc;
      });
      const mount = (viewId: string) =>
        renderHook(() => useDocumentLoader({ viewId, databaseId, loadView, bindViewSync, scheduleDeferredCleanup }));

      const first = mount('view-a');
      const second = mount('view-b');

      await waitFor(() => {
        expect(owners.get(databaseId)).toBe(2);
      });

      // Removing one widget must not end the sync of the database the other still shows.
      second.unmount();
      expect(owners.get(databaseId)).toBe(1);

      first.unmount();
      expect(owners.get(databaseId)).toBe(0);
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(2);
    });

    it('acquires its own binding of a doc the page already bound, and releases only that one', async () => {
      const doc = createDatabaseDoc('view-id');
      const { owners, bindViewSync, scheduleDeferredCleanup } = createBinder();

      // The page that shows this database bound it first.
      bindViewSync(doc);
      expect(owners.get(databaseId)).toBe(1);

      const { result, unmount } = renderHook(() =>
        useDocumentLoader({
          viewId: 'view-id',
          databaseId,
          loadView: jest.fn(async () => doc),
          bindViewSync,
          scheduleDeferredCleanup,
        })
      );

      await waitFor(() => {
        expect(result.current.doc).toBe(doc);
      });
      await waitFor(() => {
        expect(owners.get(databaseId)).toBe(2);
      });

      unmount();
      expect(owners.get(databaseId)).toBe(1);
    });

    it('moves its binding to the replacement doc after a reset', async () => {
      const eventEmitter = new EventEmitter();
      const doc = createDatabaseDoc('view-id');
      const nextDoc = createDatabaseDoc('view-id');
      const { bindViewSync, scheduleDeferredCleanup } = createBinder();

      const { result, unmount } = renderHook(() =>
        useDocumentLoader({
          viewId: 'view-id',
          databaseId,
          loadView: jest.fn(async () => doc),
          bindViewSync,
          scheduleDeferredCleanup,
          eventEmitter,
        })
      );

      await waitFor(() => {
        expect(bindViewSync).toHaveBeenCalledTimes(1);
      });

      act(() => {
        eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, { objectId: databaseId, viewId: 'view-id', doc: nextDoc });
      });

      await waitFor(() => {
        expect(result.current.doc).toBe(nextDoc);
      });
      expect(bindViewSync).toHaveBeenLastCalledWith(nextDoc, { retain: true });
      // One release for the old doc; the new one is still held.
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(1);

      unmount();
      expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(2);
    });

    it('never releases the binding of a binder that ignores retain', async () => {
      const doc = createDatabaseDoc('view-id');
      const scheduleDeferredCleanup = jest.fn();
      // Binds once per doc, whatever the options: the binding is the doc's.
      const bindViewSync = jest.fn((target: YDoc) => {
        const docWithMeta = target as YDocWithMeta;

        if (docWithMeta._syncBound) return null;
        docWithMeta._syncBound = true;
        return { doc: target } as SyncContext;
      });

      const { result, unmount } = renderHook(() =>
        useDocumentLoader({
          viewId: 'view-id',
          databaseId,
          loadView: jest.fn(async () => doc),
          bindViewSync,
          scheduleDeferredCleanup,
        })
      );

      await waitFor(() => {
        expect(result.current.doc).toBe(doc);
      });
      await waitFor(() => {
        expect(bindViewSync).toHaveBeenCalled();
      });

      unmount();
      expect(scheduleDeferredCleanup).not.toHaveBeenCalled();
    });

    it('binds once and keeps the binding when it has no way to release it', async () => {
      const doc = createDatabaseDoc('view-id');
      const { owners, bindViewSync } = createBinder();

      const { result, unmount } = renderHook(() =>
        useDocumentLoader({ viewId: 'view-id', databaseId, loadView: jest.fn(async () => doc), bindViewSync })
      );

      await waitFor(() => {
        expect(result.current.doc).toBe(doc);
      });
      await waitFor(() => {
        expect(bindViewSync).toHaveBeenCalledTimes(1);
      });

      expect(bindViewSync).toHaveBeenCalledWith(doc);
      unmount();
      expect(owners.get(databaseId)).toBe(1);
    });
  });
});
