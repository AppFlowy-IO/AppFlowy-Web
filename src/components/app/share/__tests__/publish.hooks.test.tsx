import { renderHook, waitFor } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';

const mockGetPublishInfo = jest.fn();
const mockGetView = jest.fn();

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

const views = new Map([
  [childView.view_id, childView],
  [containerView.view_id, containerView],
]);

jest.mock('@/application/services/domains', () => ({
  PublishService: {
    getViewInfo: (...args: unknown[]) => mockGetPublishInfo(...args),
    updateConfig: jest.fn(),
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recognizes a Desktop publication keyed by the active database child', async () => {
    mockGetPublishInfo.mockImplementation((viewId: string) =>
      viewId === childView.view_id ? Promise.resolve(childPublishInfo) : Promise.reject(new Error('Record not found'))
    );

    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id, containerView.view_id));

    await waitFor(() => expect(result.current.publishInfo).toEqual(childPublishInfo));

    expect(mockGetPublishInfo).toHaveBeenNthCalledWith(1, childView.view_id);
    expect(mockGetPublishInfo).toHaveBeenNthCalledWith(2, containerView.view_id);
    expect(result.current.publishInfoViewId).toBe(childView.view_id);
    expect(result.current.view?.view_id).toBe(childView.view_id);
  });

  it('keeps an existing Web publication keyed by the database container manageable', async () => {
    mockGetPublishInfo.mockImplementation((viewId: string) =>
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
    mockGetPublishInfo.mockRejectedValue(new Error('Record not found'));

    const { result } = renderHook(() => useLoadPublishInfo(childView.view_id, containerView.view_id));

    await waitFor(() => expect(mockGetPublishInfo).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.publishInfo).toBeUndefined();
    expect(result.current.publishInfoViewId).toBe(childView.view_id);
    expect(result.current.view?.view_id).toBe(childView.view_id);
  });
});
