import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { ViewService } from '@/application/services/domains';
import { View, ViewLayout } from '@/application/types';

import { useDatabaseDeletionStatus } from '../useDatabaseDeletionStatus';

jest.mock('@/application/services/domains', () => ({
  ViewService: {
    get: jest.fn(),
    getTrashCached: jest.fn(),
    refresh: jest.fn(),
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createView(viewId: string, overrides: Partial<View> = {}): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

describe('useDatabaseDeletionStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores generic outline loads, consumes TRASH_UPDATED without fetching trash, and rejects a stale mount result', async () => {
    const eventEmitter = new EventEmitter();
    const setNotFound = jest.fn();
    const mountViewRequest = createDeferred<View>();
    const mountTrashRequest = createDeferred<View[]>();
    const databaseView = createView('database-view', { parent_view_id: 'database-container' });
    const trashedContainer = createView('database-container', {
      extra: {
        is_database_container: true,
        database_id: 'database-id',
      },
    });
    const trashItems = [trashedContainer];

    (ViewService.get as jest.Mock).mockReturnValue(mountViewRequest.promise);
    (ViewService.getTrashCached as jest.Mock).mockReturnValue(mountTrashRequest.promise);
    (ViewService.refresh as jest.Mock).mockResolvedValue(databaseView);

    const { result } = renderHook(() =>
      useDatabaseDeletionStatus({
        workspaceId: 'workspace-id',
        viewId: 'database-view',
        databaseId: 'database-id',
        hasDatabase: true,
        eventEmitter,
        notFound: false,
        setNotFound,
      })
    );

    expect(ViewService.get).toHaveBeenCalledTimes(1);
    expect(ViewService.getTrashCached).toHaveBeenCalledTimes(1);

    act(() => {
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, []);
    });

    expect(ViewService.refresh).not.toHaveBeenCalled();
    expect(ViewService.getTrashCached).toHaveBeenCalledTimes(1);

    act(() => {
      eventEmitter.emit(APP_EVENTS.TRASH_UPDATED, {
        workspaceId: 'different-workspace',
        trashItems: [trashedContainer],
      });
    });

    expect(ViewService.refresh).not.toHaveBeenCalled();

    act(() => {
      eventEmitter.emit(APP_EVENTS.TRASH_UPDATED, {
        workspaceId: 'workspace-id',
        trashItems,
      });
    });

    await waitFor(() => {
      expect(result.current).toBe('inTrash');
    });

    expect(ViewService.refresh).toHaveBeenCalledTimes(1);
    expect(ViewService.getTrashCached).toHaveBeenCalledTimes(1);
    expect(setNotFound).toHaveBeenCalledWith(true);

    act(() => {
      eventEmitter.emit(APP_EVENTS.TRASH_UPDATED, {
        workspaceId: 'workspace-id',
        trashItems,
      });
    });

    expect(ViewService.refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      mountViewRequest.resolve(databaseView);
      mountTrashRequest.resolve([]);
      await Promise.all([mountViewRequest.promise, mountTrashRequest.promise]);
    });

    expect(result.current).toBe('inTrash');
    expect(setNotFound).not.toHaveBeenCalledWith(false);
  });

  it('shares one TRASH_UPDATED listener across embedded database hooks', async () => {
    const eventEmitter = new EventEmitter();
    const databaseView = createView('database-view', { parent_view_id: 'database-container' });

    (ViewService.get as jest.Mock).mockResolvedValue(databaseView);
    (ViewService.getTrashCached as jest.Mock).mockResolvedValue([]);

    const props = {
      workspaceId: 'workspace-id',
      viewId: 'database-view',
      databaseId: 'database-id',
      hasDatabase: true,
      eventEmitter,
      notFound: false,
      setNotFound: jest.fn(),
    };
    const first = renderHook(() => useDatabaseDeletionStatus(props));
    const second = renderHook(() => useDatabaseDeletionStatus(props));

    await waitFor(() => {
      expect(first.result.current).toBe('none');
      expect(second.result.current).toBe('none');
    });
    expect(eventEmitter.listenerCount(APP_EVENTS.TRASH_UPDATED)).toBe(1);

    first.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.TRASH_UPDATED)).toBe(1);

    second.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.TRASH_UPDATED)).toBe(0);
  });
});
