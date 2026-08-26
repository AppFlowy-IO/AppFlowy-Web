import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AccessLevel, type CollabObjectPermission, Types, type View, ViewLayout } from '@/application/types';
import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';

const mockGetObjectPermission = jest.fn();
const mockGetView = jest.fn();

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    getObjectPermission: (...args: unknown[]) => mockGetObjectPermission(...args),
  },
  ViewService: {
    get: (...args: unknown[]) => mockGetView(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-id',
}));

function createView(overrides: Partial<View> = {}): View {
  return {
    view_id: 'view-id',
    name: 'Page',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function createPermission(overrides: Partial<CollabObjectPermission> = {}): CollabObjectPermission {
  return {
    object_id: 'view-id',
    collab_type: Types.Document,
    governing_view_id: 'view-id',
    access_level: AccessLevel.ReadAndWrite,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: false,
    ...overrides,
  };
}

describe('useViewActionPermissions', () => {
  beforeEach(() => {
    mockGetObjectPermission.mockReset();
    mockGetView.mockReset();
  });

  it('resolves action gates from the object-permission endpoint', async () => {
    mockGetObjectPermission.mockResolvedValue(createPermission());

    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'view-id', Types.Document);
    expect(result.current.canCreateViewActions).toBe(true);
    expect(result.current.canUsePageHistory).toBe(true);
    expect(result.current.canManageViewActions).toBe(false);
  });

  it('uses the canonical database collab identity', async () => {
    mockGetObjectPermission.mockResolvedValue(
      createPermission({
        object_id: 'database-id',
        collab_type: Types.Database,
      })
    );
    const view = createView({
      layout: ViewLayout.Grid,
      extra: { is_space: false, database_id: 'database-id' },
    });

    const { result } = renderHook(() => useViewActionPermissions(view, true));

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'database-id', Types.Database);
  });

  it('fetches a database container permission through its folder view identity', async () => {
    mockGetObjectPermission.mockResolvedValue(createPermission());
    const container = createView({
      layout: ViewLayout.Grid,
      extra: {
        is_space: false,
        is_database_container: true,
        database_id: 'database-id',
      },
    });

    const { result } = renderHook(() => useViewActionPermissions(container, true));

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'view-id', Types.Document);
  });

  it('resolves an off-outline database view from its known ID', async () => {
    const databaseView = createView({
      layout: ViewLayout.Grid,
      extra: { is_space: false, database_id: 'database-id' },
    });

    mockGetView.mockResolvedValue(databaseView);
    mockGetObjectPermission.mockResolvedValue(
      createPermission({
        object_id: 'database-id',
        collab_type: Types.Database,
        can_share: true,
      })
    );

    const { result } = renderHook(() => useViewActionPermissions(undefined, true, 'view-id'));

    expect(result.current.hasLoadedViewActionPermissions).toBe(false);
    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(mockGetView).toHaveBeenCalledWith('workspace-id', 'view-id');
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'database-id', Types.Database);
    expect(result.current.canManageViewActions).toBe(true);
  });

  it('reuses the active-page permission without issuing a duplicate request', async () => {
    const permission = createPermission({ can_share: true });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppNavigationContext.Provider value={{ objectPermissions: { 'view-id': permission } }}>
        {children}
      </AppNavigationContext.Provider>
    );

    const { result } = renderHook(() => useViewActionPermissions(createView(), true), { wrapper });

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(result.current.canManageViewActions).toBe(true);
    expect(mockGetObjectPermission).not.toHaveBeenCalled();
  });
});
