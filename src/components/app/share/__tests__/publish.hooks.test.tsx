import { act, renderHook, waitFor } from '@testing-library/react';

import { ViewLayout } from '@/application/types';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';

const mockGetViewInfo = jest.fn();
const mockUpdateConfig = jest.fn();

jest.mock('@/application/services/domains', () => ({
  PublishService: {
    getViewInfo: (...args: unknown[]) => mockGetViewInfo(...args),
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
  },
  ViewService: {
    get: jest.fn(),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppView: () => ({
    view_id: 'view-id',
    name: 'Page',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: true,
    is_private: false,
  }),
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: {
      id: 'workspace-id',
      owner: { uid: 1 },
    },
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: 1, email: 'owner@appflowy.test' }),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: jest.fn(),
  },
}));

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
    publisherEmail: 'owner@appflowy.test',
    commentEnabled,
    duplicateEnabled: true,
  };
}

describe('useLoadPublishInfo config updates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateConfig.mockResolvedValue(undefined);
  });

  it.each([
    { initial: true, updated: false },
    { initial: false, updated: true },
  ])('keeps comments set to $updated when an older read returns $initial', async ({ initial, updated }) => {
    mockGetViewInfo.mockResolvedValueOnce(publishInfo(initial));
    const { result } = renderHook(() => useLoadPublishInfo('view-id'));

    await waitFor(() => expect(result.current.publishInfo?.commentEnabled).toBe(initial));

    const staleResponse = deferred<ReturnType<typeof publishInfo>>();

    mockGetViewInfo.mockReturnValueOnce(staleResponse.promise);
    let loadPromise!: Promise<void>;

    act(() => {
      loadPromise = result.current.loadPublishInfo();
    });

    await act(async () => {
      await result.current.updatePublishConfig({
        view_id: 'view-id',
        comments_enabled: updated,
      });
    });
    expect(result.current.publishInfo?.commentEnabled).toBe(updated);

    await act(async () => {
      staleResponse.resolve(publishInfo(initial));
      await loadPromise;
    });

    expect(result.current.publishInfo?.commentEnabled).toBe(updated);
  });

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
