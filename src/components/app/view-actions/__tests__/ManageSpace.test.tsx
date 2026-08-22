import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import {
  AccessLevel,
  Role,
  SpaceInvitePolicy,
  SpaceListItem,
  SpaceMember,
  SpaceMemberRole,
  SpacePermission,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
  View,
  ViewLayout,
  WorkspaceGroupSpacePermission,
  WorkspaceMember,
} from '@/application/types';
import ManageSpace from '@/components/app/view-actions/ManageSpace';

import type { ReactNode } from 'react';

const mockUpdateSpace = jest.fn();
const mockGetSpacePermission = jest.fn();
const mockGetSpaces = jest.fn();
const mockUpdateStructuredSpace = jest.fn();
const mockGetSpaceMembers = jest.fn();
const mockGetMembers = jest.fn();
const mockAddSpaceMember = jest.fn();
const mockUpdateSpaceMember = jest.fn();
const mockRemoveSpaceMember = jest.fn();
const mockUpdateSpaceGroupPermission = jest.fn();
const mockRemoveSpaceGroupPermission = jest.fn();
const mockEventEmitter = new EventEmitter();
const mockUseAddableWorkspaceMembers = jest.fn(
  ({ workspaceMembers, excludePending }: { workspaceMembers: WorkspaceMember[]; excludePending?: boolean }) =>
    workspaceMembers.filter((member) => !excludePending || !member.is_pending_invitation)
);
const mockTranslate = (key: string) => key;

const mockViews: Record<string, View> = {
  'space-1': createView('space-1', 'Space one'),
  'space-2': createView('space-2', 'Space two'),
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
    getSpaces: (...args: unknown[]) => mockGetSpaces(...args),
    updateStructuredSpace: (...args: unknown[]) => mockUpdateStructuredSpace(...args),
    getSpaceMembers: (...args: unknown[]) => mockGetSpaceMembers(...args),
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    addSpaceMember: (...args: unknown[]) => mockAddSpaceMember(...args),
    updateSpaceMember: (...args: unknown[]) => mockUpdateSpaceMember(...args),
    removeSpaceMember: (...args: unknown[]) => mockRemoveSpaceMember(...args),
    updateSpaceGroupPermission: (...args: unknown[]) => mockUpdateSpaceGroupPermission(...args),
    removeSpaceGroupPermission: (...args: unknown[]) => mockRemoveSpaceGroupPermission(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ updateSpace: mockUpdateSpace }),
  useAppView: (viewId: string) => mockViews[viewId],
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
  useUserWorkspaceInfo: () => ({ selectedWorkspace: { name: 'Workspace one' } }),
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    children,
    open,
    onOk,
    okButtonProps,
  }: {
    children: ReactNode;
    open: boolean;
    onOk: () => void;
    okButtonProps?: { disabled?: boolean };
  }) =>
    open ? (
      <div>
        <button data-testid='manage-space-save' disabled={okButtonProps?.disabled} onClick={onOk}>
          save
        </button>
        {children}
      </div>
    ) : null,
}));

jest.mock('@/components/app/share/WorkspaceMemberInlineSearch', () => ({
  getWorkspaceMemberUid: (member: WorkspaceMember) => member.uid,
  useAddableWorkspaceMembers: (args: unknown) => mockUseAddableWorkspaceMembers(args),
  WorkspaceMemberInlineSearch: ({
    addableMembers,
    inputDisabled,
    addButtonDisabled,
    onAddMember,
  }: {
    addableMembers: WorkspaceMember[];
    inputDisabled?: boolean;
    addButtonDisabled?: boolean;
    onAddMember: (member: WorkspaceMember) => void;
  }) => (
    <div>
      <input data-testid='inline-member-search' disabled={inputDisabled} />
      <button
        data-testid='inline-member-add'
        disabled={addButtonDisabled || addableMembers.length === 0}
        onClick={() => onAddMember(addableMembers[0])}
      >
        add
      </button>
    </div>
  ),
}));

jest.mock('@/components/app/view-actions/SpaceIconButton', () => ({
  __esModule: true,
  default: () => <div data-testid='space-icon-button' />,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
    'data-testid': testId,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
    'data-testid'?: string;
  }) => (
    <button data-testid={testId} type='button' disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuItemTick: () => <span>selected</span>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/progress', () => ({
  Progress: () => <span data-testid='progress' />,
}));

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

