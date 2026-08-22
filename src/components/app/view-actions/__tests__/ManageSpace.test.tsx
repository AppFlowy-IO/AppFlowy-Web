import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import {
  AccessLevel,
  Role,
  SpaceInvitePolicy,
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

const privatePermission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Private,
  owner_access_level: AccessLevel.FullAccess,
  member_default_access_level: AccessLevel.ReadAndWrite,
  invite_policy: SpaceInvitePolicy.OwnersOnly,
  sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
  invite_link_enabled: false,
  security: {
    disable_guests: false,
    disable_public_links: false,
    disable_export: false,
  },
};

const publicPermission: SpacePermissionSettings = {
  ...privatePermission,
  visibility: SpaceVisibility.Public,
};

const customPermission: SpacePermissionSettings = {
  ...privatePermission,
  visibility: SpaceVisibility.Custom,
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
    permission: overrides.permission ?? privatePermission,
    can_manage_space: overrides.canManageSpace ?? true,
    can_manage_members: overrides.canManageMembers ?? true,
    can_invite_members: overrides.canInviteMembers ?? true,
    can_edit_sidebar: overrides.canEditSidebar ?? true,
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

// An implicit member a public or custom space lists for every workspace member.
function workspaceDefaultMember(): SpaceMember {
  return {
    uid: '4567890123456789',
    name: 'Default member',
    email: 'default-member@appflowy.io',
    role: SpaceMemberRole.Member,
    access_level: AccessLevel.ReadAndWrite,
    source: 'workspace_default',
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
    mockGetSpaceMembers.mockResolvedValue({ members: [], groups: [] });
    mockGetMembers.mockResolvedValue([workspaceCandidate]);
    mockAddSpaceMember.mockResolvedValue(undefined);
    mockUpdateSpaceMember.mockResolvedValue(undefined);
    mockRemoveSpaceMember.mockResolvedValue(undefined);
    mockUpdateSpaceGroupPermission.mockResolvedValue(undefined);
    mockRemoveSpaceGroupPermission.mockResolvedValue(undefined);
  });

  it('offers Public, Custom and Private and flips a public space to Private through the compatibility API', async () => {
    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    expect(screen.getAllByTestId(/^manage-space-visibility-option-/)).toHaveLength(3);
    expect(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Public}`).textContent).toContain(
      'space.publicPermission'
    );
    expect(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Custom}`).textContent).toContain(
      'space.customPermission'
    );
    expect(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Custom}`).textContent).toContain(
      'space.customPermissionDescription'
    );
    expect(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Private}`).textContent).toContain(
      'space.privatePermission'
    );
    expect(screen.queryByTestId('manage-space-workspace-fallback-row')).toBeNull();

    const defaultAccessRow = screen.getByTestId('manage-space-members-default-access-row');

    expect(defaultAccessRow.textContent).toContain('space.permissionManager.publicMembersDescription');
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Private}`));
    expect(defaultAccessRow.textContent).not.toContain('space.permissionManager.publicMembersDescription');
    expect(defaultAccessRow.textContent).toContain('space.permissionManager.membersDescription');
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateSpace).toHaveBeenCalledWith({
        view_id: 'space-1',
        name: 'Space one',
        space_icon: 'space',
        space_icon_color: '#000000',
        space_permission: SpacePermission.Private,
      })
    );
    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
        'workspace-1',
        'space-1',
        expect.objectContaining({
          permission: expect.objectContaining({ visibility: SpaceVisibility.Private }),
        })
      )
    );
    expect(mockUpdateStructuredSpace.mock.calls[0][2].permission).not.toHaveProperty('everyone_else_access_level');
    expect(mockUpdateSpace.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateStructuredSpace.mock.invocationCallOrder[0]
    );
  });

  it('flips a private space to Public through the compatibility API before the structured update', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Renamed public space' },
    });
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Public}`));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateSpace).toHaveBeenCalledWith({
        view_id: 'space-1',
        name: 'Space one',
        space_icon: 'space',
        space_icon_color: '#000000',
        space_permission: SpacePermission.Public,
      })
    );
    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
        'workspace-1',
        'space-1',
        expect.objectContaining({
          name: 'Renamed public space',
          permission: expect.objectContaining({
            visibility: SpaceVisibility.Public,
          }),
        })
      )
    );
    expect(mockUpdateSpace.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateStructuredSpace.mock.invocationCallOrder[0]
    );
  });

  it('does not touch structured settings when the compatibility flip fails', async () => {
    mockUpdateSpace.mockRejectedValueOnce(new Error('Public bridge failed'));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Public}`));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Public bridge failed'));
    expect(mockUpdateSpace).toHaveBeenCalledTimes(1);
    expect(mockUpdateStructuredSpace).not.toHaveBeenCalled();
  });

  it('rolls back the compatibility visibility when the structured update fails', async () => {
    mockUpdateStructuredSpace.mockRejectedValueOnce(new Error('Structured update failed'));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Rename that must roll back' },
    });
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Public}`));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() => expect(mockUpdateSpace).toHaveBeenCalledTimes(2));
    expect(mockUpdateSpace.mock.calls).toEqual([
      [
        {
          view_id: 'space-1',
          name: 'Space one',
          space_icon: 'space',
          space_icon_color: '#000000',
          space_permission: SpacePermission.Public,
        },
      ],
      [
        {
          view_id: 'space-1',
          name: 'Space one',
          space_icon: 'space',
          space_icon_color: '#000000',
          space_permission: SpacePermission.Private,
        },
      ],
    ]);
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(2));
    expect(mockUpdateStructuredSpace.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        name: 'Rename that must roll back',
        permission: expect.objectContaining({ visibility: SpaceVisibility.Public }),
      })
    );
    expect(mockUpdateStructuredSpace.mock.calls[1][2]).toEqual({
      name: 'Space one',
      space_icon: 'space',
      space_icon_color: '#000000',
      permission: privatePermission,
    });
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
        ...privatePermission,
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
      // The binary editor cannot persist Custom, so it must not offer it.
      expect(screen.getAllByTestId(/^manage-space-visibility-option-/)).toHaveLength(2);
      expect(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Public}`)).toBeTruthy();
      expect(screen.queryByTestId(`manage-space-visibility-option-${SpaceVisibility.Custom}`)).toBeNull();

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
    const roleTrigger = within(row).getByRole('button', { name: 'space.permissionManager.owner' });

    expect(removeButton.disabled).toBe(false);
    expect(roleTrigger.className).toContain('w-fit');
    expect(roleTrigger.className).not.toContain('min-w-[210px]');
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

  it('explains how to keep an owner when the server rejects a role change', async () => {
    const member = creatorMember();

    mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
    mockUpdateSpaceMember.mockRejectedValueOnce(
      new Error('Invalid request:space must keep at least one explicit owner')
    );
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    const row = await screen.findByTestId(`space-member-row-${member.uid}`);

    fireEvent.click(
      within(row).getByRole('button', {
        name: 'space.permissionManager.member space.permissionManager.memberRoleDescription',
      })
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.permissionManager.lastOwnerRequired'));
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

  it('keeps a public space roster read-only', async () => {
    const member = manualMember();
    const memberGroup = group('group-1', 'Engineering');

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
    mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [memberGroup] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    const memberRow = await screen.findByTestId(`space-member-row-${member.uid}`);
    const groupRow = screen.getByTestId('space-group-row-group-1');

    expect(screen.queryByTestId('inline-member-search')).toBeNull();
    expect(screen.queryByTestId('inline-member-add')).toBeNull();
    expect(mockGetMembers).not.toHaveBeenCalled();
    expect(within(memberRow).getByText('space.permissionManager.member')).toBeTruthy();
    expect(within(memberRow).queryByRole('button')).toBeNull();
    expect(within(groupRow).getByText('space.permissionManager.member')).toBeTruthy();
    expect(within(groupRow).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'space.permissionManager.remove' })).toBeNull();
  });

  it('lets managers edit a custom space roster, including removing default members', async () => {
    const explicitMember = manualMember();
    const defaultMember = workspaceDefaultMember();
    const memberGroup = group('group-1', 'Engineering');

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
    mockGetSpaceMembers.mockResolvedValue({ members: [explicitMember, defaultMember], groups: [memberGroup] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    const defaultRow = await screen.findByTestId(`space-member-row-${defaultMember.uid}`);
    const explicitRow = screen.getByTestId(`space-member-row-${explicitMember.uid}`);
    const groupRow = screen.getByTestId('space-group-row-group-1');

    // The header icon/description treat Custom as a non-private space with the
    // same implicit roster as Public ...
    expect(screen.getByTestId('manage-space-visibility-trigger').textContent).toContain('space.customPermission');
    expect(screen.getByTestId('manage-space-members-default-access-row').textContent).toContain(
      'space.permissionManager.publicMembersDescription'
    );
    // ... but the roster stays editable: members can be added and every row,
    // including an implicit workspace_default one, can be removed.
    await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));
    expect(mockGetMembers).toHaveBeenCalledWith('workspace-1');
    expect(screen.queryByText('space.permissionManager.inheritedAccessManagedFromGeneral')).toBeNull();
    expect(within(defaultRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(false);
    expect(within(explicitRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(false);
    expect(within(groupRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(false);

    fireEvent.click(within(defaultRow).getByRole('button', { name: 'space.permissionManager.remove' }));

    await waitFor(() => expect(mockRemoveSpaceMember).toHaveBeenCalledWith('workspace-1', 'space-1', defaultMember.uid));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.permissionManager.removeSpaceMemberSuccess'));
    expect(mockUpdateSpaceMember).not.toHaveBeenCalled();
  });

  it('keeps default members of a private space non-removable', async () => {
    const defaultMember = workspaceDefaultMember();

    mockGetSpaceMembers.mockResolvedValue({ members: [defaultMember], groups: [] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    const defaultRow = await screen.findByTestId(`space-member-row-${defaultMember.uid}`);

    expect(within(defaultRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(true);
    expect(screen.getByText('space.permissionManager.inheritedAccessManagedFromGeneral')).toBeTruthy();
  });

  it('flips a private space to Custom through the compatibility Public marker before the structured update', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Renamed custom space' },
    });
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Custom}`));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() => expect(mockUpdateSpace).toHaveBeenCalledTimes(1));
    expect(mockUpdateSpace).toHaveBeenCalledWith({
      view_id: 'space-1',
      name: 'Space one',
      space_icon: 'space',
      space_icon_color: '#000000',
      space_permission: SpacePermission.Public,
    });
    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        name: 'Renamed custom space',
        space_icon: 'space',
        space_icon_color: '#000000',
        permission: customPermission,
      })
    );
    expect(mockUpdateSpace.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateStructuredSpace.mock.invocationCallOrder[0]
    );
  });

  it('flips a custom space to Private through the compatibility API before the structured update', async () => {
    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Private}`));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() => expect(mockUpdateSpace).toHaveBeenCalledTimes(1));
    expect(mockUpdateSpace).toHaveBeenCalledWith(expect.objectContaining({ space_permission: SpacePermission.Private }));
    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
        'workspace-1',
        'space-1',
        expect.objectContaining({ permission: privatePermission })
      )
    );
    expect(mockUpdateSpace.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateStructuredSpace.mock.invocationCallOrder[0]
    );
  });

  it.each([
    ['public', publicPermission, SpaceVisibility.Custom, customPermission],
    ['custom', customPermission, SpaceVisibility.Public, publicPermission],
  ])(
    'switches a %s space between Public and Custom without a compatibility flip',
    async (_label, loaded, requested, expected) => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: loaded }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
      fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${requested}`));
      fireEvent.click(screen.getByTestId('manage-space-save'));

      await waitFor(() =>
        expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
          'workspace-1',
          'space-1',
          expect.objectContaining({ permission: expected })
        )
      );
      expect(mockUpdateSpace).not.toHaveBeenCalled();
    }
  );

  it('restores the non-private compatibility marker of a custom space when the structured update fails', async () => {
    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
    mockUpdateStructuredSpace.mockRejectedValueOnce(new Error('Structured update failed'));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Private}`));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Structured update failed'));
    await waitFor(() => expect(mockUpdateSpace).toHaveBeenCalledTimes(2));
    expect(mockUpdateSpace.mock.calls.map(([payload]) => payload.space_permission)).toEqual([
      SpacePermission.Private,
      // Custom maps onto the non-private legacy marker, exactly like Public.
      SpacePermission.Public,
    ]);
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(2));
    expect(mockUpdateStructuredSpace.mock.calls[1][2]).toEqual({
      name: 'Space one',
      space_icon: 'space',
      space_icon_color: '#000000',
      permission: customPermission,
    });
  });

  it('passes an unknown visibility through unchanged and labels it Public', async () => {
    const unknownVisibility = 'invite_only' as SpaceVisibility;

    mockGetSpacePermission.mockResolvedValue(
      permissionResponse({ permission: { ...privatePermission, visibility: unknownVisibility } })
    );
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(screen.getByTestId('manage-space-visibility-trigger').disabled).toBe(false));
    const trigger = screen.getByTestId('manage-space-visibility-trigger');

    expect(trigger.textContent).toContain('space.publicPermission');
    expect(trigger.textContent).not.toContain('space.privatePermission');
    // Only an exact Public visibility makes the roster read-only.
    await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));

    const defaultAccessRow = screen.getByTestId('manage-space-members-default-access-row');

    fireEvent.click(within(defaultAccessRow).getByRole('button', { name: 'shareAction.canView' }));
    fireEvent.click(screen.getByTestId('manage-space-save'));

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
        'workspace-1',
        'space-1',
        expect.objectContaining({
          permission: expect.objectContaining({
            visibility: unknownVisibility,
            member_default_access_level: AccessLevel.ReadOnly,
          }),
        })
      )
    );
    expect(mockUpdateSpace).not.toHaveBeenCalled();
  });
});
