import { act, renderHook, waitFor } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';

const mockGetViewInfo = jest.fn();
const mockGetView = jest.fn();
const mockUpdateConfig = jest.fn();

const childView: View = {
  view_id: 'board-view',
  name: 'Board',
  icon: null,
  layout: ViewLayout.Board,
  extra: { database_id: 'database-id' },
  children: [],
  is_published: true,
  is_private: false,
  parent_view_id: 'database-container',
};

const containerView: View = {
  view_id: 'database-container',
  name: 'Database',
  icon: null,
  layout: ViewLayout.Grid,
  extra: { database_id: 'database-id', is_database_container: true },
  children: [childView],
  is_published: false,
  is_private: false,
};

const documentView: View = {
  view_id: 'view-id',
  name: 'Page',
  icon: null,
  layout: ViewLayout.Document,
  extra: null,
  children: [],
  is_published: true,
  is_private: false,
};

const views = new Map([
  [documentView.view_id, documentView],
  [childView.view_id, childView],
  [containerView.view_id, containerView],
]);

jest.mock('@/application/services/domains', () => ({
  PublishService: {
    getViewInfo: (...args: unknown[]) => mockGetViewInfo(...args),
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
  },
  ViewService: {
    get: (...args: unknown[]) => mockGetView(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppView: (viewId?: string) => (viewId ? views.get(viewId) : undefined),
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: {
      id: 'workspace-id',
      owner: { uid: 'owner-id' },
    },
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: 'owner-id', email: 'owner@appflowy.io' }),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: jest.fn(),
  },
}));

beforeEach(() => {
  jest.resetAllMocks();
  mockGetView.mockResolvedValue(undefined);
  mockUpdateConfig.mockResolvedValue(undefined);
});

const childPublishInfo = {
  namespace: 'workspace-namespace',
  publishName: 'Board-board-view',
  publisherEmail: 'owner@appflowy.io',
  commentEnabled: true,
  duplicateEnabled: true,
};

const containerPublishInfo = {
  ...childPublishInfo,
  publishName: 'Database-database-container',
};

describe('useLoadPublishInfo database publication identity', () => {
  it('recognizes a Desktop publication keyed by the active database child', async () => {
    mockGetViewInfo.mockImplementation((viewId: string) =>
      viewId === childView.view_id ? Promise.resolve(childPublishInfo) : Promise.reject(new Error('Record not found'))
    );

    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id, containerView.view_id));

    await waitFor(() => expect(result.current.publishInfo).toEqual(childPublishInfo));

    expect(mockGetViewInfo).toHaveBeenNthCalledWith(1, childView.view_id);
    expect(mockGetViewInfo).toHaveBeenNthCalledWith(2, containerView.view_id);
    expect(result.current.publishInfoViewId).toBe(childView.view_id);
    expect(result.current.view?.view_id).toBe(childView.view_id);
  });

  it('keeps an existing Web publication keyed by the database container manageable', async () => {
    mockGetViewInfo.mockImplementation((viewId: string) =>
      viewId === containerView.view_id
        ? Promise.resolve(containerPublishInfo)
        : Promise.reject(new Error('Record not found'))
    );

    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id, containerView.view_id));

    await waitFor(() => expect(result.current.publishInfo).toEqual(containerPublishInfo));

    expect(result.current.publishInfoViewId).toBe(containerView.view_id);
    expect(result.current.view?.view_id).toBe(containerView.view_id);
  });

  it('defaults new database publications to the active child', async () => {
    mockGetViewInfo.mockRejectedValue(new Error('Record not found'));

    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id, containerView.view_id));

    await waitFor(() => expect(mockGetViewInfo).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.publishInfo).toBeUndefined();
    expect(result.current.publishInfoViewId).toBe(childView.view_id);
    expect(result.current.view?.view_id).toBe(childView.view_id);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function publishInfo(commentEnabled: boolean) {
  return {
    namespace: 'namespace',
    publishName: 'page',
    publisherEmail: 'owner@appflowy.io',
    commentEnabled,
    duplicateEnabled: true,
  };
}

