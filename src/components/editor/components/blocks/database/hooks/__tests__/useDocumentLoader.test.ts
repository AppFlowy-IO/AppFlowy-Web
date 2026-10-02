import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { YDoc } from '@/application/types';

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
});
