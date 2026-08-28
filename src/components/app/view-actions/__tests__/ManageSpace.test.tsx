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
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
  View,
  ViewLayout,
  WorkspaceGroup,
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
const mockGetWorkspaceGroups = jest.fn();
const mockAddSpaceMember = jest.fn();
const mockUpdateSpaceMember = jest.fn();
const mockRemoveSpaceMember = jest.fn();
const mockAddSpaceGroupPermission = jest.fn();
const mockUpdateSpaceGroupPermission = jest.fn();
const mockRemoveSpaceGroupPermission = jest.fn();
const mockEventEmitter = new EventEmitter();
const mockUseAddableWorkspaceMembers = jest.fn(
  ({ workspaceMembers, excludePending }: { workspaceMembers: WorkspaceMember[]; excludePending?: boolean }) =>
    workspaceMembers.filter((member) => !excludePending || !member.is_pending_invitation)
);
const mockTranslate = (key: string, options?: Record<string, unknown>) =>
  options && Object.keys(options).length > 0 ? `${key}:${JSON.stringify(options)}` : key;

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
    getWorkspaceGroups: (...args: unknown[]) => mockGetWorkspaceGroups(...args),
    addSpaceMember: (...args: unknown[]) => mockAddSpaceMember(...args),
    updateSpaceMember: (...args: unknown[]) => mockUpdateSpaceMember(...args),
    removeSpaceMember: (...args: unknown[]) => mockRemoveSpaceMember(...args),
    addSpaceGroupPermission: (...args: unknown[]) => mockAddSpaceGroupPermission(...args),
    updateSpaceGroupPermission: (...args: unknown[]) => mockUpdateSpaceGroupPermission(...args),
    removeSpaceGroupPermission: (...args: unknown[]) => mockRemoveSpaceGroupPermission(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ updateSpace: mockUpdateSpace }),
  useAppView: (viewId: string) => mockViews[viewId],
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
  useUserWorkspaceInfo: () => ({
    userId: 'user-1',
    selectedWorkspace: { id: 'workspace-1', name: 'Acme', role: Role.Owner },
    workspaces: [{ id: 'workspace-1', name: 'Acme', role: Role.Owner }],
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({
    name: 'Nathan',
    email: 'nathan@appflowy.io',
    avatar: '',
  }),
}));

// Both the Manage Space modal and its confirmation dialog render through
// NormalModal; the OK button carries the test id each caller asks for.
jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    children,
    open,
    onOk,
    onCancel,
    onClose,
    title,
    okText,
    okButtonProps,
    PaperProps,
    showActions = true,
  }: {
    children: ReactNode;
    open: boolean;
    onOk: () => void;
    onCancel?: () => void;
    onClose?: () => void;
    title?: ReactNode;
    okText?: ReactNode;
    okButtonProps?: { disabled?: boolean; 'data-testid'?: string };
    PaperProps?: { 'data-testid'?: string };
    showActions?: boolean;
  }) =>
    open ? (
      <div data-testid={PaperProps?.['data-testid']}>
        <div data-testid={`${PaperProps?.['data-testid'] ?? 'modal'}-title`}>{title}</div>
        {showActions && (
          <>
            <button
              data-testid={okButtonProps?.['data-testid'] ?? 'modal-ok-button'}
              disabled={okButtonProps?.disabled}
              onClick={onOk}
            >
              {okText ?? 'ok'}
            </button>
            <button data-testid={`${PaperProps?.['data-testid'] ?? 'modal'}-cancel`} onClick={onCancel ?? onClose}>
              cancel
            </button>
          </>
        )}
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
    search,
    onSearchChange,
    onAddMember,
  }: {
    addableMembers: WorkspaceMember[];
    inputDisabled?: boolean;
    addButtonDisabled?: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    onAddMember: (member: WorkspaceMember) => void;
  }) => (
    <div>
      <input
        data-testid='inline-member-search'
        disabled={inputDisabled}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
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

jest.mock('@/components/ui/tabs', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const TabsContext = React.createContext({ value: '', onValueChange: (_value: string) => undefined });

  return {
    Tabs: ({
      children,
      onValueChange,
      value,
      'data-testid': testId,
    }: {
      children: ReactNode;
      onValueChange?: (value: string) => void;
      value: string;
      'data-testid'?: string;
    }) => (
      <TabsContext.Provider value={{ value, onValueChange: onValueChange ?? (() => undefined) }}>
        <div data-testid={testId}>{children}</div>
      </TabsContext.Provider>
    ),
    TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, disabled, value }: { children: ReactNode; disabled?: boolean; value: string }) => {
      const tabs = React.useContext(TabsContext);

      return (
        <button
          role='tab'
          aria-selected={tabs.value === value}
          disabled={disabled}
          onClick={() => tabs.onValueChange(value)}
        >
          {children}
        </button>
      );
    },
  };
});

const privatePermission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Private,
  owner_access_level: AccessLevel.FullAccess,
  member_default_access_level: AccessLevel.ReadAndWrite,
  everyone_else_access_level: null,
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

// The seeded shape of a custom space: members Can edit, everyone else Can view.
const customPermission: SpacePermissionSettings = {
  ...privatePermission,
  visibility: SpaceVisibility.Custom,
  everyone_else_access_level: AccessLevel.ReadOnly,
};

const workspaceCandidate: WorkspaceMember = {
  uid: '1234567890123456',
  name: 'Candidate',
  email: 'candidate@appflowy.io',
  avatar_url: '',
  role: Role.Member,
};

const engineeringWorkspaceGroup: WorkspaceGroup = {
  group_id: 'group-engineering',
  name: 'Engineering',
  member_count: 12,
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
    workspace_role: Role.Member,
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
    workspace_role: Role.Owner,
  };
}

// An implicit member a public space lists for every workspace member.
function workspaceDefaultMember(): SpaceMember {
  return {
    uid: '4567890123456789',
    name: 'Default member',
    email: 'default-member@appflowy.io',
    role: SpaceMemberRole.Member,
    access_level: AccessLevel.ReadAndWrite,
    source: 'workspace_default',
    workspace_role: Role.Member,
  };
}

