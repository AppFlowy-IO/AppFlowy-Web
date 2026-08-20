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

  it('settles an unconfirmed database as active when the initial view probe fails transiently', async () => {
    const eventEmitter = new EventEmitter();
    const setNotFound = jest.fn();

    (ViewService.get as jest.Mock).mockRejectedValue({
      code: 500,
      httpStatus: 500,
      message: 'Internal server error',
    });
    (ViewService.getTrashCached as jest.Mock).mockResolvedValue([]);

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

    await waitFor(() => {
      expect(result.current).toBe('none');
    });

    expect(setNotFound).not.toHaveBeenCalled();
  });

  it('confirms deletion when the view is gone even if the trash lookup also fails', async () => {
    const eventEmitter = new EventEmitter();
    const setNotFound = jest.fn();

    (ViewService.get as jest.Mock).mockRejectedValue({
      code: -2,
      httpStatus: 404,
      message: 'Record not found',
    });
    (ViewService.getTrashCached as jest.Mock).mockRejectedValue(new Error('trash unavailable'));

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

    await waitFor(() => {
      expect(result.current).toBe('deleted');
    });
    expect(setNotFound).toHaveBeenCalledWith(true);
  });

  it.each([
    {
      confirmedStatus: 'inTrash' as const,
      initialViewResult: createView('database-view', { parent_view_id: 'database-container' }),
      initialTrashItems: [
        createView('database-container', {
          extra: {
            is_database_container: true,
            database_id: 'database-id',
          },
        }),
      ],
    },
    {
      confirmedStatus: 'deleted' as const,
      initialViewResult: { code: -2, httpStatus: 404, message: 'Record not found' },
      initialTrashItems: [],
    },
  ])('preserves a confirmed $confirmedStatus state after a transient refresh failure', async (scenario) => {
    const eventEmitter = new EventEmitter();
    const setNotFound = jest.fn();

    if (scenario.confirmedStatus === 'deleted') {
      (ViewService.get as jest.Mock).mockRejectedValue(scenario.initialViewResult);
    } else {
      (ViewService.get as jest.Mock).mockResolvedValue(scenario.initialViewResult);
    }

    (ViewService.getTrashCached as jest.Mock).mockResolvedValue(scenario.initialTrashItems);
    (ViewService.refresh as jest.Mock).mockRejectedValue({
      code: 500,
      httpStatus: 500,
      message: 'Internal server error',
    });

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

    await waitFor(() => {
      expect(result.current).toBe(scenario.confirmedStatus);
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.TRASH_UPDATED, {
        workspaceId: 'workspace-id',
        trashItems: [],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(ViewService.refresh).toHaveBeenCalledTimes(1);
    });
    expect(result.current).toBe(scenario.confirmedStatus);
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
