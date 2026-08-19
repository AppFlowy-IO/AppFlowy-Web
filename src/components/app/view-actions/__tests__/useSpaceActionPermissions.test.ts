import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { SpacePermissionResponse, View } from '@/application/types';
import { useSpaceActionPermissions } from '@/components/app/view-actions/useSpaceActionPermissions';

const mockGetSpacePermission = jest.fn();
const mockEventEmitter = new EventEmitter();

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
}));

const spaceView = {
  view_id: 'space-1',
  extra: { is_space: true },
} as View;

function capabilities(
  overrides: Partial<
    Pick<SpacePermissionResponse, 'can_edit_sidebar' | 'can_invite_members' | 'can_manage_members' | 'can_manage_space'>
  >
): SpacePermissionResponse {
  return {
    can_edit_sidebar: false,
    can_invite_members: false,
    can_manage_members: false,
    can_manage_space: false,
    ...overrides,
  } as SpacePermissionResponse;
}

describe('useSpaceActionPermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter.removeAllListeners();
  });

  it('loads the sidebar-edit capability independently from full space management', async () => {
    mockGetSpacePermission.mockResolvedValue(
      capabilities({
        can_edit_sidebar: true,
      })
    );

    const { result } = renderHook(() => useSpaceActionPermissions(spaceView, true));

    expect(result.current.canOpenManageSpace).toBe(false);
    await waitFor(() => expect(result.current.hasLoadedSpaceActionPermissions).toBe(true));

    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', 'space-1');
    expect(result.current.canOpenManageSpace).toBe(true);
  });

  it('allows invite-only members to open Manage Space', async () => {
    mockGetSpacePermission.mockResolvedValue(
      capabilities({
        can_invite_members: true,
      })
    );

    const { result } = renderHook(() => useSpaceActionPermissions(spaceView, true));

    await waitFor(() => expect(result.current.hasLoadedSpaceActionPermissions).toBe(true));

    expect(result.current.canOpenManageSpace).toBe(true);
  });

  it('allows member managers to open Manage Space', async () => {
    mockGetSpacePermission.mockResolvedValue(
      capabilities({
        can_manage_members: true,
      })
    );

    const { result } = renderHook(() => useSpaceActionPermissions(spaceView, true));

    await waitFor(() => expect(result.current.hasLoadedSpaceActionPermissions).toBe(true));

    expect(result.current.canOpenManageSpace).toBe(true);
  });

  it('fails closed when structured-space capabilities cannot be loaded', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetSpacePermission.mockRejectedValue(new Error('permission unavailable'));
    const { result } = renderHook(() => useSpaceActionPermissions(spaceView, true));

    await waitFor(() => expect(result.current.hasLoadedSpaceActionPermissions).toBe(true));

    expect(result.current.canOpenManageSpace).toBe(false);
    consoleError.mockRestore();
  });

  it.each([404, 405])('retains legacy management when the structured route returns HTTP %s', async (status) => {
    mockGetSpacePermission.mockRejectedValue({ code: status, httpStatus: status, message: 'Unsupported route' });
    const { result } = renderHook(() => useSpaceActionPermissions(spaceView, true, true));

    await waitFor(() => expect(result.current.hasLoadedSpaceActionPermissions).toBe(true));

    expect(result.current.canOpenManageSpace).toBe(true);
  });

  it('does not treat a payload-level not-found response as an unsupported route', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetSpacePermission.mockRejectedValue({
      code: ERROR_CODE.RECORD_NOT_FOUND,
      httpStatus: 404,
      message: 'Space not found',
    });
    const { result } = renderHook(() => useSpaceActionPermissions(spaceView, true, true));

    await waitFor(() => expect(result.current.hasLoadedSpaceActionPermissions).toBe(true));

    expect(result.current.canOpenManageSpace).toBe(false);
    consoleError.mockRestore();
  });

  it('revalidates a group-derived capability while the action menu stays open', async () => {
    mockGetSpacePermission
      .mockResolvedValueOnce(capabilities({ can_edit_sidebar: true }))
      .mockResolvedValueOnce(capabilities({ can_edit_sidebar: false }));

    const { result } = renderHook(() => useSpaceActionPermissions(spaceView, true));

    await waitFor(() => expect(result.current.canOpenManageSpace).toBe(true));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    expect(result.current.canOpenManageSpace).toBe(false);
    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.hasLoadedSpaceActionPermissions).toBe(true));
    expect(result.current.canOpenManageSpace).toBe(false);
  });
});
