import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';


import { APP_EVENTS } from '@/application/constants';
import { AccessLevel, type CollabObjectPermission, Types, type View, ViewLayout } from '@/application/types';
import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';

import type { ReactNode } from 'react';

const mockGetObjectPermission = jest.fn();
const mockGetView = jest.fn();
const mockGetSpacePermission = jest.fn();
const mockEventEmitter = new EventEmitter();

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args) },
  AccessService: {
    getObjectPermission: (...args: unknown[]) => mockGetObjectPermission(...args),
  },
  ViewService: {
    get: (...args: unknown[]) => mockGetView(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-id',
  useEventEmitter: () => mockEventEmitter,
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
    mockGetSpacePermission.mockReset();
    mockEventEmitter.removeAllListeners();
  });

  it('resolves action gates from the object-permission endpoint', async () => {
    mockGetObjectPermission.mockResolvedValue(createPermission());

    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'view-id', Types.Document);
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(true);
    expect(result.current.canShare).toBe(false);
    expect(result.current.canCreateViewActions).toBe(true);
    expect(result.current.canUsePageHistory).toBe(true);
    expect(result.current.canManageViewActions).toBe(false);
  });

  it.each([
    ['offline', { code: -1, message: 'Network Error' }, true],
    ['a server error', { code: 1017, message: 'Internal error' }, true],
    ['a denial', { code: 1012, httpStatus: 403, message: 'Forbidden' }, false],
  ] as const)('reports an object read that failed because of %s as unavailable only when nothing was decided', async (_case, error, unavailable) => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetObjectPermission.mockRejectedValue(error);
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(result.current.canWrite).toBe(false);
    expect(result.current.objectPermissionUnavailable).toBe(unavailable);
    consoleError.mockRestore();
  });

  it('clears the unavailable state once the object permission is read', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetObjectPermission.mockRejectedValueOnce({ code: -1, message: 'Network Error' }).mockResolvedValue(createPermission());
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.objectPermissionUnavailable).toBe(true));
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'view-id' });
    });
    expect(result.current.objectPermissionUnavailable).toBe(false);
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.objectPermissionUnavailable).toBe(false);
    consoleError.mockRestore();
  });

  it('re-probes an open action menu after a broad change and discards an older positive result', async () => {
    let resolveOld!: (permission: CollabObjectPermission) => void;

    mockGetObjectPermission.mockReturnValueOnce(new Promise<CollabObjectPermission>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue(createPermission({ can_write: false }));
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    act(() => { mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    await act(async () => { resolveOld(createPermission()); });
    expect(result.current.canCreateViewActions).toBe(false);
    expect(result.current.canWrite).toBe(false);
  });

  it.each([[true, false, false], [false, true, false], [true, true, true]])(
    'requires both direct-child Write (%s) and sidebar authority (%s)', async (canWrite, canEditSidebar, allowed) => {
      mockGetObjectPermission.mockResolvedValue(createPermission({ can_write: canWrite }));
      mockGetSpacePermission.mockResolvedValue({ can_manage_space: false, can_edit_sidebar: canEditSidebar });
      const { result } = renderHook(() => useViewActionPermissions(createView({ is_space: true }), true));

      await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
      expect(result.current.canCreateViewActions).toBe(allowed);
      expect(result.current.canWrite).toBe(canWrite);
    }
  );

  it('exposes space management and sidebar authority from its single space-permission read', async () => {
    mockGetObjectPermission.mockResolvedValue(createPermission());
    mockGetSpacePermission.mockResolvedValue({ can_manage_space: true, can_edit_sidebar: false });
    const { result } = renderHook(() => useViewActionPermissions(createView({ is_space: true }), true));

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(result.current.canOpenManageSpace).toBe(true);
    expect(result.current.canEditSidebar).toBe(false);
    expect(result.current.canCreateViewActions).toBe(false);
    expect(mockGetSpacePermission).toHaveBeenCalledTimes(1);
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
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(true);
    expect(result.current.canShare).toBe(false);
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
    expect(result.current.canShare).toBe(true);
  });

  it('uses an explicit database target without requiring folder metadata', async () => {
    mockGetObjectPermission.mockResolvedValue(
      createPermission({
        object_id: 'database-id',
        collab_type: Types.Database,
        can_share: true,
      })
    );

    const { result } = renderHook(() =>
      useViewActionPermissions(undefined, true, 'off-outline-view-id', {
        collabObjectId: 'database-id',
        collabType: Types.Database,
      })
    );

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(mockGetView).not.toHaveBeenCalled();
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'database-id', Types.Database);
    expect(result.current.canWrite).toBe(true);
    expect(result.current.canShare).toBe(true);
  });

  it('fails closed while the canonical object permission is unresolved', () => {
    mockGetObjectPermission.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    expect(result.current.hasLoadedViewActionPermissions).toBe(false);
    expect(result.current.canRead).toBe(false);
    expect(result.current.canWrite).toBe(false);
    expect(result.current.canShare).toBe(false);
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
