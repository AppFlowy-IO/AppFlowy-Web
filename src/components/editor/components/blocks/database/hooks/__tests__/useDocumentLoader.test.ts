import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { YDoc } from '@/application/types';

import { useDocumentLoader } from '../useDocumentLoader';

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