function pageShareMember(): SpaceMember {
  return {
    uid: '5678901234567890',
    name: 'Page-shared member',
    email: 'page-shared-member@appflowy.io',
    role: SpaceMemberRole.Member,
    access_level: AccessLevel.ReadOnly,
    source: 'page_share',
    workspace_role: Role.Member,
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

function visibilityOption(visibility: SpaceVisibility) {
  return screen.getByTestId(`manage-space-visibility-option-${visibility}`);
}

// Exactly one card is highlighted: the server-confirmed type, with the accent
// state and the check mark; the others are neutral.
function expectSelectedVisibility(visibility: SpaceVisibility) {
  for (const candidate of [SpaceVisibility.Public, SpaceVisibility.Private, SpaceVisibility.Custom]) {
    const option = visibilityOption(candidate);
    const selected = candidate === visibility;

    expect(option.getAttribute('aria-pressed')).toBe(String(selected));
    expect(option.getAttribute('data-selected')).toBe(String(selected));
    expect(within(option).queryByTestId('manage-space-visibility-selected-check') !== null).toBe(selected);
  }
}

async function waitForSettingsLoaded() {
  await waitFor(() => expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(false));
}

function confirmDialog() {
  return screen.getByTestId('manage-space-confirm-dialog');
}

function confirmPending() {
  fireEvent.click(screen.getByTestId('manage-space-confirm-ok'));
}

function structuredUpdatePermission(callIndex = 0): SpacePermissionSettings {
  return mockUpdateStructuredSpace.mock.calls[callIndex][2].permission;
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
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [engineeringWorkspaceGroup] });
    mockAddSpaceMember.mockResolvedValue(undefined);
    mockUpdateSpaceMember.mockResolvedValue(undefined);
    mockRemoveSpaceMember.mockResolvedValue(undefined);
    mockAddSpaceGroupPermission.mockResolvedValue(undefined);
    mockUpdateSpaceGroupPermission.mockResolvedValue(undefined);
    mockRemoveSpaceGroupPermission.mockResolvedValue(undefined);
  });

  describe('space type switcher', () => {
    it('offers Public, Private and Custom cards with the PRD copy and marks the loaded type', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      expect(screen.getByTestId('space-settings-panel')).toBeTruthy();
      expect(screen.getAllByTestId(/^manage-space-visibility-option-/)).toHaveLength(3);
      expect(visibilityOption(SpaceVisibility.Public).textContent).toContain('space.publicPermission');
      expect(visibilityOption(SpaceVisibility.Public).textContent).toContain('space.publicPermissionDescription');
      expect(visibilityOption(SpaceVisibility.Private).textContent).toContain('space.privatePermissionDescription');
      expect(visibilityOption(SpaceVisibility.Custom).textContent).toContain('space.customPermissionDescription');
      expect(visibilityOption(SpaceVisibility.Custom).textContent).not.toContain('space.newBadge');
      expectSelectedVisibility(SpaceVisibility.Public);
      expect(screen.getByTestId('manage-space-public-access-card')).toBeTruthy();
      expect(screen.queryByTestId('manage-space-custom-permissions-card')).toBeNull();
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      expect(screen.queryByTestId('modal-ok-button')).toBeNull();
      expect(screen.queryByTestId('manage-space-modal-cancel')).toBeNull();
    });

    it('shows Private owner-only access and roster without requesting mutable roster data', async () => {
      mockGetSpacePermission.mockResolvedValue(
        permissionResponse({
          permission: privatePermission,
          canManageMembers: true,
          canInviteMembers: true,
        })
      );
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      expectSelectedVisibility(SpaceVisibility.Private);
      expect(screen.getByTestId('manage-space-private-access-card').textContent).toContain(
        'space.permissionManager.privateAccessTitle'
      );
      expect(screen.getByTestId('manage-space-private-access-card').textContent).toContain(
        'space.permissionManager.privateOwnerDescription'
      );
      expect(screen.getByText('space.permissionManager.membersTab')).toBeTruthy();
      expect(screen.queryByTestId('manage-space-members-default-access-row')).toBeNull();
      expect(screen.getByTestId('private-space-members-info').textContent).toBe(
        'space.permissionManager.privateMembersDescription'
      );
      const ownerRow = screen.getByTestId('private-space-owner-row');

      expect(ownerRow.textContent).toContain('Nathan');
      expect(ownerRow.textContent).toContain('space.permissionManager.workspaceOwner');
      expect(screen.getByTestId('private-space-owner-locked-role').textContent).toBe('space.permissionManager.owner');
      expect(within(ownerRow).queryByRole('button')).toBeNull();
      expect(screen.queryByTestId('inline-member-search')).toBeNull();
      expect(screen.queryByTestId('manage-space-add-member')).toBeNull();
      expect(mockGetSpaceMembers).not.toHaveBeenCalled();
      expect(mockGetMembers).not.toHaveBeenCalled();
      expect(mockGetWorkspaceGroups).not.toHaveBeenCalled();
    });

    it('opens a custom space highlighted and commits a confirmed type selection immediately', async () => {
      mockGetSpacePermission
        .mockResolvedValueOnce(permissionResponse({ permission: customPermission }))
        .mockResolvedValue(permissionResponse({ permission: privatePermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      expectSelectedVisibility(SpaceVisibility.Custom);

      fireEvent.click(visibilityOption(SpaceVisibility.Private));
      expectSelectedVisibility(SpaceVisibility.Custom);
      confirmPending();
      expectSelectedVisibility(SpaceVisibility.Private);
      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual(privatePermission);
    });

    it("highlights Public when an older server still returns the legacy 'default' visibility", async () => {
      mockGetSpacePermission.mockResolvedValue(
        permissionResponse({
          permission: { ...publicPermission, visibility: 'default' as unknown as SpaceVisibility },
        })
      );
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      expectSelectedVisibility(SpaceVisibility.Public);
    });

    it('confirms Public → Private and immediately sends only the structured permission', async () => {
      mockGetSpacePermission
        .mockResolvedValueOnce(permissionResponse({ permission: publicPermission }))
        .mockResolvedValue(permissionResponse({ permission: privatePermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Private));

      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPrivateTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPrivateDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe(
        'space.permissionManager.confirmToPrivateAction'
      );
      // Nothing moves until the user agrees.
      expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-pressed')).toBe('true');

      confirmPending();
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      expect(visibilityOption(SpaceVisibility.Private).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByText('space.permissionManager.membersTab')).toBeTruthy();
      expect(screen.queryByTestId('manage-space-members-default-access-row')).toBeNull();
      expect(screen.getByTestId('manage-space-private-access-card')).toBeTruthy();

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        permission: { ...privatePermission, everyone_else_access_level: null },
      });
      // The structured update keeps the legacy marker in step on the server;
      // no compatibility write precedes or follows it.
      expect(mockUpdateSpace).not.toHaveBeenCalled();
    });

    it('cancelling a type switch keeps the loaded type and sends no mutation', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Custom));
      fireEvent.click(screen.getByTestId('manage-space-confirm-dialog-cancel'));

      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-pressed')).toBe('true');
      expect(mockUpdateStructuredSpace).not.toHaveBeenCalled();
    });

    it('confirms Private → Public with the PRD copy', async () => {
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Public));

      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPublicTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPublicDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe(
        'space.permissionManager.confirmToPublicAction'
      );
      confirmPending();

      await waitFor(() =>
        expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
          permission: { ...publicPermission, everyone_else_access_level: null },
        })
      );
      expect(mockUpdateSpace).not.toHaveBeenCalled();
    });

    it('confirms Private → Custom with the private copy and opens everyone else with Can view', async () => {
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Custom));

      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToCustomTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmPrivateToCustomDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe(
        'space.permissionManager.confirmPrivateToCustomAction'
      );
      confirmPending();

      const customCard = screen.getByTestId('manage-space-custom-permissions-card');

      expect(customCard.textContent).toContain('space.permissionManager.customPermissionsTitle');
      expect(screen.getByTestId('manage-space-custom-members-access').textContent).toContain('shareAction.canEdit');
      expect(screen.getByTestId('manage-space-everyone-else-access').textContent).toContain('shareAction.canView');

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual(customPermission);
      expect(mockUpdateSpace).not.toHaveBeenCalled();
    });

    it('confirms Public → Custom with the materialization copy from the card and from the banner', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();

      // The discovery banner under the public card starts the same switch.
      fireEvent.click(screen.getByTestId('manage-space-switch-to-custom'));
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToCustomTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmPublicToCustomDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe(
        'space.permissionManager.confirmPublicToCustomAction'
      );
      fireEvent.click(screen.getByTestId('manage-space-confirm-dialog-cancel'));
      expect(screen.getByTestId('manage-space-public-access-card')).toBeTruthy();

      fireEvent.click(visibilityOption(SpaceVisibility.Custom));
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmPublicToCustomDescription');
      confirmPending();

      expect(screen.queryByTestId('manage-space-public-access-card')).toBeNull();
      expect(screen.getByTestId('manage-space-custom-permissions-card')).toBeTruthy();
      expect(visibilityOption(SpaceVisibility.Custom).getAttribute('aria-pressed')).toBe('true');

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      // Members keep Can edit; everyone else opens with Can view.
      expect(structuredUpdatePermission()).toEqual(customPermission);
    });

    it('persists a confirmed Public → Custom switch before Members opens without a second prompt', async () => {
      const onClose = jest.fn();

      mockGetSpacePermission
        .mockResolvedValueOnce(permissionResponse({ permission: publicPermission }))
        .mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={onClose} viewId='space-1' />);

      await waitForSettingsLoaded();
      expect(screen.queryByTestId('inline-member-search')).toBeNull();

      fireEvent.click(visibilityOption(SpaceVisibility.Custom));
      confirmPending();

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        permission: customPermission,
      });
      expect(onClose).not.toHaveBeenCalled();
      await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }).hasAttribute('disabled')).toBe(
          false
        )
      );
      fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));

      await waitFor(() => {
        expect(
          screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }).getAttribute('aria-selected')
        ).toBe('true');
        expect(screen.getByTestId('inline-member-search').hasAttribute('disabled')).toBe(false);
        expect(mockGetMembers).toHaveBeenCalledWith('workspace-1');
        expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1');
      });
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1);
    });

    it('opens Members directly when there is no type transition to apply', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));

      expect(mockUpdateStructuredSpace).not.toHaveBeenCalled();
      expect(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }).getAttribute('aria-selected')).toBe(
        'true'
      );
      expect(screen.getByTestId('inline-member-search')).toBeTruthy();
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
    });

    it('rolls a confirmed type selection back when its immediate mutation fails', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      mockUpdateStructuredSpace.mockRejectedValueOnce(new Error('save failed'));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Custom));
      confirmPending();

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('save failed'));
      expect(screen.getByRole('tab', { name: 'space.permissionManager.generalTab' }).getAttribute('aria-selected')).toBe(
        'true'
      );
      expectSelectedVisibility(SpaceVisibility.Public);
      expect(screen.queryByTestId('inline-member-search')).toBeNull();
      expect(mockGetSpacePermission).toHaveBeenCalledTimes(1);
    });

    it('confirms Custom → Public and drops the everyone-else audience from the payload', async () => {
      mockGetSpacePermission.mockResolvedValue(
        permissionResponse({
          permission: { ...customPermission, everyone_else_access_level: AccessLevel.FullAccess },
        })
      );
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Public));
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPublicTitle');
      confirmPending();

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({ ...publicPermission, everyone_else_access_level: null });
      expect(mockUpdateSpace).not.toHaveBeenCalled();
    });

    it('confirms Custom → Private and lifts members off No access, which only custom spaces allow', async () => {
      mockGetSpacePermission.mockResolvedValue(
        permissionResponse({
          permission: { ...customPermission, member_default_access_level: null },
        })
      );
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      expect(screen.getByTestId('manage-space-custom-members-access').textContent).toContain(
        'space.permissionManager.noAccess'
      );
      fireEvent.click(visibilityOption(SpaceVisibility.Private));
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPrivateDescription');
      confirmPending();

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
        ...privatePermission,
        member_default_access_level: AccessLevel.ReadAndWrite,
        everyone_else_access_level: null,
      });
    });

    it('passes an unknown visibility through unchanged', async () => {
      const unknownVisibility = 'invite_only' as SpaceVisibility;

      mockGetSpacePermission.mockResolvedValue(
        permissionResponse({ permission: { ...privatePermission, visibility: unknownVisibility } })
      );
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      // No card claims the unknown value, and the generic rows stay editable.
      expect(screen.queryByTestId('manage-space-public-access-card')).toBeNull();
      expect(screen.queryByTestId('manage-space-custom-permissions-card')).toBeNull();
      expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-pressed')).toBe('false');
      expect(visibilityOption(SpaceVisibility.Private).getAttribute('aria-pressed')).toBe('false');
      expect(visibilityOption(SpaceVisibility.Custom).getAttribute('aria-pressed')).toBe('false');
      // Only an exact Public visibility makes the roster read-only.
      await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));

      fireEvent.click(screen.getByTestId(`manage-space-members-default-access-option-${AccessLevel.ReadOnly}`));

      await waitFor(() =>
        expect(mockUpdateStructuredSpace).toHaveBeenCalledWith(
          'workspace-1',
          'space-1',
          expect.objectContaining({
            permission: expect.objectContaining({
              visibility: unknownVisibility,
              member_default_access_level: AccessLevel.ReadOnly,
              everyone_else_access_level: null,
            }),
          })
        )
      );
      expect(mockUpdateSpace).not.toHaveBeenCalled();
    });
  });

  describe('public access card', () => {
    it('renders the access rows without a redundant table header', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      const card = screen.getByTestId('manage-space-public-access-card');

      expect(card.textContent).toContain('space.permissionManager.publicAccessTitle');
      expect(card.textContent).toContain('space.permissionManager.publicAccessDescription');
      expect(card.textContent).not.toContain('space.permissionManager.who');
      expect(card.textContent).not.toContain('space.permissionManager.access');
      expect(screen.getByTestId('manage-space-workspace-owners-row').textContent).toContain(
        'space.permissionManager.workspaceOwnersDescription'
      );
      expect(screen.getByTestId('manage-space-workspace-owners-row').textContent).toContain('shareAction.fullAccess');
      expect(screen.getByTestId('manage-space-workspace-members-row').textContent).toContain(
        'space.permissionManager.workspaceMembersDescription'
      );
      expect(screen.getByTestId('manage-space-switch-to-custom-banner').textContent).toContain(
        'space.permissionManager.switchToCustomDescription'
      );
      // Full access / Can edit / Can view, no "No access" on a public space.
      expect(
        screen.getAllByTestId(/^manage-space-workspace-members-access-option-/).map((el) => el.textContent)
      ).toEqual(['shareAction.fullAccess', 'shareAction.canEditselected', 'shareAction.canView']);

      fireEvent.click(screen.getByTestId(`manage-space-workspace-members-access-option-${AccessLevel.ReadOnly}`));
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
        ...publicPermission,
        member_default_access_level: AccessLevel.ReadOnly,
        everyone_else_access_level: null,
      });
    });

    it('warns before giving workspace members Full access', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(screen.getByTestId(`manage-space-workspace-members-access-option-${AccessLevel.FullAccess}`));

      expect(confirmDialog().textContent).toContain('space.permissionManager.fullAccessWorkspaceMembersTitle');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe('space.permissionManager.grantFullAccess');
      expect(screen.getByTestId('manage-space-workspace-members-access').textContent).toContain('shareAction.canEdit');
      confirmPending();
      expect(screen.getByTestId('manage-space-workspace-members-access').textContent).toContain(
        'shareAction.fullAccess'
      );
      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
        ...publicPermission,
        member_default_access_level: AccessLevel.FullAccess,
      });
    });
  });

  describe('custom permissions card', () => {
    it('renders the three audiences with the design copy and the workspace name', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      const card = screen.getByTestId('manage-space-custom-permissions-card');

      expect(card.textContent).toContain('space.permissionManager.customPermissionsTitle');
      expect(card.textContent).toContain('space.permissionManager.customPermissionsDescription');
      expect(screen.getByTestId('manage-space-custom-owners-row').textContent).toContain(
        'space.permissionManager.ownersDescription'
      );
      expect(screen.getByTestId('manage-space-custom-owners-row').textContent).toContain('shareAction.fullAccess');
      expect(screen.getByTestId('manage-space-custom-members-row').textContent).toContain(
        'space.permissionManager.customMembersDescription'
      );
      expect(screen.getByTestId('manage-space-everyone-else-row').textContent).toContain(
        'space.permissionManager.everyoneElse:{"workspace":"Acme"}'
      );
      expect(screen.getByTestId('manage-space-everyone-else-row').textContent).toContain(
        'space.permissionManager.everyoneElseDescription'
      );
      // Every level (PRD §17/§39, including Can view and comment) plus No
      // access, for both audiences.
      expect(screen.getAllByTestId(/^manage-space-custom-members-access-option-/).map((el) => el.textContent)).toEqual([
        'shareAction.fullAccess',
        'shareAction.canEditselected',
        'shareAction.canViewAndComment',
        'shareAction.canView',
        'space.permissionManager.noAccess',
      ]);
      expect(screen.getAllByTestId(/^manage-space-everyone-else-access-option-/).map((el) => el.textContent)).toEqual([
        'shareAction.fullAccess',
        'shareAction.canEdit',
        'shareAction.canViewAndComment',
        'shareAction.canViewselected',
        'space.permissionManager.noAccess',
      ]);
    });

    it('saves No access as null for both audiences', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(screen.getByTestId('manage-space-custom-members-access-option-none'));
      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByTestId('manage-space-everyone-else-access-option-none'));
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(2));
      expect(structuredUpdatePermission(1)).toEqual({
        ...customPermission,
        member_default_access_level: null,
        everyone_else_access_level: null,
      });
    });

    it('warns before granting Full access to space members or everyone else', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(screen.getByTestId(`manage-space-custom-members-access-option-${AccessLevel.FullAccess}`));
      expect(confirmDialog().textContent).toContain('space.permissionManager.fullAccessMembersTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.fullAccessMembersDescription');
      fireEvent.click(screen.getByTestId('manage-space-confirm-dialog-cancel'));
      expect(screen.getByTestId('manage-space-custom-members-access').textContent).toContain('shareAction.canEdit');

      fireEvent.click(screen.getByTestId(`manage-space-everyone-else-access-option-${AccessLevel.FullAccess}`));
      expect(confirmDialog().textContent).toContain('space.permissionManager.fullAccessEveryoneElseTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.fullAccessEveryoneElseDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe('space.permissionManager.grantFullAccess');
      confirmPending();
      expect(screen.getByTestId('manage-space-everyone-else-access').textContent).toContain('shareAction.fullAccess');

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
        ...customPermission,
        everyone_else_access_level: AccessLevel.FullAccess,
      });
    });

    it('defaults a custom space from an older server without the field to everyone else Can view', async () => {
      const { everyone_else_access_level: _omitted, ...legacyCustom } = customPermission;

      mockGetSpacePermission.mockResolvedValue(
        permissionResponse({ permission: legacyCustom as SpacePermissionSettings })
      );
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      expect(screen.getByTestId('manage-space-everyone-else-access').textContent).toContain('shareAction.canView');
      fireEvent.click(screen.getByTestId(`manage-space-custom-members-access-option-${AccessLevel.ReadOnly}`));

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
        ...customPermission,
        member_default_access_level: AccessLevel.ReadOnly,
        everyone_else_access_level: AccessLevel.ReadOnly,
      });
    });
  });

  it('persists Custom permission selections immediately and the name when editing finishes', async () => {
    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    const customAccessCard = screen.getByTestId('manage-space-custom-permissions-card');

    expect(customAccessCard.textContent).toContain('space.permissionManager.customMembersDescription');
    fireEvent.click(screen.getByTestId(`manage-space-custom-members-access-option-${AccessLevel.ReadOnly}`));
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
    expect(mockUpdateStructuredSpace).toHaveBeenNthCalledWith(1, 'workspace-1', 'space-1', {
      permission: {
        ...customPermission,
        member_default_access_level: AccessLevel.ReadOnly,
      },
    });

    const nameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    fireEvent.change(nameInput, {
      target: { value: 'Updated space' },
    });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(2));
    expect(mockUpdateStructuredSpace).toHaveBeenNthCalledWith(2, 'workspace-1', 'space-1', {
      name: 'Updated space',
    });
    expect(mockUpdateSpace).not.toHaveBeenCalled();
  });

  it.each([404, 405])(
    'fails closed when a live permission refresh returns unsupported HTTP %s',
    async (status) => {
      mockGetSpacePermission
        .mockResolvedValueOnce(permissionResponse({ permission: customPermission }))
        .mockRejectedValueOnce({ code: status, httpStatus: status, message: 'Unsupported route' });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      const nameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

      act(() => {
        mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'permission-route-removed' });
      });
      await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(nameInput.hasAttribute('disabled')).toBe(true));

      expect(screen.getAllByTestId(/^manage-space-visibility-option-/)).toHaveLength(3);
      expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(true);
      expect(visibilityOption(SpaceVisibility.Custom).disabled).toBe(true);
      expect(visibilityOption(SpaceVisibility.Private).disabled).toBe(true);

      fireEvent.change(nameInput, {
        target: { value: 'Unauthorized rename' },
      });
      fireEvent.blur(nameInput);
      fireEvent.click(visibilityOption(SpaceVisibility.Private));

      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      expect(mockUpdateSpace).not.toHaveBeenCalled();
      expect(mockUpdateStructuredSpace).not.toHaveBeenCalled();
    }
  );

  it('persists a metadata-only rename on blur without a permission payload', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    const nameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    fireEvent.change(nameInput, {
      target: { value: 'Metadata only' },
    });
    fireEvent.blur(nameInput);

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        name: 'Metadata only',
      })
    );
    expect(mockUpdateStructuredSpace.mock.calls[0][2]).not.toHaveProperty('permission');
  });

  it('serializes overlapping renames and rolls failed edits back to server-confirmed metadata', async () => {
    const firstRename = deferred<{ view_id: string }>();
    const secondRename = deferred<{ view_id: string }>();

    mockUpdateStructuredSpace.mockReturnValueOnce(firstRename.promise).mockReturnValueOnce(secondRename.promise);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    const nameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    fireEvent.change(nameInput, { target: { value: 'First optimistic name' } });
    fireEvent.blur(nameInput);
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));

    fireEvent.change(nameInput, { target: { value: 'Second optimistic name' } });
    fireEvent.blur(nameInput);

    // The second write waits for the first, so requests cannot complete out of
    // order and overwrite newer metadata on the server.
    expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRename.reject(new Error('first rename failed'));
    });
    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenNthCalledWith(2, 'workspace-1', 'space-1', {
        name: 'Second optimistic name',
      })
    );
    // The first failure must not replace the newer value still being saved.
    expect((nameInput as HTMLInputElement).value).toBe('Second optimistic name');

    await act(async () => {
      secondRename.reject(new Error('second rename failed'));
    });
    await waitFor(() => expect((nameInput as HTMLInputElement).value).toBe('Space one'));
  });

  it('uses field versions so an A-B-A rename cannot be rolled back by an older failure', async () => {
    const firstRename = deferred<{ view_id: string }>();
    const secondRename = deferred<{ view_id: string }>();
    const thirdRename = deferred<{ view_id: string }>();

    mockUpdateStructuredSpace
      .mockReturnValueOnce(firstRename.promise)
      .mockReturnValueOnce(secondRename.promise)
      .mockReturnValueOnce(thirdRename.promise);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    const nameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    for (const name of ['Repeated name', 'Middle name', 'Repeated name']) {
      fireEvent.change(nameInput, { target: { value: name } });
      fireEvent.blur(nameInput);
    }

    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
    await act(async () => {
      firstRename.reject(new Error('first repeated rename failed'));
    });
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(2));
    expect(nameInput.value).toBe('Repeated name');

    await act(async () => {
      secondRename.reject(new Error('middle rename failed'));
    });
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(3));
    expect(nameInput.value).toBe('Repeated name');

    await act(async () => {
      thirdRename.resolve({ view_id: 'space-1' });
    });
    expect(nameInput.value).toBe('Repeated name');
  });

  it('serializes metadata writes across closing and reopening the same space', async () => {
    const olderRename = deferred<{ view_id: string }>();
    const newerRename = deferred<{ view_id: string }>();

    mockUpdateStructuredSpace.mockReturnValueOnce(olderRename.promise).mockReturnValueOnce(newerRename.promise);
    const firstRender = render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    const firstNameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    fireEvent.change(firstNameInput, { target: { value: 'Older in-flight name' } });
    fireEvent.blur(firstNameInput);
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
    firstRender.unmount();

    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();
    const reopenedNameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    fireEvent.change(reopenedNameInput, { target: { value: 'Newer reopened name' } });
    fireEvent.blur(reopenedNameInput);
    expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1);

    await act(async () => {
      olderRename.resolve({ view_id: 'space-1' });
    });
    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenNthCalledWith(2, 'workspace-1', 'space-1', {
        name: 'Newer reopened name',
      })
    );

    await act(async () => {
      newerRename.resolve({ view_id: 'space-1' });
    });
  });

  it('still sends an already-queued metadata edit after the modal unmounts', async () => {
    const firstRename = deferred<{ view_id: string }>();
    const queuedRename = deferred<{ view_id: string }>();

    mockUpdateStructuredSpace.mockReturnValueOnce(firstRename.promise).mockReturnValueOnce(queuedRename.promise);
    const { unmount } = render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    const nameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    fireEvent.change(nameInput, { target: { value: 'First name' } });
    fireEvent.blur(nameInput);
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
    fireEvent.change(nameInput, { target: { value: 'Queued final name' } });
    fireEvent.blur(nameInput);
    unmount();

    await act(async () => {
      firstRename.resolve({ view_id: 'space-1' });
    });
    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenNthCalledWith(2, 'workspace-1', 'space-1', {
        name: 'Queued final name',
      })
    );

    await act(async () => {
      queuedRename.resolve({ view_id: 'space-1' });
    });
  });

  it('ignores a metadata failure from the previously selected space', async () => {
    const staleRename = deferred<{ view_id: string }>();

    mockUpdateStructuredSpace.mockReturnValueOnce(staleRename.promise);
    const { rerender } = render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    const firstNameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    fireEvent.change(firstNameInput, { target: { value: 'Old space optimistic name' } });
    fireEvent.blur(firstNameInput);
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));

    rerender(<ManageSpace open onClose={jest.fn()} viewId='space-2' />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').value).toBe('Space two')
    );

    await act(async () => {
      staleRename.reject(new Error('stale rename failed'));
    });

    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').value).toBe('Space two');
    expect(toast.error).not.toHaveBeenCalledWith('stale rename failed');
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

    await waitFor(() =>
      expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false)
    );
    expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(true);
    expect(visibilityOption(SpaceVisibility.Custom).disabled).toBe(true);

    const nameInput = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    fireEvent.change(nameInput, {
      target: { value: 'Renamed by member' },
    });
    fireEvent.blur(nameInput);

    await waitFor(() =>
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        name: 'Renamed by member',
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
          permission: customPermission,
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
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false);

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
    expect(screen.queryByTestId('space-group-row-group-1')).toBeNull();

    await act(async () => {
      revokedPermission.resolve(
        permissionResponse({
          permission: customPermission,
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
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
  });

  it('ignores an older permission refresh that resolves after a newer revocation', async () => {
    const stalePermission = deferred<ReturnType<typeof permissionResponse>>();
    const latestPermission = deferred<ReturnType<typeof permissionResponse>>();

    mockGetSpacePermission
      .mockResolvedValueOnce(
        permissionResponse({
          permission: customPermission,
          canManageSpace: false,
          canManageMembers: false,
          canInviteMembers: false,
          canEditSidebar: true,
        })
      )
      .mockReturnValueOnce(stalePermission.promise)
      .mockReturnValueOnce(latestPermission.promise);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false)
    );

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
          permission: customPermission,
          canManageSpace: false,
          canManageMembers: false,
          canInviteMembers: false,
          canEditSidebar: false,
        })
      );
    });
    await waitFor(() =>
      expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true)
    );

    await act(async () => {
      stalePermission.resolve(
        permissionResponse({
          permission: customPermission,
          canManageSpace: false,
          canManageMembers: false,
          canInviteMembers: false,
          canEditSidebar: true,
        })
      );
    });

    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
  });

  it('keeps an authoritative permission refresh when an older optimistic mutation later fails', async () => {
    const staleMutation = deferred<{ view_id: string }>();

    mockGetSpacePermission
      .mockResolvedValueOnce(permissionResponse({ permission: customPermission }))
      .mockResolvedValueOnce(permissionResponse({ permission: publicPermission }));
    mockUpdateStructuredSpace.mockReturnValueOnce(staleMutation.promise);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    fireEvent.click(visibilityOption(SpaceVisibility.Private));
    confirmPending();
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'authoritative-refresh' });
    });
    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    await waitFor(() => expectSelectedVisibility(SpaceVisibility.Public));

    await act(async () => {
      staleMutation.reject(new Error('older mutation failed'));
    });

    expectSelectedVisibility(SpaceVisibility.Public);
    expect(toast.error).not.toHaveBeenCalledWith('older mutation failed');
  });

  it('changes the member default without overwriting a manual member grant', async () => {
    const member = manualMember();

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
    mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await screen.findByTestId(`space-member-row-${member.uid}`);
    fireEvent.click(screen.getByTestId(`manage-space-custom-members-access-option-${AccessLevel.ReadOnly}`));

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

  describe('members tab', () => {
    beforeEach(() => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
    });

    it('labels roles as Space owner / Space member and shows the workspace role under the name', async () => {
      const owner = creatorMember();
      const member = manualMember();
      const memberGroup = group('group-1', 'Engineering');

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      mockGetSpaceMembers.mockResolvedValue({ members: [owner, member], groups: [memberGroup] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const ownerRow = await screen.findByTestId(`space-member-row-${owner.uid}`);
      const memberRow = screen.getByTestId(`space-member-row-${member.uid}`);
      const groupRow = screen.getByTestId('space-group-row-group-1');

      expect(within(ownerRow).getByTestId('space-member-subtitle').textContent).toBe(
        'space.permissionManager.workspaceOwner · space-creator@appflowy.io'
      );
      expect(within(ownerRow).getByRole('button', { name: 'space.permissionManager.owner' })).toBeTruthy();
      expect(within(memberRow).getByTestId('space-member-subtitle').textContent).toBe(
        'space.permissionManager.workspaceMember · manual-member@appflowy.io'
      );
      expect(within(memberRow).getByRole('button', { name: 'space.permissionManager.member' })).toBeTruthy();
      // Groups show "Group · N members" instead of a workspace role, and the
      // role menu offers exactly Space owner / Space member (+ Remove).
      expect(within(groupRow).getByTestId('space-group-subtitle').textContent).toBe(
        'space.permissionManager.groupInfo:{"count":2}'
      );
      expect(
        within(groupRow)
          .getAllByRole('button')
          .map((button) => button.textContent)
      ).toEqual([
        'space.permissionManager.member',
        'space.permissionManager.ownerspace.permissionManager.ownerRoleDescription',
        'space.permissionManager.memberspace.permissionManager.memberRoleDescriptionselected',
        'space.permissionManager.remove',
      ]);
      // There is no per-row access column on a custom space.
      expect(within(memberRow).queryByText('shareAction.canEdit')).toBeNull();
    });

    it('falls back to the email alone when the server omits the workspace role', async () => {
      const member = { ...manualMember(), workspace_role: undefined };

      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const row = await screen.findByTestId(`space-member-row-${member.uid}`);

      expect(within(row).getByTestId('space-member-subtitle').textContent).toBe('manual-member@appflowy.io');
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

    it('tracks simultaneous role updates independently for every member row', async () => {
      const firstMember = manualMember();
      const secondMember: SpaceMember = {
        ...manualMember(),
        uid: '6789012345678901',
        name: 'Second member',
        email: 'second-member@appflowy.io',
      };
      const firstUpdate = deferred<void>();
      const secondUpdate = deferred<void>();

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      mockGetSpaceMembers.mockResolvedValue({ members: [firstMember, secondMember], groups: [] });
      mockUpdateSpaceMember.mockReturnValueOnce(firstUpdate.promise).mockReturnValueOnce(secondUpdate.promise);
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const firstRow = await screen.findByTestId(`space-member-row-${firstMember.uid}`);
      const secondRow = screen.getByTestId(`space-member-row-${secondMember.uid}`);

      fireEvent.click(
        within(firstRow).getByRole('button', {
          name: 'space.permissionManager.owner space.permissionManager.ownerRoleDescription',
        })
      );
      fireEvent.click(
        within(secondRow).getByRole('button', {
          name: 'space.permissionManager.owner space.permissionManager.ownerRoleDescription',
        })
      );

      await waitFor(() => expect(mockUpdateSpaceMember).toHaveBeenCalledTimes(2));
      expect(within(firstRow).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(
        true
      );
      expect(
        within(secondRow).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')
      ).toBe(true);

      await act(async () => {
        firstUpdate.resolve();
      });
      await waitFor(() =>
        expect(within(firstRow).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(
          false
        )
      );
      expect(
        within(secondRow).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')
      ).toBe(true);

      await act(async () => {
        secondUpdate.resolve();
      });
      await waitFor(() =>
        expect(
          within(secondRow).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')
        ).toBe(false)
      );
    });

    it('invalidates a pending member update when the modal unmounts', async () => {
      const member = manualMember();
      const pendingUpdate = deferred<void>();

      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      mockUpdateSpaceMember.mockReturnValueOnce(pendingUpdate.promise);
      const { unmount } = render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const row = await screen.findByTestId(`space-member-row-${member.uid}`);

      fireEvent.click(
        within(row).getByRole('button', {
          name: 'space.permissionManager.owner space.permissionManager.ownerRoleDescription',
        })
      );
      await waitFor(() => expect(mockUpdateSpaceMember).toHaveBeenCalledTimes(1));
      unmount();

      await act(async () => {
        pendingUpdate.resolve();
      });

      // The initial roster load is the only one; a detached mutation must not
      // revalidate or emit UI feedback after the dialog has gone away.
      expect(mockGetSpaceMembers).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
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
      fireEvent.change(screen.getByTestId('inline-member-search'), { target: { value: 'Candidate' } });
      fireEvent.click(screen.getByTestId('inline-member-add'));

      expect(screen.getByTestId('inline-member-search').value).toBe('');

      await waitFor(() =>
        expect(mockAddSpaceMember).toHaveBeenCalledWith(
          'workspace-1',
          'space-1',
          expect.objectContaining({ uid: workspaceCandidate.uid })
        )
      );
    });

    it('adds a workspace group found through the search as a Space member', async () => {
      const grantedGroup: WorkspaceGroupSpacePermission = {
        ...group('group-engineering', 'Engineering'),
        member_count: 12,
        access_level: AccessLevel.ReadAndWrite,
      };

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      mockGetSpaceMembers
        .mockResolvedValueOnce({ members: [], groups: [] })
        .mockResolvedValueOnce({ members: [], groups: [grantedGroup] });
      mockAddSpaceGroupPermission.mockResolvedValue(grantedGroup);
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));
      await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1'));
      expect(screen.queryByTestId('space-group-inline-search-result-group-engineering')).toBeNull();

      fireEvent.change(screen.getByTestId('inline-member-search'), { target: { value: 'engin' } });

      const result = await screen.findByTestId('space-group-inline-search-result-group-engineering');

      expect(result.textContent).toContain('space.permissionManager.groupInfo:{"count":12}');
      fireEvent.click(within(result).getByTestId('space-group-inline-search-result-add'));

      expect(screen.getByTestId('inline-member-search').value).toBe('');

      await waitFor(() =>
        expect(mockAddSpaceGroupPermission).toHaveBeenCalledWith('workspace-1', 'space-1', 'group-engineering', {
          role: SpaceMemberRole.Member,
          access_level: AccessLevel.ReadAndWrite,
        })
      );
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.permissionManager.addSpaceGroupSuccess'));
      await waitFor(() => expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2));
      // Once granted, the group leaves the add results.
      await waitFor(() => expect(screen.queryByTestId('space-group-inline-search-result-group-engineering')).toBeNull());
    });

    it('confirms before making a group Space owners, then updates and revokes the grant', async () => {
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
      expect(mockUpdateSpaceGroupPermission).not.toHaveBeenCalled();
      expect(confirmDialog().textContent).toContain('space.permissionManager.groupOwnerTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.groupOwnerDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe('space.permissionManager.groupOwnerAction');
      confirmPending();

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

    it('demotes a group to Space member without asking', async () => {
      const ownerGroup = group('group-1', 'Engineering', SpaceMemberRole.Owner);
      const memberGroup = group('group-1', 'Engineering');

      mockGetSpaceMembers
        .mockResolvedValueOnce({ members: [], groups: [ownerGroup] })
        .mockResolvedValueOnce({ members: [], groups: [memberGroup] });
      mockUpdateSpaceGroupPermission.mockResolvedValue(memberGroup);
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const row = await screen.findByTestId('space-group-row-group-1');

      fireEvent.click(
        within(row).getByRole('button', {
          name: 'space.permissionManager.member space.permissionManager.memberRoleDescription',
        })
      );

      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      await waitFor(() =>
        expect(mockUpdateSpaceGroupPermission).toHaveBeenCalledWith('workspace-1', 'space-1', 'group-1', {
          role: SpaceMemberRole.Member,
          access_level: AccessLevel.ReadAndWrite,
        })
      );
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
      confirmPending();

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
      mockGetSpacePermission.mockResolvedValue(
        permissionResponse({
          permission: customPermission,
          canManageMembers: false,
          canInviteMembers: true,
        })
      );
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
      confirmPending();
      fireEvent.click(within(secondRow).getByRole('button', { name: ownerButtonName }));
      confirmPending();

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

    it('keeps a public space roster read-only and lists the workspace role under each name', async () => {
      const member = workspaceDefaultMember();
      const owner = creatorMember();
      const memberGroup = group('group-1', 'Engineering');

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      mockGetSpaceMembers.mockResolvedValue({ members: [owner, member], groups: [memberGroup] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const memberRow = await screen.findByTestId(`space-member-row-${member.uid}`);
      const ownerRow = screen.getByTestId(`space-member-row-${owner.uid}`);
      const groupRow = screen.getByTestId('space-group-row-group-1');

      expect(screen.queryByTestId('inline-member-search')).toBeNull();
      expect(screen.queryByTestId('inline-member-add')).toBeNull();
      expect(mockGetMembers).not.toHaveBeenCalled();
      expect(mockGetWorkspaceGroups).not.toHaveBeenCalled();
      expect(within(ownerRow).getByText('space.permissionManager.owner')).toBeTruthy();
      expect(within(ownerRow).getByTestId('space-member-subtitle').textContent).toContain(
        'space.permissionManager.workspaceOwner'
      );
      expect(within(memberRow).getByText('space.permissionManager.member')).toBeTruthy();
      expect(within(memberRow).getByTestId('space-member-subtitle').textContent).toContain(
        'space.permissionManager.workspaceMember'
      );
      expect(within(memberRow).queryByRole('button')).toBeNull();
      expect(within(groupRow).getByText('space.permissionManager.member')).toBeTruthy();
      expect(within(groupRow).queryByRole('button')).toBeNull();
      expect(screen.queryByRole('button', { name: 'space.permissionManager.remove' })).toBeNull();
    });

    it('keeps page-share members inherited while allowing explicit Custom members to be removed', async () => {
      const explicitMember = manualMember();
      const inheritedMember = pageShareMember();
      const memberGroup = group('group-1', 'Engineering');

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      mockGetSpaceMembers.mockResolvedValue({ members: [explicitMember, inheritedMember], groups: [memberGroup] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const inheritedRow = await screen.findByTestId(`space-member-row-${inheritedMember.uid}`);
      const explicitRow = screen.getByTestId(`space-member-row-${explicitMember.uid}`);
      const groupRow = screen.getByTestId('space-group-row-group-1');

      await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));
      expect(mockGetMembers).toHaveBeenCalledWith('workspace-1');
      expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1');
      expect(screen.getByText('space.permissionManager.inheritedAccessManagedFromGeneral')).toBeTruthy();
      expect(within(inheritedRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(true);
      expect(within(explicitRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(false);
      expect(within(groupRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(false);

      fireEvent.click(within(inheritedRow).getByRole('button', { name: 'space.permissionManager.remove' }));
      expect(mockRemoveSpaceMember).not.toHaveBeenCalled();

      fireEvent.click(within(explicitRow).getByRole('button', { name: 'space.permissionManager.remove' }));

      await waitFor(() =>
        expect(mockRemoveSpaceMember).toHaveBeenCalledWith('workspace-1', 'space-1', explicitMember.uid)
      );
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('space.permissionManager.removeSpaceMemberSuccess')
      );
      expect(mockUpdateSpaceMember).not.toHaveBeenCalled();
    });

    it('tells managers when listed custom members currently have No access', async () => {
      mockGetSpacePermission.mockResolvedValue(
        permissionResponse({ permission: { ...customPermission, member_default_access_level: null } })
      );
      mockGetSpaceMembers.mockResolvedValue({ members: [manualMember()], groups: [] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await screen.findByTestId('manage-space-members-no-access-hint');
    });

    it('shows only the locked current owner in the Members tab for Private spaces', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: privatePermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      expect(screen.getByText('space.permissionManager.membersTab')).toBeTruthy();
      expect(screen.getByTestId('private-space-members-info')).toBeTruthy();
      const ownerRow = screen.getByTestId('private-space-owner-row');

      expect(ownerRow.textContent).toContain('Nathan');
      expect(ownerRow.textContent).toContain('space.permissionManager.workspaceOwner');
      expect(within(ownerRow).queryByRole('button')).toBeNull();
      expect(screen.queryByTestId('inline-member-search')).toBeNull();
      expect(mockGetSpaceMembers).not.toHaveBeenCalled();
    });
  });
});
