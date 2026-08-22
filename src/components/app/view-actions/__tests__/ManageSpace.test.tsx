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
    selectedWorkspace: { id: 'workspace-1', name: 'Acme' },
    workspaces: [{ id: 'workspace-1', name: 'Acme' }],
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
  }) =>
    open ? (
      <div data-testid={PaperProps?.['data-testid']}>
        <div data-testid={`${PaperProps?.['data-testid'] ?? 'modal'}-title`}>{title}</div>
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

async function waitForSettingsLoaded() {
  await waitFor(() => expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(false));
}

function confirmDialog() {
  return screen.getByTestId('manage-space-confirm-dialog');
}

function confirmPending() {
  fireEvent.click(screen.getByTestId('manage-space-confirm-ok'));
}

function saveButton() {
  return screen.getByTestId('manage-space-save');
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
      expect(screen.getAllByTestId(/^manage-space-visibility-option-/)).toHaveLength(3);
      expect(visibilityOption(SpaceVisibility.Public).textContent).toContain('space.publicPermission');
      expect(visibilityOption(SpaceVisibility.Public).textContent).toContain('space.publicPermissionDescription');
      expect(visibilityOption(SpaceVisibility.Private).textContent).toContain('space.privatePermissionDescription');
      expect(visibilityOption(SpaceVisibility.Custom).textContent).toContain('space.customPermissionDescription');
      expect(visibilityOption(SpaceVisibility.Custom).textContent).toContain('space.newBadge');
      expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-checked')).toBe('true');
      expect(visibilityOption(SpaceVisibility.Custom).getAttribute('aria-checked')).toBe('false');
      expect(screen.getByTestId('manage-space-public-access-card')).toBeTruthy();
      expect(screen.queryByTestId('manage-space-custom-permissions-card')).toBeNull();
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
    });

    it('confirms Public → Private with the PRD copy and then saves only the structured update', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Private));

      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPrivateTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPrivateDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe(
        'space.permissionManager.confirmToPrivateAction'
      );
      // Nothing moves until the user agrees.
      expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-checked')).toBe('true');

      confirmPending();
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      expect(visibilityOption(SpaceVisibility.Private).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByTestId('manage-space-private-access-card')).toBeTruthy();
      fireEvent.click(saveButton());

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
        name: 'Space one',
        space_icon: 'space',
        space_icon_color: '#000000',
        permission: { ...privatePermission, everyone_else_access_level: null },
      });
      // The structured update keeps the legacy marker in step on the server;
      // no compatibility write precedes or follows it.
      expect(mockUpdateSpace).not.toHaveBeenCalled();
    });

    it('cancelling a type switch keeps the draft on the loaded type', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Custom));
      fireEvent.click(screen.getByTestId('manage-space-confirm-dialog-cancel'));

      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-checked')).toBe('true');
      fireEvent.click(saveButton());

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(mockUpdateStructuredSpace.mock.calls[0][2]).not.toHaveProperty('permission');
    });

    it('confirms Private → Public with the PRD copy', async () => {
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
        target: { value: 'Renamed public space' },
      });
      fireEvent.click(visibilityOption(SpaceVisibility.Public));

      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPublicTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.confirmToPublicDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe(
        'space.permissionManager.confirmToPublicAction'
      );
      confirmPending();
      fireEvent.click(saveButton());

      await waitFor(() =>
        expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
          name: 'Renamed public space',
          space_icon: 'space',
          space_icon_color: '#000000',
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
      fireEvent.click(saveButton());

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
      expect(visibilityOption(SpaceVisibility.Custom).getAttribute('aria-checked')).toBe('true');
      fireEvent.click(saveButton());

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      // Members keep Can edit; everyone else opens with Can view.
      expect(structuredUpdatePermission()).toEqual(customPermission);
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
      fireEvent.click(saveButton());

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
      fireEvent.click(saveButton());

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
        ...privatePermission,
        member_default_access_level: AccessLevel.ReadAndWrite,
        everyone_else_access_level: null,
      });
    });

    it('returns to the loaded type without asking and then saves no permission', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(visibilityOption(SpaceVisibility.Public));
      confirmPending();
      expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-checked')).toBe('true');

      fireEvent.click(visibilityOption(SpaceVisibility.Custom));
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      expect(visibilityOption(SpaceVisibility.Custom).getAttribute('aria-checked')).toBe('true');
      // The everyone-else level the server holds survives the round trip.
      expect(screen.getByTestId('manage-space-everyone-else-access').textContent).toContain('shareAction.canView');
      fireEvent.click(saveButton());

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(mockUpdateStructuredSpace.mock.calls[0][2]).not.toHaveProperty('permission');
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
      expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-checked')).toBe('false');
      expect(visibilityOption(SpaceVisibility.Private).getAttribute('aria-checked')).toBe('false');
      expect(visibilityOption(SpaceVisibility.Custom).getAttribute('aria-checked')).toBe('false');
      // Only an exact Public visibility makes the roster read-only.
      await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));

      fireEvent.click(screen.getByTestId(`manage-space-members-default-access-option-${AccessLevel.ReadOnly}`));
      fireEvent.click(saveButton());

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
    it('renders the Who / Access table with the design copy and an editable members level', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: publicPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      const card = screen.getByTestId('manage-space-public-access-card');

      expect(card.textContent).toContain('space.permissionManager.publicAccessTitle');
      expect(card.textContent).toContain('space.permissionManager.publicAccessDescription');
      expect(card.textContent).toContain('space.permissionManager.who');
      expect(card.textContent).toContain('space.permissionManager.access');
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
      expect(screen.getAllByTestId(/^manage-space-workspace-members-access-option-/).map((el) => el.textContent)).toEqual(
        ['shareAction.fullAccess', 'shareAction.canEditselected', 'shareAction.canView']
      );

      fireEvent.click(screen.getByTestId(`manage-space-workspace-members-access-option-${AccessLevel.ReadOnly}`));
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      fireEvent.click(saveButton());

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
      // Full access / Can edit / Can view / No access for both audiences.
      expect(screen.getAllByTestId(/^manage-space-custom-members-access-option-/).map((el) => el.textContent)).toEqual([
        'shareAction.fullAccess',
        'shareAction.canEditselected',
        'shareAction.canView',
        'space.permissionManager.noAccess',
      ]);
      expect(screen.getAllByTestId(/^manage-space-everyone-else-access-option-/).map((el) => el.textContent)).toEqual([
        'shareAction.fullAccess',
        'shareAction.canEdit',
        'shareAction.canViewselected',
        'space.permissionManager.noAccess',
      ]);
    });

    it('saves No access as null for both audiences', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitForSettingsLoaded();
      fireEvent.click(screen.getByTestId('manage-space-custom-members-access-option-none'));
      fireEvent.click(screen.getByTestId('manage-space-everyone-else-access-option-none'));
      expect(screen.queryByTestId('manage-space-confirm-dialog')).toBeNull();
      fireEvent.click(saveButton());

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
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
      fireEvent.click(saveButton());

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
      fireEvent.click(saveButton());

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
        ...customPermission,
        member_default_access_level: AccessLevel.ReadOnly,
        everyone_else_access_level: AccessLevel.ReadOnly,
      });
    });
  });

  it('atomically saves metadata and a changed structured ACL of a private space', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    const defaultAccessRow = screen.getByTestId('manage-space-members-default-access-row');

    expect(defaultAccessRow.textContent).toContain('space.permissionManager.membersDescription');
    fireEvent.click(screen.getByTestId(`manage-space-members-default-access-option-${AccessLevel.ReadOnly}`));
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Updated space' },
    });
    fireEvent.click(saveButton());

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

      await waitFor(() => expect(saveButton().disabled).toBe(false));

      expect(screen.queryByText('space.permissionManager.membersTab')).toBeNull();
      expect(screen.queryByTestId('manage-space-members-default-access-row')).toBeNull();
      expect(screen.queryByTestId('manage-space-public-access-card')).toBeNull();
      // The binary editor cannot persist Custom, so it must not offer it.
      expect(screen.getAllByTestId(/^manage-space-visibility-option-/)).toHaveLength(2);
      expect(visibilityOption(SpaceVisibility.Public)).toBeTruthy();
      expect(screen.queryByTestId(`manage-space-visibility-option-${SpaceVisibility.Custom}`)).toBeNull();

      fireEvent.click(visibilityOption(SpaceVisibility.Private));
      confirmPending();
      fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
        target: { value: 'Legacy renamed space' },
      });
      fireEvent.click(saveButton());

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

    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Metadata only' },
    });
    fireEvent.click(saveButton());

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

    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(true);
    expect(visibilityOption(SpaceVisibility.Custom).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Renamed by member' },
    });
    fireEvent.click(saveButton());

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
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false);

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    expect(saveButton().disabled).toBe(true);
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
    expect(saveButton().disabled).toBe(true);
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

    await waitFor(() => expect(saveButton().disabled).toBe(false));

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
    await waitFor(() => expect(saveButton().disabled).toBe(true));

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

    expect(saveButton().disabled).toBe(true);
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
  });

  it('changes the member default without overwriting a manual member grant', async () => {
    const member = manualMember();

    mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await screen.findByTestId(`space-member-row-${member.uid}`);
    fireEvent.click(screen.getByTestId(`manage-space-members-default-access-option-${AccessLevel.ReadOnly}`));
    fireEvent.click(saveButton());

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
      expect(mockUseAddableWorkspaceMembers).toHaveBeenLastCalledWith(
        expect.objectContaining({ excludePending: true })
      );
      fireEvent.click(screen.getByTestId('inline-member-add'));

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
        permissionResponse({ canManageMembers: false, canInviteMembers: true })
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

    it('lets managers edit a custom space roster, including removing any listed member', async () => {
      const explicitMember = manualMember();
      const defaultMember = workspaceDefaultMember();
      const memberGroup = group('group-1', 'Engineering');

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      mockGetSpaceMembers.mockResolvedValue({ members: [explicitMember, defaultMember], groups: [memberGroup] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const defaultRow = await screen.findByTestId(`space-member-row-${defaultMember.uid}`);
      const explicitRow = screen.getByTestId(`space-member-row-${explicitMember.uid}`);
      const groupRow = screen.getByTestId('space-group-row-group-1');

      await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));
      expect(mockGetMembers).toHaveBeenCalledWith('workspace-1');
      expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1');
      expect(screen.queryByText('space.permissionManager.inheritedAccessManagedFromGeneral')).toBeNull();
      expect(within(defaultRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(false);
      expect(within(explicitRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(false);
      expect(within(groupRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(false);

      fireEvent.click(within(defaultRow).getByRole('button', { name: 'space.permissionManager.remove' }));

      await waitFor(() =>
        expect(mockRemoveSpaceMember).toHaveBeenCalledWith('workspace-1', 'space-1', defaultMember.uid)
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

    it('keeps default members of a private space non-removable', async () => {
      const defaultMember = workspaceDefaultMember();

      mockGetSpaceMembers.mockResolvedValue({ members: [defaultMember], groups: [] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const defaultRow = await screen.findByTestId(`space-member-row-${defaultMember.uid}`);

      expect(within(defaultRow).getByRole('button', { name: 'space.permissionManager.remove' }).disabled).toBe(true);
      expect(screen.getByText('space.permissionManager.inheritedAccessManagedFromGeneral')).toBeTruthy();
    });
  });
});
