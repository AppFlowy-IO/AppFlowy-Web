import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import {
  AccessLevel,
  IPeopleWithAccessType,
  Role,
  SpaceVisibility,
  View,
  ViewLayout,
  WorkspaceGroupViewPermission,
} from '@/application/types';
import { useShareAccessDetails } from '@/components/app/share/useShareAccessDetails';

const mockEventEmitter = new EventEmitter();
const mockGetShareDetail = jest.fn();
const mockGetSharedGroups = jest.fn();
const mockInvalidateShareDetailCache = jest.fn();
const mockGetSpacePermission = jest.fn();
let mockOutline: View[] = [];
let mockWorkspaceRole: Role | undefined;
let mockCurrentUserId = '1001';

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    getShareDetail: (...args: unknown[]) => mockGetShareDetail(...args),
    getSharedGroups: (...args: unknown[]) => mockGetSharedGroups(...args),
    invalidateShareDetailCache: (...args: unknown[]) => mockInvalidateShareDetailCache(...args),
  },
  WorkspaceService: {
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: () => mockOutline,
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
  useUserWorkspaceInfo: () => ({ selectedWorkspace: { memberCount: 2, role: mockWorkspaceRole } }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: mockCurrentUserId, email: 'owner@appflowy.io' }),
}));

const removedPerson: IPeopleWithAccessType = {
  email: 'removed@appflowy.io',
  name: 'Removed user',
  access_level: AccessLevel.ReadOnly,
  role: Role.Guest,
  avatar_url: '',
  pending_invitation: false,
};

const sharedGroup: WorkspaceGroupViewPermission = {
  group_id: 'group-1',
  name: 'Engineering',
  access_level: AccessLevel.ReadOnly,
  member_count: 3,
  source: 'direct',
};

