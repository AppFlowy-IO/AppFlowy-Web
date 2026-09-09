import { act, renderHook, waitFor } from '@testing-library/react';

import { PublishConfig, PublishConfigPatch, View, ViewLayout } from '@/application/types';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';

const mockGetViewInfo = jest.fn();
const mockGetView = jest.fn();
const mockUpdateConfig = jest.fn();
const mockGetConfig = jest.fn();
const mockUpdateSettings = jest.fn();

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
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
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
  mockGetConfig.mockRejectedValue(new Error('Record not found'));
  mockUpdateSettings.mockImplementation(async (_workspace: string, _view: string, patch: PublishConfigPatch) => ({
    comments_enabled: patch.comments_enabled ?? false,
    duplicate_enabled: patch.duplicate_enabled ?? true,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
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
  it('loads saved config and retains an unpublished container identity without browser storage', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockGetViewInfo.mockRejectedValue(new Error('Record not found'));
    mockGetConfig.mockImplementation((_workspace: string, requestedView: string) =>
      requestedView === containerView.view_id
        ? Promise.resolve({ comments_enabled: true, duplicate_enabled: false })
        : Promise.reject(new Error('Record not found'))
    );
    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id, containerView.view_id));

    await waitFor(() =>
      expect(result.current.publishConfig).toEqual({
        comments_enabled: true,
        duplicate_enabled: false,
      })
    );
    expect(result.current.publishInfo).toBeUndefined();
    expect(result.current.publishInfoViewId).toBe(containerView.view_id);
    expect(result.current.view).toBe(containerView);
    expect(mockGetConfig.mock.calls).toEqual([
      ['workspace-id', childView.view_id],
      ['workspace-id', containerView.view_id],
    ]);
  });

  it('uses the complete saved response after a partial setting update', async () => {
    mockGetViewInfo.mockResolvedValue(childPublishInfo);
    mockGetConfig.mockResolvedValue({ comments_enabled: true, duplicate_enabled: true });
    mockUpdateSettings.mockResolvedValue({ comments_enabled: false, duplicate_enabled: false });
    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id));

    await waitFor(() => expect(result.current.publishConfig?.comments_enabled).toBe(true));
    await act(async () => {
      await result.current.updatePublishConfig({ view_id: childView.view_id, comments_enabled: false });
    });

    expect(result.current.publishConfig).toEqual({ comments_enabled: false, duplicate_enabled: false });
    expect(result.current.publishInfo?.duplicateEnabled).toBe(false);
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('keeps a successful save when an older authenticated config read finishes', async () => {
    mockGetViewInfo.mockResolvedValue(childPublishInfo);
    mockGetConfig.mockResolvedValue({ comments_enabled: false, duplicate_enabled: true });
    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id));

    await waitFor(() => expect(result.current.publishConfig?.comments_enabled).toBe(false));
    const staleConfig = deferred<PublishConfig>();

    mockGetConfig.mockReturnValueOnce(staleConfig.promise);
    let loadPromise!: Promise<void>;

    act(() => {
      loadPromise = result.current.loadPublishInfo();
    });
    await act(async () => {
      await result.current.updatePublishConfig({ view_id: childView.view_id, comments_enabled: true });
      staleConfig.resolve({ comments_enabled: false, duplicate_enabled: true });
      await loadPromise;
    });

    expect(result.current.publishConfig?.comments_enabled).toBe(true);
  });

  it('keeps slug changes on the existing publication endpoint', async () => {
    mockGetViewInfo.mockResolvedValue(childPublishInfo);
    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id));

    await waitFor(() => expect(result.current.publishInfo).toEqual(childPublishInfo));
    await act(async () => {
      await result.current.updatePublishConfig({ view_id: childView.view_id, publish_name: 'new-name' });
    });

    expect(mockUpdateConfig).toHaveBeenCalledWith('workspace-id', {
      view_id: childView.view_id,
      publish_name: 'new-name',
    });
    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(result.current.publishInfo?.publishName).toBe('new-name');
    expect(result.current.publishConfig?.comments_enabled).toBe(true);
  });

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
  it('loads and saves settings only on the server, ignoring legacy browser storage', async () => {
    window.localStorage.setItem('appflowy:publish-comments:v2:view-id', '1');
    window.sessionStorage.setItem('appflowy:publish-comments:v1:view-id', '1');
    const storageRead = jest.spyOn(Storage.prototype, 'getItem');
    const storageWrite = jest.spyOn(Storage.prototype, 'setItem');

    mockGetViewInfo.mockResolvedValue(publishInfo(false));
    mockGetConfig.mockResolvedValue({ comments_enabled: false, duplicate_enabled: true });
    const firstRender = renderHook(() => useLoadPublishInfo('view-id'));

    await waitFor(() => expect(firstRender.result.current.publishConfig?.comments_enabled).toBe(false));
    await act(async () => {
      await firstRender.result.current.updatePublishConfig({ view_id: 'view-id', comments_enabled: true });
    });
    expect(mockUpdateSettings).toHaveBeenCalledWith('workspace-id', 'view-id', { comments_enabled: true });
    expect(firstRender.result.current.publishConfig?.comments_enabled).toBe(true);
    firstRender.unmount();

    // Another client changes the saved setting before this panel reopens.
    mockGetConfig.mockResolvedValue({ comments_enabled: false, duplicate_enabled: false });
    const secondRender = renderHook(() => useLoadPublishInfo('view-id'));

    await waitFor(() =>
      expect(secondRender.result.current.publishConfig).toEqual({ comments_enabled: false, duplicate_enabled: false })
    );
    expect(mockGetConfig).toHaveBeenCalledTimes(2);
    expect(storageRead).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
  });

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
    const firstUpdate = deferred<PublishConfig>();

    mockUpdateSettings.mockReturnValueOnce(firstUpdate.promise).mockResolvedValueOnce({
      comments_enabled: false,
      duplicate_enabled: false,
    });
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

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));

    await act(async () => {
      firstUpdate.resolve({ comments_enabled: false, duplicate_enabled: true });
      await commentPromise;
      await duplicatePromise;
    });

    expect(mockUpdateSettings.mock.calls).toEqual([
      ['workspace-id', 'view-id', { comments_enabled: false }],
      ['workspace-id', 'view-id', { duplicate_enabled: false }],
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
    mockUpdateSettings.mockRejectedValueOnce(new Error('update failed'));
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