describe('useLoadPublishInfo config updates', () => {
  it.each(
    [
      { viewId: documentView.view_id, fallbackViewId: undefined, publishedViewId: documentView.view_id },
      { viewId: childView.view_id, fallbackViewId: containerView.view_id, publishedViewId: childView.view_id },
      { viewId: childView.view_id, fallbackViewId: containerView.view_id, publishedViewId: containerView.view_id },
    ].flatMap((target) => [
      { ...target, initial: true, updated: false },
      { ...target, initial: false, updated: true },
    ])
  )(
    'keeps $publishedViewId comments set to $updated when an older read returns $initial',
    async ({ viewId, fallbackViewId, publishedViewId, initial, updated }) => {
      mockGetViewInfo.mockImplementation((requestedViewId: string) =>
        requestedViewId === publishedViewId
          ? Promise.resolve(publishInfo(initial))
          : Promise.reject(new Error('Record not found'))
      );
      const { result } = renderHook(() => useLoadPublishInfo(viewId, fallbackViewId));

      await waitFor(() => expect(result.current.publishInfo?.commentEnabled).toBe(initial));
      expect(result.current.publishInfoViewId).toBe(publishedViewId);

      const staleResponse = deferred<ReturnType<typeof publishInfo>>();

      mockGetViewInfo.mockImplementation((requestedViewId: string) =>
        requestedViewId === publishedViewId ? staleResponse.promise : Promise.reject(new Error('Record not found'))
      );
      let loadPromise!: Promise<void>;

      act(() => {
        loadPromise = result.current.loadPublishInfo();
      });

      await act(async () => {
        await result.current.updatePublishConfig({
          view_id: publishedViewId,
          comments_enabled: updated,
        });
      });
      expect(result.current.publishInfo?.commentEnabled).toBe(updated);

      await act(async () => {
        staleResponse.resolve(publishInfo(initial));
        await loadPromise;
      });

      expect(result.current.publishInfo?.commentEnabled).toBe(updated);
      expect(result.current.publishInfoViewId).toBe(publishedViewId);
    }
  );

  it('serializes config updates and merges changes to different fields', async () => {
    mockGetViewInfo.mockResolvedValueOnce(publishInfo(true));
    const firstUpdate = deferred<void>();

    mockUpdateConfig.mockReturnValueOnce(firstUpdate.promise).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useLoadPublishInfo('view-id'));

    await waitFor(() => expect(result.current.publishInfo?.commentEnabled).toBe(true));

    let commentPromise!: Promise<boolean>;
    let duplicatePromise!: Promise<boolean>;

    act(() => {
      commentPromise = result.current.updatePublishConfig({
        view_id: 'view-id',
        comments_enabled: false,
      });
      duplicatePromise = result.current.updatePublishConfig({
        view_id: 'view-id',
        duplicate_enabled: false,
      });
    });

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));

    await act(async () => {
      firstUpdate.resolve();
      await commentPromise;
      await duplicatePromise;
    });

    expect(mockUpdateConfig.mock.calls).toEqual([
      ['workspace-id', { view_id: 'view-id', comments_enabled: false }],
      ['workspace-id', { view_id: 'view-id', duplicate_enabled: false }],
    ]);
    expect(result.current.publishInfo).toEqual(
      expect.objectContaining({
        commentEnabled: false,
        duplicateEnabled: false,
      })
    );
  });

  it('reports a failed config update without changing publish info', async () => {
    mockGetViewInfo.mockResolvedValueOnce(publishInfo(false));
    mockUpdateConfig.mockRejectedValueOnce(new Error('update failed'));
    const { result } = renderHook(() => useLoadPublishInfo('view-id'));

    await waitFor(() => expect(result.current.publishInfo?.commentEnabled).toBe(false));

    let updated = true;

    await act(async () => {
      updated = await result.current.updatePublishConfig({
        view_id: 'view-id',
        comments_enabled: true,
      });
    });

    expect(updated).toBe(false);
    expect(result.current.publishInfo?.commentEnabled).toBe(false);
  });
});