const openPermission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Open,
  owner_access_level: AccessLevel.FullAccess,
  member_default_access_level: AccessLevel.ReadAndWrite,
  everyone_else_access_level: AccessLevel.ReadOnly,
  invite_policy: SpaceInvitePolicy.OwnersOnly,
  sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
  invite_link_enabled: false,
  security: {
    disable_guests: false,
    disable_public_links: false,
    disable_export: false,
  },
};

const workspaceCandidate: WorkspaceMember = {
  uid: '1234567890123456',
  name: 'Candidate',
  email: 'candidate@appflowy.io',
  avatar_url: '',
  role: Role.Member,
};

function createView(viewId: string, name: string): View {
  return {
    view_id: viewId,
    name,
    icon: null,
    layout: ViewLayout.Document,
    extra: {
      is_space: true,
      space_icon: 'space',
      space_icon_color: '#000000',
    },
    children: [],
    is_space: true,
    is_published: false,
    is_private: false,
  };
}

function permissionResponse(
  overrides: {
    permission?: SpacePermissionSettings;
    canManageSpace?: boolean;
    canManageMembers?: boolean;
    canInviteMembers?: boolean;
    canEditSidebar?: boolean;
  } = {}
) {
  return {
    space_id: 'space-1',
    permission: overrides.permission ?? openPermission,
    can_manage_space: overrides.canManageSpace ?? true,
    can_manage_members: overrides.canManageMembers ?? true,
    can_invite_members: overrides.canInviteMembers ?? true,
    can_edit_sidebar: overrides.canEditSidebar ?? true,
    explicit_member_count: 0,
  };
}

function listedSpace(spaceId: string, visibility: SpaceVisibility): SpaceListItem {
  return {
    space_id: spaceId,
    name: spaceId,
    permission: { ...openPermission, visibility },
    current_user_access_level: AccessLevel.FullAccess,
    explicit_member_count: 1,
    is_explicit_member: true,
    can_join: false,
    can_leave: visibility !== SpaceVisibility.Default,
  };
}

function group(groupId: string, name: string, role = SpaceMemberRole.Member): WorkspaceGroupSpacePermission {
  return {
    group_id: groupId,
    name,
    role,
    access_level: role === SpaceMemberRole.Owner ? AccessLevel.FullAccess : AccessLevel.ReadOnly,
    member_count: 2,
    source: 'manual',
  };
}

function manualMember(): SpaceMember {
  return {
    uid: '2345678901234567',
    name: 'Manual member',
    email: 'manual-member@appflowy.io',
    role: SpaceMemberRole.Member,
    access_level: AccessLevel.ReadAndWrite,
    source: 'manual',
  };
}

