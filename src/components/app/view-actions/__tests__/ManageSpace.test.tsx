import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  AccessLevel,
  Role,
  SpaceInvitePolicy,
  SpaceMember,
  SpaceMemberRole,
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
const mockUpdateStructuredSpace = jest.fn();
const mockGetSpaceMembers = jest.fn();
const mockGetMembers = jest.fn();
const mockAddSpaceMember = jest.fn();
const mockUpdateSpaceMember = jest.fn();
const mockRemoveSpaceMember = jest.fn();
const mockUpdateSpaceGroupPermission = jest.fn();
const mockRemoveSpaceGroupPermission = jest.fn();
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
  useAddableWorkspaceMembers: ({ workspaceMembers }: { workspaceMembers: WorkspaceMember[] }) => workspaceMembers,
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
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button type='button' disabled={disabled} onClick={() => onSelect?.()}>
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

function permissionResponse(overrides: { canManageMembers?: boolean; canInviteMembers?: boolean } = {}) {
  return {
    space_id: 'space-1',
    permission: openPermission,
    can_manage_space: true,
    can_manage_members: overrides.canManageMembers ?? true,
    can_invite_members: overrides.canInviteMembers ?? true,
    can_edit_sidebar: true,
    explicit_member_count: 0,
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
    mockUpdateSpace.mockResolvedValue(undefined);
    mockUpdateStructuredSpace.mockResolvedValue({ view_id: 'space-1' });
    mockGetSpacePermission.mockResolvedValue(permissionResponse());
    mockGetSpaceMembers.mockResolvedValue({ members: [], groups: [] });
    mockGetMembers.mockResolvedValue([workspaceCandidate]);
    mockAddSpaceMember.mockResolvedValue(undefined);
    mockUpdateSpaceMember.mockResolvedValue(undefined);
    mockRemoveSpaceMember.mockResolvedValue(undefined);
    mockUpdateSpaceGroupPermission.mockResolvedValue(undefined);
    mockRemoveSpaceGroupPermission.mockResolvedValue(undefined);
  });

  it('clears and locks workspace fallback access when Closed is selected', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    const closedOption = screen.getByText('space.permissionManager.closed').closest('button');

    expect(closedOption).not.toBeNull();
    fireEvent.click(closedOption as HTMLButtonElement);

    const fallbackRow = screen.getByTestId('manage-space-workspace-fallback-row');

    expect(within(fallbackRow).getAllByRole('button')[0].disabled).toBe(true);
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
        'workspace-1',
        'space-1',
        expect.objectContaining({
          permission: expect.objectContaining({
            visibility: SpaceVisibility.Closed,
            everyone_else_access_level: null,
          }),
        })
      )
    );
  });

  it('atomically saves metadata and structured ACL without a legacy visibility update', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
    expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
      name: 'Space one',
      space_icon: 'space',
      space_icon_color: '#000000',
      permission: openPermission,
    });
    expect(mockUpdateSpace).not.toHaveBeenCalled();
    expect(mockUpdateStructuredSpace.mock.calls[0][2]).not.toHaveProperty('space_permission');
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