describe('useShareAccessDetails', () => {
  beforeEach(() => {
    mockEventEmitter.removeAllListeners();
    mockGetShareDetail.mockReset();
    mockGetSharedGroups.mockReset();
    mockGetSharedGroups.mockResolvedValue([]);
    mockInvalidateShareDetailCache.mockReset();
    mockGetSpacePermission.mockReset();
    mockGetSpacePermission.mockResolvedValue({
      permission: { visibility: SpaceVisibility.Public },
      can_manage_space: false,
    });
    mockCurrentUserId = '1001';
    mockWorkspaceRole = Role.Member;
    mockOutline = [
      {
        view_id: 'view-1',
        name: 'Shared page',
        icon: null,
        layout: ViewLayout.Document,
        extra: null,
        children: [],
        is_published: false,
        is_private: true,
      },
    ];
  });

  it('only marks direct grants whose effective level matches as editable', async () => {
    const inheritedGroup = {
      ...sharedGroup,
      group_id: 'inherited-group',
      name: 'Inherited team',
      access_level: AccessLevel.ReadAndWrite,
      source: 'ancestor',
    };
    const strongerEffectiveGroup = {
      ...sharedGroup,
      access_level: AccessLevel.FullAccess,
      source: 'ancestor',
    };

    mockGetSharedGroups.mockResolvedValueOnce([sharedGroup]);
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      groups: [strongerEffectiveGroup, inheritedGroup],
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.groups).toEqual([strongerEffectiveGroup, inheritedGroup]));
    expect(result.current.editableGroupIds.size).toBe(0);
    expect(mockGetSharedGroups).toHaveBeenCalledWith('workspace-1', 'view-1');
  });

  it('allows workspace owners to manage Full Access grants on public pages', async () => {
    mockWorkspaceRole = Role.Owner;
    mockOutline[0].is_private = false;
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));
    expect(mockGetSpacePermission).not.toHaveBeenCalled();
  });

  it('allows an ancestor creator to manage Full Access grants on public pages', async () => {
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Public space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [
          {
            ...mockOutline[0],
            is_private: false,
          },
        ],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
        ancestor_creator: true,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', 'space-1');
  });

  it('preserves legacy creator authority when the structured route returns HTTP 404', async () => {
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Legacy public space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [{ ...mockOutline[0], is_private: false }],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetSpacePermission.mockRejectedValueOnce({ code: 404, httpStatus: 404, message: 'Unsupported route' });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
        ancestor_creator: true,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));
  });

  it('preserves legacy workspace-owner authority when the structured route returns HTTP 405', async () => {
    mockWorkspaceRole = Role.Owner;
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Legacy public space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [{ ...mockOutline[0], is_private: false }],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetSpacePermission.mockRejectedValueOnce({ code: 405, httpStatus: 405, message: 'Unsupported route' });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: { access_level: AccessLevel.FullAccess },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));
  });

  it('uses the private-space owner capability to manage Full Access grants', async () => {
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Private space',
        icon: null,
        layout: ViewLayout.Document,
        extra: null,
        is_space: true,
        children: [mockOutline[0]],
        is_published: false,
        is_private: true,
      },
    ];
    mockGetSpacePermission.mockResolvedValueOnce({
      permission: { visibility: SpaceVisibility.Private },
      can_manage_space: true,
    });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', 'space-1');
  });

  it('uses the custom-space owner capability for a workspace member', async () => {
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Custom space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [{ ...mockOutline[0], is_private: false }],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetSpacePermission.mockResolvedValueOnce({
      permission: { visibility: SpaceVisibility.Custom },
      can_manage_space: true,
    });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
        object_creator: false,
        ancestor_creator: false,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));
    expect(mockWorkspaceRole).toBe(Role.Member);
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', 'space-1');
  });

  it.each([
    [
      'Custom Can view and comment',
      SpaceVisibility.Custom,
      undefined,
      AccessLevel.ReadAndComment,
      AccessLevel.ReadAndComment,
    ],
    ['Custom No access', SpaceVisibility.Custom, undefined, null, null],
    ['Public Can edit', SpaceVisibility.Public, AccessLevel.ReadAndWrite, undefined, AccessLevel.ReadAndWrite],
    ['Private Restricted', SpaceVisibility.Private, AccessLevel.ReadAndWrite, undefined, null],
  ])(
    'exposes %s from the governing space as General access',
    async (_label, visibility, memberDefault, everyoneElse, expected) => {
      mockOutline = [
        {
          view_id: 'space-1',
          name: 'Structured space',
          icon: null,
          layout: ViewLayout.Document,
          extra: { is_space: true },
          children: [{ ...mockOutline[0], is_private: visibility === SpaceVisibility.Private }],
          is_published: false,
          is_private: visibility === SpaceVisibility.Private,
        },
      ];
      mockGetSpacePermission.mockResolvedValueOnce({
        permission: {
          visibility,
          member_default_access_level: memberDefault,
          everyone_else_access_level: everyoneElse,
        },
        can_manage_space: false,
      });
      mockGetShareDetail.mockResolvedValueOnce({
        shared_with: [],
        current_user_permission: { access_level: AccessLevel.FullAccess },
      });

      const { result } = renderHook(() => useShareAccessDetails('view-1', true));

      await waitFor(() => expect(result.current.generalAccessLevel).toBe(expected));
    }
  );

  it('uses Can view for Custom General access when an older server omits the additive field', async () => {
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Custom space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [{ ...mockOutline[0], is_private: false }],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetSpacePermission.mockResolvedValueOnce({
      permission: { visibility: SpaceVisibility.Custom },
      can_manage_space: false,
    });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: { access_level: AccessLevel.FullAccess },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.generalAccessLevel).toBe(AccessLevel.ReadOnly));
  });

  it('does not replace a denied custom-space capability with creator signals', async () => {
    mockWorkspaceRole = Role.Owner;
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Custom space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [{ ...mockOutline[0], is_private: false }],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetSpacePermission.mockResolvedValueOnce({
      permission: { visibility: SpaceVisibility.Custom },
      can_manage_space: false,
    });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
        object_creator: true,
        ancestor_creator: true,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.hasFullAccess).toBe(true));
    expect(result.current.canManageFullAccess).toBe(false);
  });

  it('does not grant private-space authority to a workspace owner or page creator', async () => {
    mockWorkspaceRole = Role.Owner;
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Private space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [mockOutline[0]],
        is_published: false,
        is_private: true,
      },
    ];
    mockGetSpacePermission.mockResolvedValueOnce({
      permission: { visibility: SpaceVisibility.Private },
      can_manage_space: false,
    });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
        object_creator: true,
        ancestor_creator: true,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.hasFullAccess).toBe(true));
    expect(result.current.canManageFullAccess).toBe(false);
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', 'space-1');
  });

  it('normalizes legacy closed visibility before allowing the space owner capability', async () => {
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Legacy closed space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [mockOutline[0]],
        is_published: false,
        is_private: true,
      },
    ];
    mockGetSpacePermission.mockResolvedValueOnce({
      permission: { visibility: 'closed' as SpaceVisibility },
      can_manage_space: true,
    });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
        object_creator: false,
        ancestor_creator: false,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));
  });

  it('does not replace a denied legacy closed capability with public creator signals', async () => {
    mockWorkspaceRole = Role.Owner;
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Legacy closed space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [mockOutline[0]],
        is_published: false,
        is_private: true,
      },
    ];
    mockGetSpacePermission.mockResolvedValueOnce({
      permission: { visibility: 'closed' as SpaceVisibility },
      can_manage_space: false,
    });
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
        object_creator: true,
        ancestor_creator: true,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.hasFullAccess).toBe(true));
    expect(result.current.canManageFullAccess).toBe(false);
  });

  it('rechecks governing visibility before applying a permission event refresh', async () => {
    mockWorkspaceRole = Role.Owner;
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Transitioning space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [
          {
            ...mockOutline[0],
            is_private: false,
          },
        ],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetSpacePermission
      .mockResolvedValueOnce({
        permission: { visibility: SpaceVisibility.Public },
        can_manage_space: true,
      })
      .mockResolvedValueOnce({
        permission: { visibility: SpaceVisibility.Private },
        can_manage_space: false,
      });
    mockGetShareDetail
      .mockResolvedValueOnce({
        shared_with: [],
        current_user_permission: { access_level: AccessLevel.FullAccess },
      })
      .mockResolvedValueOnce({
        shared_with: [],
        current_user_permission: { access_level: AccessLevel.FullAccess },
      });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space-1' });
    });

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(false));
    expect(mockGetSpacePermission).toHaveBeenCalledTimes(2);
  });

  it('uses the governing public-space authority over a stale private child flag', async () => {
    mockWorkspaceRole = Role.Owner;
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Public space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [mockOutline[0]],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.canManageFullAccess).toBe(true));
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', 'space-1');
  });

  it('does not infer creator authority from rounded Snowflake IDs', async () => {
    mockCurrentUserId = '9007199254740992';
    const roundedCreatorSpace = {
      view_id: 'space-1',
      created_by: Number('9007199254740993'),
      name: 'Public space',
      icon: null,
      layout: ViewLayout.Document,
      extra: { is_space: true },
      children: [{ ...mockOutline[0], is_private: false }],
      is_published: false,
      is_private: false,
    } as View & { created_by: number };

    expect(String(roundedCreatorSpace.created_by)).toBe(mockCurrentUserId);
    mockOutline = [roundedCreatorSpace];
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
        object_creator: false,
        ancestor_creator: false,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.hasFullAccess).toBe(true));
    expect(result.current.canManageFullAccess).toBe(false);
  });

  it('fails closed when governing space visibility cannot be verified', async () => {
    mockWorkspaceRole = Role.Owner;
    mockOutline = [
      {
        view_id: 'space-1',
        name: 'Unresolved space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [{ ...mockOutline[0], is_private: false }],
        is_published: false,
        is_private: false,
      },
    ];
    mockGetSpacePermission.mockRejectedValueOnce(new Error('space permission unavailable'));
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: { access_level: AccessLevel.FullAccess },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.hasFullAccess).toBe(true));
    expect(result.current.canManageFullAccess).toBe(false);
  });

  it('does not treat effective Full Access alone as Full Access management authority', async () => {
    mockOutline[0].is_private = false;
    mockGetShareDetail.mockResolvedValueOnce({
      shared_with: [],
      current_user_permission: {
        access_level: AccessLevel.FullAccess,
      },
    });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.hasFullAccess).toBe(true));
    expect(result.current.canManageFullAccess).toBe(false);
  });

  it('keeps the last same-view direct snapshot when its refresh fails', async () => {
    mockGetSharedGroups.mockResolvedValueOnce([sharedGroup]).mockRejectedValueOnce(new Error('direct list failed'));
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [], groups: [sharedGroup] })
      .mockResolvedValueOnce({ shared_with: [], groups: [sharedGroup] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.editableGroupIds.has(sharedGroup.group_id)).toBe(true));

    await act(async () => {
      await result.current.loadPeople();
    });

    expect(result.current.editableGroupIds.has(sharedGroup.group_id)).toBe(true);
  });

  it('does not leak direct editability when switching views and the new direct read fails', async () => {
    const secondViewGroup = {
      ...sharedGroup,
      group_id: 'group-2',
      name: 'Second view team',
      source: 'ancestor',
    };

    mockGetSharedGroups.mockResolvedValueOnce([sharedGroup]).mockRejectedValueOnce(new Error('direct list failed'));
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [], groups: [sharedGroup] })
      .mockResolvedValueOnce({ shared_with: [], groups: [secondViewGroup] });

    const { result, rerender } = renderHook(({ viewId }) => useShareAccessDetails(viewId, true), {
      initialProps: { viewId: 'view-1' },
    });

    await waitFor(() => expect(result.current.editableGroupIds.has(sharedGroup.group_id)).toBe(true));

    rerender({ viewId: 'view-2' });

    await waitFor(() => expect(result.current.groups).toEqual([secondViewGroup]));
    expect(result.current.editableGroupIds.size).toBe(0);
  });

  it('retains confirmed optimistic direct access when revalidation fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const updatedGroup = { ...sharedGroup, access_level: AccessLevel.ReadAndWrite };

    mockGetSharedGroups.mockResolvedValueOnce([sharedGroup]).mockRejectedValueOnce(new Error('direct list failed'));
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [], groups: [sharedGroup] })
      .mockRejectedValueOnce({ code: 1000, message: 'effective list failed' });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.editableGroupIds.has(sharedGroup.group_id)).toBe(true));

    act(() => result.current.updateGroupInAccessList(sharedGroup.group_id, AccessLevel.ReadAndWrite));
    expect(result.current.groups).toEqual([updatedGroup]);
    expect(result.current.editableGroupIds.has(sharedGroup.group_id)).toBe(true);

    await act(async () => {
      await result.current.loadPeople();
    });

    expect(result.current.groups).toEqual([updatedGroup]);
    expect(result.current.editableGroupIds.has(sharedGroup.group_id)).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it('invalidates and reloads an open access list after a remote share change', async () => {
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson] })
      .mockResolvedValueOnce({ shared_with: [] });

    const { result, unmount } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: 'view-1',
        emails: [removedPerson.email],
      });
    });

    await waitFor(() => expect(result.current.people).toEqual([]));
    expect(mockInvalidateShareDetailCache).toHaveBeenCalledWith('workspace-1');
    expect(mockGetShareDetail).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('refreshes group access in an open panel after a permission change', async () => {
    const updatedGroup = { ...sharedGroup, access_level: AccessLevel.ReadAndWrite };

    mockGetSharedGroups.mockResolvedValueOnce([sharedGroup]).mockResolvedValueOnce([updatedGroup]);
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [], groups: [sharedGroup] })
      .mockResolvedValueOnce({ shared_with: [], groups: [updatedGroup] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.groups).toEqual([sharedGroup]));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'group-1' });
    });

    await waitFor(() => expect(result.current.groups).toEqual([updatedGroup]));
    expect(mockInvalidateShareDetailCache).not.toHaveBeenCalled();
    expect(mockGetShareDetail).toHaveBeenCalledTimes(2);
    expect(mockGetSharedGroups).toHaveBeenCalledTimes(2);
  });

  it('removes a successfully revoked person from local state immediately', async () => {
    mockGetShareDetail.mockResolvedValueOnce({ shared_with: [removedPerson] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    act(() => result.current.removePersonFromAccessList('REMOVED@appflowy.io'));

    expect(result.current.people).toEqual([]);
  });

  it('optimistically updates and removes a group while a failed refresh keeps the local result', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson], groups: [sharedGroup] })
      .mockRejectedValueOnce({ code: 1000, message: 'Unknown refresh failure' });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.groups).toEqual([sharedGroup]));

    act(() => result.current.updateGroupInAccessList(sharedGroup.group_id, AccessLevel.ReadAndWrite));
    expect(result.current.groups[0].access_level).toBe(AccessLevel.ReadAndWrite);

    act(() => result.current.updateGroupInAccessList(sharedGroup.group_id, null));
    expect(result.current.groups).toEqual([]);

    await act(async () => {
      await result.current.loadPeople();
    });
    expect(result.current.groups).toEqual([]);
    consoleErrorSpy.mockRestore();
  });

  it('keeps an optimistic group update over an in-flight response but accepts a later response', async () => {
    let resolveStaleResponse:
      | ((value: { shared_with: IPeopleWithAccessType[]; groups: WorkspaceGroupViewPermission[] }) => void)
      | undefined;
    const authoritativeGroup = { ...sharedGroup, access_level: AccessLevel.FullAccess };

    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson], groups: [sharedGroup] })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleResponse = resolve;
          })
      )
      .mockResolvedValueOnce({ shared_with: [removedPerson], groups: [authoritativeGroup] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.groups).toEqual([sharedGroup]));

    act(() => {
      void result.current.loadPeople();
    });
    await waitFor(() => expect(resolveStaleResponse).toBeDefined());

    act(() => result.current.updateGroupInAccessList(sharedGroup.group_id, AccessLevel.ReadAndWrite));
    expect(result.current.groups[0].access_level).toBe(AccessLevel.ReadAndWrite);

    await act(async () => {
      resolveStaleResponse?.({ shared_with: [removedPerson], groups: [sharedGroup] });
      await Promise.resolve();
    });
    expect(result.current.groups[0].access_level).toBe(AccessLevel.ReadAndWrite);

    await act(async () => {
      await result.current.loadPeople();
    });
    expect(result.current.groups).toEqual([authoritativeGroup]);
  });

  it('clears stale people and privileged controls after a definitive denial', async () => {
    mockOutline[0].access_level = AccessLevel.FullAccess;
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson], groups: [sharedGroup] })
      .mockRejectedValueOnce({ code: 1012, message: 'Not enough permissions' });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.hasFullAccess).toBe(true));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'view-1' });
    });

    await waitFor(() => expect(result.current.people).toEqual([]));
    expect(result.current.groups).toEqual([]);
    expect(result.current.currentUserAccessLevel).toBeUndefined();
    expect(result.current.hasFullAccess).toBe(false);
  });

  it('retries a transient notification refresh and applies the fresh list', async () => {
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson] })
      .mockRejectedValueOnce({ code: 1079, message: 'Refreshing', retryAfterSecs: 0 })
      .mockResolvedValueOnce({ shared_with: [] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'view-1' });
    });

    await waitFor(() => expect(result.current.people).toEqual([]));
    expect(mockGetShareDetail).toHaveBeenCalledTimes(3);
    expect(mockInvalidateShareDetailCache).toHaveBeenCalledTimes(2);
  });

  it('filters an in-flight pre-revoke response but allows a later re-share', async () => {
    let resolveStaleResponse: ((value: { shared_with: IPeopleWithAccessType[] }) => void) | undefined;

    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson] })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleResponse = resolve;
          })
      )
      .mockResolvedValueOnce({ shared_with: [removedPerson] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    act(() => {
      void result.current.loadPeople();
    });
    await waitFor(() => expect(resolveStaleResponse).toBeDefined());

    act(() => {
      result.current.removePersonFromAccessList(removedPerson.email);
    });
    expect(result.current.people).toEqual([]);

    act(() => resolveStaleResponse?.({ shared_with: [removedPerson] }));
    await waitFor(() => expect(mockGetShareDetail).toHaveBeenCalledTimes(2));
    expect(result.current.people).toEqual([]);

    // A request started after the revoke/cache invalidation is authoritative;
    // if it contains the email, another client has legitimately re-shared it.
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'view-1' });
    });
    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));
    expect(mockGetShareDetail).toHaveBeenCalledTimes(3);
  });

  it('ignores share notifications for unrelated views', async () => {
    mockGetShareDetail.mockResolvedValueOnce({ shared_with: [removedPerson] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    await act(async () => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'unrelated-view' });
      await Promise.resolve();
    });

    expect(mockGetShareDetail).toHaveBeenCalledTimes(1);
    expect(mockInvalidateShareDetailCache).not.toHaveBeenCalled();
  });

  it('aborts an event-triggered refresh when the share panel closes', async () => {
    let notificationSignal: AbortSignal | undefined;

    mockGetShareDetail.mockResolvedValueOnce({ shared_with: [removedPerson] }).mockImplementationOnce(
      (_workspaceId: string, _viewId: string, _ancestorViewIds: string[], signal: AbortSignal) =>
        new Promise((resolve) => {
          notificationSignal = signal;
          signal.addEventListener('abort', () => resolve({ shared_with: [] }), { once: true });
        })
    );

    const { result, rerender } = renderHook(({ opened }) => useShareAccessDetails('view-1', opened), {
      initialProps: { opened: true },
    });

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'view-1' });
    });
    await waitFor(() => expect(notificationSignal).toBeDefined());

    rerender({ opened: false });

    expect(notificationSignal?.aborted).toBe(true);
  });
});