function creatorMember(): SpaceMember {
  return {
    uid: '3456789012345678',
    name: 'Space creator',
    email: 'space-creator@appflowy.io',
    role: SpaceMemberRole.Owner,
    access_level: AccessLevel.FullAccess,
    source: 'creator',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe('ManageSpace ACL management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter.removeAllListeners();
    mockUpdateSpace.mockResolvedValue(undefined);
    mockUpdateStructuredSpace.mockResolvedValue({ view_id: 'space-1' });
    mockGetSpacePermission.mockResolvedValue(permissionResponse());
    mockGetSpaces.mockResolvedValue({ spaces: [] });
    mockGetSpaceMembers.mockResolvedValue({ members: [], groups: [] });
    mockGetMembers.mockResolvedValue([workspaceCandidate]);
    mockAddSpaceMember.mockResolvedValue(undefined);
    mockUpdateSpaceMember.mockResolvedValue(undefined);
    mockRemoveSpaceMember.mockResolvedValue(undefined);
    mockUpdateSpaceGroupPermission.mockResolvedValue(undefined);
    mockRemoveSpaceGroupPermission.mockResolvedValue(undefined);
  });

  it('hides Open and Closed while allowing Private to be selected', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    expect(screen.queryByTestId(`manage-space-visibility-option-${SpaceVisibility.Open}`)).toBeNull();
    expect(screen.queryByTestId(`manage-space-visibility-option-${SpaceVisibility.Closed}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Private}`));

    const fallbackRow = screen.getByTestId('manage-space-workspace-fallback-row');

    expect(within(fallbackRow).getAllByRole('button')[0].disabled).toBe(true);
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
        'workspace-1',
        'space-1',
        expect.objectContaining({
          permission: expect.objectContaining({
            visibility: SpaceVisibility.Private,
            everyone_else_access_level: null,
          }),
        })
      )
    );
  });

  it('atomically saves metadata and a changed structured ACL without a legacy visibility update', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    const defaultAccessRow = screen.getByTestId('manage-space-members-default-access-row');

    fireEvent.click(within(defaultAccessRow).getByRole('button', { name: 'shareAction.canView' }));
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Updated space' },
    });
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
    expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
      name: 'Updated space',
      space_icon: 'space',
      space_icon_color: '#000000',
      permission: {
        ...openPermission,
        member_default_access_level: AccessLevel.ReadOnly,
      },
    });
    expect(mockUpdateSpace).not.toHaveBeenCalled();
    expect(mockUpdateStructuredSpace.mock.calls[0][2]).not.toHaveProperty('space_permission');
  });

  it.each([404, 405])(
    'uses the legacy binary space editor when the structured route returns HTTP %s',
    async (status) => {
      mockGetSpacePermission.mockRejectedValueOnce({ code: status, httpStatus: status, message: 'Unsupported route' });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(screen.getByTestId('manage-space-save').disabled).toBe(false));

      expect(screen.queryByText('space.permissionManager.membersTab')).toBeNull();
      expect(screen.queryByTestId('manage-space-members-default-access-row')).toBeNull();
      expect(screen.queryByTestId(`manage-space-visibility-option-${SpaceVisibility.Open}`)).toBeNull();
      expect(screen.queryByTestId(`manage-space-visibility-option-${SpaceVisibility.Closed}`)).toBeNull();
      expect(screen.queryByTestId(`manage-space-visibility-option-${SpaceVisibility.Default}`)).toBeNull();

      fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Private}`));
      fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
        target: { value: 'Legacy renamed space' },
      });
      fireEvent.click(screen.getByTestId('manage-space-save'));

      await waitFor(() =>
        expect(mockUpdateSpace).toHaveBeenCalledWith({
          view_id: 'space-1',
          name: 'Legacy renamed space',
          space_icon: 'space',
          space_icon_color: '#000000',
          space_permission: SpacePermission.Private,
        })
      );
      expect(mockUpdateStructuredSpace).not.toHaveBeenCalled();
    }
  );

  it('omits an unchanged permission from a manager metadata-only save', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-save').disabled).toBe(false));
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Metadata only' },
    });
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        name: 'Metadata only',
        space_icon: 'space',
        space_icon_color: '#000000',
      })
    );
    expect(mockUpdateStructuredSpace.mock.calls[0][2]).not.toHaveProperty('permission');
  });

  it('lets sidebar editors save metadata without sending a permission update', async () => {
    mockGetSpacePermission.mockResolvedValue(
      permissionResponse({
        canManageSpace: false,
        canManageMembers: false,
        canInviteMembers: false,
        canEditSidebar: true,
      })
    );
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-save').disabled).toBe(false));
    expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Renamed by member' },
    });
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        name: 'Renamed by member',
        space_icon: 'space',
        space_icon_color: '#000000',
      })
    );
    expect(mockUpdateStructuredSpace.mock.calls[0][2]).not.toHaveProperty('permission');
  });

  it('revalidates live permissions and member groups while failing closed after sidebar access is revoked', async () => {
    const initialGroup = group('group-1', 'Initial group');
    const refreshedGroup = group('group-2', 'Refreshed group');
    const revokedPermission = deferred<ReturnType<typeof permissionResponse>>();

    mockGetSpacePermission
      .mockResolvedValueOnce(
        permissionResponse({
          canManageSpace: false,
          canManageMembers: true,
          canInviteMembers: false,
          canEditSidebar: true,
        })
      )
      .mockReturnValueOnce(revokedPermission.promise);
    mockGetSpaceMembers
      .mockResolvedValueOnce({ members: [], groups: [initialGroup] })
      .mockResolvedValueOnce({ members: [], groups: [refreshedGroup] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await screen.findByTestId('space-group-row-group-1');
    expect(screen.getByTestId('manage-space-save').disabled).toBe(false);
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false);

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('manage-space-save').disabled).toBe(true);
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
    expect(screen.queryByTestId('space-group-row-group-1')).toBeNull();

    await act(async () => {
      revokedPermission.resolve(
        permissionResponse({
          canManageSpace: false,
          canManageMembers: true,
          canInviteMembers: false,
          canEditSidebar: false,
        })
      );
    });

    await screen.findByTestId('space-group-row-group-2');
    expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('space-group-row-group-1')).toBeNull();
    expect(screen.getByTestId('manage-space-save').disabled).toBe(true);
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
  });

  it('ignores an older permission refresh that resolves after a newer revocation', async () => {
    const stalePermission = deferred<ReturnType<typeof permissionResponse>>();
    const latestPermission = deferred<ReturnType<typeof permissionResponse>>();

    mockGetSpacePermission
      .mockResolvedValueOnce(
        permissionResponse({
          canManageSpace: false,
          canManageMembers: false,
          canInviteMembers: false,
          canEditSidebar: true,
        })
      )
      .mockReturnValueOnce(stalePermission.promise)
      .mockReturnValueOnce(latestPermission.promise);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-save').disabled).toBe(false));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'first-change' });
    });
    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'newer-change' });
    });
    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(3));

    await act(async () => {
      latestPermission.resolve(
        permissionResponse({
          canManageSpace: false,
          canManageMembers: false,
          canInviteMembers: false,
          canEditSidebar: false,
        })
      );
    });
    await waitFor(() => expect(screen.getByTestId('manage-space-save').disabled).toBe(true));

    await act(async () => {
      stalePermission.resolve(
        permissionResponse({
          canManageSpace: false,
          canManageMembers: false,
          canInviteMembers: false,
          canEditSidebar: true,
        })
      );
    });

    expect(screen.getByTestId('manage-space-save').disabled).toBe(true);
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
  });

  it('hides Default when another active Default space already exists', async () => {
    mockGetSpaces.mockResolvedValue({ spaces: [listedSpace('space-default', SpaceVisibility.Default)] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));

    expect(screen.queryByTestId('manage-space-visibility-option-default')).toBeNull();
  });

  it('retains the current legacy Default and omits its unchanged ACL when another Default exists', async () => {
    const defaultPermission = { ...openPermission, visibility: SpaceVisibility.Default };

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: defaultPermission }));
    mockGetSpaces.mockResolvedValue({
      spaces: [listedSpace('space-1', SpaceVisibility.Default), listedSpace('space-default', SpaceVisibility.Default)],
    });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));

    expect(screen.getByTestId('manage-space-visibility-option-default')).toBeTruthy();
    fireEvent.click(screen.getByTestId('manage-space-visibility-option-private'));
    expect(screen.getByTestId('manage-space-visibility-option-default')).toBeTruthy();
    fireEvent.click(screen.getByTestId('manage-space-visibility-option-default'));
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Legacy Default renamed' },
    });
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        name: 'Legacy Default renamed',
        space_icon: 'space',
        space_icon_color: '#000000',
      })
    );
    expect(mockUpdateStructuredSpace.mock.calls[0][2]).not.toHaveProperty('permission');
  });

  it('keeps management available but hides Default when space discovery fails', async () => {
    mockGetSpacePermission.mockResolvedValue(permissionResponse({ canManageSpace: true, canEditSidebar: false }));
    mockGetSpaces.mockRejectedValue(new Error('space list unavailable'));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-save').disabled).toBe(false));

    expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false);
    expect(screen.queryByTestId('manage-space-visibility-option-default')).toBeNull();
  });

  it('changes the member default without overwriting a manual member grant', async () => {
    const member = manualMember();

    mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await screen.findByTestId(`space-member-row-${member.uid}`);
    const defaultAccessRow = screen.getByTestId('manage-space-members-default-access-row');

    fireEvent.click(within(defaultAccessRow).getByRole('button', { name: 'shareAction.canView' }));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
        'workspace-1',
        'space-1',
        expect.objectContaining({
          permission: expect.objectContaining({
            member_default_access_level: AccessLevel.ReadOnly,
          }),
        })
      )
    );
    expect(mockUpdateSpaceMember).not.toHaveBeenCalled();
  });

  it('updates and allows removal of creator-sourced explicit members', async () => {
    const member = creatorMember();

    mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    const row = await screen.findByTestId(`space-member-row-${member.uid}`);
    const removeButton = within(row).getByRole('button', { name: 'space.permissionManager.remove' });

    expect(removeButton.disabled).toBe(false);
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'space.permissionManager.member space.permissionManager.memberRoleDescription',
      })
    );

    await waitFor(() =>
      expect(mockUpdateSpaceMember).toHaveBeenCalledWith('workspace-1', 'space-1', member.uid, {
        role: SpaceMemberRole.Member,
        access_level: AccessLevel.ReadAndWrite,
      })
    );
    expect(mockAddSpaceMember).not.toHaveBeenCalled();

    await waitFor(() => expect(removeButton.disabled).toBe(false));
    fireEvent.click(removeButton);
    await waitFor(() => expect(mockRemoveSpaceMember).toHaveBeenCalledWith('workspace-1', 'space-1', member.uid));
  });

  it('fetches active workspace members and defensively filters pending invitations', async () => {
    const pendingInvitation: WorkspaceMember = {
      name: 'Pending invite',
      email: 'pending@appflowy.io',
      avatar_url: '',
      role: Role.Member,
      is_pending_invitation: true,
    };

    mockGetMembers.mockResolvedValue([pendingInvitation, workspaceCandidate]);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('inline-member-add').disabled).toBe(false));

    expect(mockGetMembers).toHaveBeenCalledWith('workspace-1');
    expect(mockUseAddableWorkspaceMembers).toHaveBeenLastCalledWith(expect.objectContaining({ excludePending: true }));
    fireEvent.click(screen.getByTestId('inline-member-add'));

    await waitFor(() =>
      expect(mockAddSpaceMember).toHaveBeenCalledWith(
        'workspace-1',
        'space-1',
        expect.objectContaining({ uid: workspaceCandidate.uid })
      )
    );
  });

  it('renders, updates, and revokes returned workspace-group grants', async () => {
    const memberGroup = group('group-1', 'Engineering');
    const ownerGroup = group('group-1', 'Engineering', SpaceMemberRole.Owner);

    mockGetSpaceMembers
      .mockResolvedValueOnce({ members: [], groups: [memberGroup] })
      .mockResolvedValueOnce({ members: [], groups: [ownerGroup] })
      .mockResolvedValueOnce({ members: [], groups: [] });
    mockUpdateSpaceGroupPermission.mockResolvedValue(ownerGroup);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    const initialRow = await screen.findByTestId('space-group-row-group-1');
    const ownerOption = within(initialRow).getByRole('button', {
      name: 'space.permissionManager.owner space.permissionManager.ownerRoleDescription',
    });

    fireEvent.click(ownerOption);

    await waitFor(() =>
      expect(mockUpdateSpaceGroupPermission).toHaveBeenCalledWith('workspace-1', 'space-1', 'group-1', {
        role: SpaceMemberRole.Owner,
        access_level: AccessLevel.FullAccess,
      })
    );
    await waitFor(() => expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2));

    const updatedRow = await screen.findByTestId('space-group-row-group-1');

    fireEvent.click(
      within(updatedRow).getByRole('button', {
        name: 'space.permissionManager.remove',
      })
    );

    await waitFor(() =>
      expect(mockRemoveSpaceGroupPermission).toHaveBeenCalledWith('workspace-1', 'space-1', 'group-1')
    );
    await waitFor(() => expect(screen.queryByTestId('space-group-row-group-1')).toBeNull());
  });

  it('keeps the confirmed group update interactive when roster revalidation fails', async () => {
    const memberGroup = group('group-1', 'Engineering');
    const ownerGroup = group('group-1', 'Engineering', SpaceMemberRole.Owner);

    mockGetSpaceMembers
      .mockResolvedValueOnce({ members: [], groups: [memberGroup] })
      .mockRejectedValueOnce(new Error('revalidation failed'));
    mockUpdateSpaceGroupPermission.mockResolvedValue(ownerGroup);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    const initialRow = await screen.findByTestId('space-group-row-group-1');

    fireEvent.click(
      within(initialRow).getByRole('button', {
        name: 'space.permissionManager.owner space.permissionManager.ownerRoleDescription',
      })
    );

    await waitFor(() => expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const updatedRow = screen.getByTestId('space-group-row-group-1');
      const roleTrigger = within(updatedRow).getByRole('button', {
        name: 'space.permissionManager.owner',
      });

      expect(roleTrigger.disabled).toBe(false);
    });
  });

  it('lets invite-only members add people without calling the manager-only member list', async () => {
    mockGetSpacePermission.mockResolvedValue(permissionResponse({ canManageMembers: false, canInviteMembers: true }));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('inline-member-add').disabled).toBe(false));
    expect(screen.getByTestId('inline-member-search').disabled).toBe(false);
    expect(mockGetSpaceMembers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('inline-member-add'));

    await waitFor(() =>
      expect(mockAddSpaceMember).toHaveBeenCalledWith('workspace-1', 'space-1', {
        uid: workspaceCandidate.uid,
        role: SpaceMemberRole.Member,
        access_level: AccessLevel.ReadAndWrite,
      })
    );
    expect(mockGetSpaceMembers).not.toHaveBeenCalled();
  });

  it('ignores a member-list response from the previously selected space', async () => {
    const oldSpaceMembers = deferred<{ members: []; groups: WorkspaceGroupSpacePermission[] }>();

    mockGetSpaceMembers.mockImplementation((_workspaceId: string, spaceId: string) =>
      spaceId === 'space-1'
        ? oldSpaceMembers.promise
        : Promise.resolve({ members: [], groups: [group('group-2', 'Current group')] })
    );
    const { rerender } = render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(mockGetSpaceMembers).toHaveBeenCalledWith('workspace-1', 'space-1'));
    rerender(<ManageSpace open onClose={jest.fn()} viewId='space-2' />);

    await screen.findByTestId('space-group-row-group-2');
    await act(async () => {
      oldSpaceMembers.resolve({ members: [], groups: [group('group-1', 'Stale group')] });
    });

    expect(screen.getByTestId('space-group-row-group-2')).toBeTruthy();
    expect(screen.queryByTestId('space-group-row-group-1')).toBeNull();
  });

  it('ignores an older overlapping refresh that resolves after the latest refresh', async () => {
    const firstGroup = group('group-1', 'First group');
    const secondGroup = group('group-2', 'Second group');
    const firstUpdate = deferred<WorkspaceGroupSpacePermission>();
    const secondUpdate = deferred<WorkspaceGroupSpacePermission>();
    const olderRefresh = deferred<{ members: []; groups: WorkspaceGroupSpacePermission[] }>();
    const latestRefresh = deferred<{ members: []; groups: WorkspaceGroupSpacePermission[] }>();

    mockGetSpaceMembers
      .mockResolvedValueOnce({ members: [], groups: [firstGroup, secondGroup] })
      .mockReturnValueOnce(olderRefresh.promise)
      .mockReturnValueOnce(latestRefresh.promise);
    mockUpdateSpaceGroupPermission.mockImplementation((_workspaceId: string, _spaceId: string, groupId: string) =>
      groupId === firstGroup.group_id ? firstUpdate.promise : secondUpdate.promise
    );
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    const firstRow = await screen.findByTestId('space-group-row-group-1');
    const secondRow = screen.getByTestId('space-group-row-group-2');
    const ownerButtonName = 'space.permissionManager.owner space.permissionManager.ownerRoleDescription';

    fireEvent.click(within(firstRow).getByRole('button', { name: ownerButtonName }));
    fireEvent.click(within(secondRow).getByRole('button', { name: ownerButtonName }));

    await act(async () => firstUpdate.resolve(group('group-1', 'First group', SpaceMemberRole.Owner)));
    await waitFor(() => expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2));
    await act(async () => secondUpdate.resolve(group('group-2', 'Second group', SpaceMemberRole.Owner)));
    await waitFor(() => expect(mockGetSpaceMembers).toHaveBeenCalledTimes(3));

    await act(async () =>
      latestRefresh.resolve({
        members: [],
        groups: [
          group('group-1', 'First group', SpaceMemberRole.Owner),
          group('group-2', 'Second group', SpaceMemberRole.Owner),
        ],
      })
    );
    await act(async () =>
      olderRefresh.resolve({
        members: [],
        groups: [group('group-1', 'First group', SpaceMemberRole.Owner)],
      })
    );

    expect(screen.getByTestId('space-group-row-group-2')).toBeTruthy();
  });
});
