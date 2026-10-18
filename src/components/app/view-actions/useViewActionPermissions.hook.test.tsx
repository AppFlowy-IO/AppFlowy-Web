import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';


import { APP_EVENTS } from '@/application/constants';
import { AccessLevel, type CollabObjectPermission, Types, type View, ViewLayout } from '@/application/types';
import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { useAppEmbeddedDatabasePermissions } from '@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions';

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
    // The re-read runs in the background, so the last answer stays until it lands.
    expect(result.current.objectPermissionUnavailable).toBe(true);
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

  it.each([
    ['a permission change', () => mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {})],
    ['coming back online', () => window.dispatchEvent(new Event('online'))],
  ])('keeps the answer while re-reading it at once in the background after %s', async (_case, trigger) => {
    let resolveFresh!: (permission: CollabObjectPermission) => void;

    mockGetObjectPermission.mockResolvedValueOnce(createPermission())
      .mockReturnValueOnce(new Promise<CollabObjectPermission>((resolve) => { resolveFresh = resolve; }));
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.canWrite).toBe(true));
    act(() => { trigger(); });
    // Unlike focus, even a recent answer is re-read, and it stays on screen meanwhile.
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
    expect(result.current.hasLoadedViewActionPermissions).toBe(true);
    expect(result.current.isLoadingViewActionPermissions).toBe(false);
    expect(result.current.canWrite).toBe(true);

    await act(async () => { resolveFresh(createPermission({ can_write: false })); });
    expect(result.current.canWrite).toBe(false);
    expect(result.current.hasLoadedViewActionPermissions).toBe(true);
  });

  it.each([
    ['cannot run', () => Promise.reject({ code: -1, message: 'Network Error' }), true],
    ['is refused', () => Promise.reject({ code: 1012, httpStatus: 403, message: 'Forbidden' }), false],
    ['denies reading', () => Promise.resolve(createPermission({ can_read: false, can_write: false })), false],
  ] as const)('keeps the confirmed answer only while a permission change re-read %s', async (_case, reread, keeps) => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetObjectPermission.mockResolvedValueOnce(createPermission()).mockImplementationOnce(reread);
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.canWrite).toBe(true));
    await act(async () => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
    expect(result.current.canRead).toBe(keeps);
    expect(result.current.canWrite).toBe(keeps);
    expect(result.current.hasLoadedViewActionPermissions).toBe(true);
    expect(result.current.objectPermissionUnavailable).toBe(false);
    consoleError.mockRestore();
  });

  it('applies only the newest re-read when permission changes overlap', async () => {
    let resolveOlder!: (permission: CollabObjectPermission) => void;
    let resolveNewer!: (permission: CollabObjectPermission) => void;

    mockGetObjectPermission.mockResolvedValueOnce(createPermission())
      .mockReturnValueOnce(new Promise<CollabObjectPermission>((resolve) => { resolveOlder = resolve; }))
      .mockReturnValueOnce(new Promise<CollabObjectPermission>((resolve) => { resolveNewer = resolve; }));
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.canWrite).toBe(true));
    act(() => { mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    act(() => { mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(3);

    await act(async () => { resolveNewer(createPermission({ can_write: false })); });
    expect(result.current.canWrite).toBe(false);
    // A read that started before the newer change is never applied.
    await act(async () => { resolveOlder(createPermission()); });
    expect(result.current.canWrite).toBe(false);
  });

  it('follows the active page answer through a permission change without reading it again', async () => {
    let activePermission = createPermission({ can_share: true });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppNavigationContext.Provider value={{ objectPermissions: { 'view-id': activePermission } }}>
        {children}
      </AppNavigationContext.Provider>
    );
    const { result, rerender } = renderHook(() => useViewActionPermissions(createView(), true), { wrapper });

    await waitFor(() => expect(result.current.canShare).toBe(true));
    act(() => { mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    // AppBusinessLayer re-probes the page in the background and keeps its answer meanwhile.
    expect(mockGetObjectPermission).not.toHaveBeenCalled();
    expect(result.current.hasLoadedViewActionPermissions).toBe(true);
    expect(result.current.isLoadingViewActionPermissions).toBe(false);
    expect(result.current.canShare).toBe(true);

    activePermission = createPermission({ can_share: false });
    rerender();
    expect(result.current.canShare).toBe(false);
    expect(mockGetObjectPermission).not.toHaveBeenCalled();
  });

  it('still re-reads a view the active page does not cover after a permission change', async () => {
    const routePermission = createPermission({ object_id: 'route-view-id', governing_view_id: 'route-view-id' });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppNavigationContext.Provider value={{ objectPermissions: { 'route-view-id': routePermission } }}>
        {children}
      </AppNavigationContext.Provider>
    );
    const target = { collabObjectId: 'view-id', collabType: Types.Document };
    let resolveFresh!: (permission: CollabObjectPermission) => void;

    mockGetObjectPermission.mockResolvedValueOnce(createPermission())
      .mockReturnValueOnce(new Promise<CollabObjectPermission>((resolve) => { resolveFresh = resolve; }));
    const { result } = renderHook(() => useViewActionPermissions(undefined, true, 'view-id', target), { wrapper });

    await waitFor(() => expect(result.current.canWrite).toBe(true));
    act(() => { mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
    expect(result.current.canWrite).toBe(true);

    await act(async () => { resolveFresh(createPermission({ can_write: false })); });
    expect(result.current.canWrite).toBe(false);
  });

  it('keeps an embedded database editable through a permission change that leaves its access unchanged', async () => {
    const databasePermission = () => createPermission({ object_id: 'database-id', collab_type: Types.Database });
    const readOnlyStates: boolean[] = [];
    let resolveFresh!: (permission: CollabObjectPermission) => void;

    mockGetObjectPermission.mockResolvedValueOnce(databasePermission())
      .mockReturnValueOnce(new Promise<CollabObjectPermission>((resolve) => { resolveFresh = resolve; }));
    const { result } = renderHook(() => {
      const permissions = useAppEmbeddedDatabasePermissions({
        sourceViewId: 'view-id',
        sourceDatabaseId: 'database-id',
        inheritedReadOnly: false,
      });

      readOnlyStates.push(permissions.readOnly);
      return permissions;
    });

    await waitFor(() => expect(result.current.readOnly).toBe(false));
    const rendersBeforeChange = readOnlyStates.length;

    act(() => { mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    expect(mockGetObjectPermission).toHaveBeenLastCalledWith('workspace-id', 'database-id', Types.Database);
    await act(async () => { resolveFresh(databasePermission()); });

    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
    expect(readOnlyStates.slice(rendersBeforeChange)).not.toContain(true);
    expect(result.current).toEqual({ readOnly: false, canWrite: true, canShare: false });
  });

  it('keeps the confirmed answer through a window focus and re-reads it in the background once stale', async () => {
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let resolveFresh!: (permission: CollabObjectPermission) => void;

    mockGetObjectPermission.mockResolvedValueOnce(createPermission())
      .mockReturnValueOnce(new Promise<CollabObjectPermission>((resolve) => { resolveFresh = resolve; }));
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.canWrite).toBe(true));
    act(() => { window.dispatchEvent(new Event('focus')); });
    // A fresh answer is not re-read on every alt-tab.
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(1);
    expect(result.current.hasLoadedViewActionPermissions).toBe(true);

    now += 30_000;
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
    // Embeds and sidebar rows keep the confirmed answer while it is re-read.
    expect(result.current.hasLoadedViewActionPermissions).toBe(true);
    expect(result.current.isLoadingViewActionPermissions).toBe(false);
    expect(result.current.canWrite).toBe(true);

    await act(async () => { resolveFresh(createPermission({ can_write: false })); });
    await waitFor(() => expect(result.current.canWrite).toBe(false));
    expect(result.current.hasLoadedViewActionPermissions).toBe(true);
    clock.mockRestore();
  });

  it.each([
    ['cannot run', { code: -1, message: 'Network Error' }, true],
    ['is refused', { code: 1012, httpStatus: 403, message: 'Forbidden' }, false],
  ] as const)('keeps the confirmed answer only while a background focus read %s', async (_case, error, keeps) => {
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetObjectPermission.mockResolvedValueOnce(createPermission()).mockRejectedValueOnce(error);
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.canWrite).toBe(true));
    now += 30_000;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
    expect(result.current.canWrite).toBe(keeps);
    expect(result.current.hasLoadedViewActionPermissions).toBe(true);
    expect(result.current.objectPermissionUnavailable).toBe(false);
    consoleError.mockRestore();
    clock.mockRestore();
  });

  it('discards a background focus read that a permission change superseded', async () => {
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let resolveFocusRead!: (permission: CollabObjectPermission) => void;

    mockGetObjectPermission.mockResolvedValueOnce(createPermission({ can_write: false }))
      .mockReturnValueOnce(new Promise<CollabObjectPermission>((resolve) => { resolveFocusRead = resolve; }))
      .mockResolvedValueOnce(createPermission({ can_write: false }));
    const { result } = renderHook(() => useViewActionPermissions(createView(), true));

    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    now += 30_000;
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {}); });
    await waitFor(() => expect(result.current.hasLoadedViewActionPermissions).toBe(true));
    await act(async () => {
      resolveFocusRead(createPermission());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockGetObjectPermission).toHaveBeenCalledTimes(3);
    expect(result.current.canWrite).toBe(false);
    clock.mockRestore();
  });

  it('leaves an answer taken from the active page to AppBusinessLayer on window focus', () => {
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const permission = createPermission({ can_share: true });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppNavigationContext.Provider value={{ objectPermissions: { 'view-id': permission } }}>
        {children}
      </AppNavigationContext.Provider>
    );
    const { result } = renderHook(() => useViewActionPermissions(createView(), true), { wrapper });

    expect(result.current.canShare).toBe(true);
    now += 30_000;
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(mockGetObjectPermission).not.toHaveBeenCalled();
    expect(result.current.canShare).toBe(true);
    clock.mockRestore();
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
