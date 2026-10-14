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

import type { CSSProperties, KeyboardEventHandler, ReactNode } from 'react';

const mockSetOverride = jest.fn();
const mockFetchOwnAccessDetails = jest.fn();
// The signed-in user, matched to their own roster row by UUID.
const OWN_UID = '9000000000000001';
const OWN_UUID = '90000000-1234-4123-8123-123456789abc';
const mockAddSpaceMemberByUuid = jest.fn();
const mockUpdateSpaceMemberByUuid = jest.fn();
const mockRemoveSpaceMemberByUuid = jest.fn();
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

jest.mock('@/application/services/js-services/space-member-assignment', () => ({
  ...jest.requireActual('@/application/services/js-services/space-member-assignment'),
  setSpaceMemberAccessOverride: (...args: unknown[]) => mockSetOverride(...args),
  fetchOwnSpaceAccessDetails: (...args: unknown[]) => mockFetchOwnAccessDetails(...args),
}));

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
    updateStructuredSpace: (...args: unknown[]) => mockUpdateStructuredSpace(...args),
    getSpaceMembers: (...args: unknown[]) => mockGetSpaceMembers(...args),
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    getWorkspaceGroups: (...args: unknown[]) => mockGetWorkspaceGroups(...args),
    addSpaceMember: (...args: unknown[]) => mockAddSpaceMember(...args),
    addSpaceMemberByUuid: (...args: unknown[]) => mockAddSpaceMemberByUuid(...args),
    updateSpaceMemberByUuid: (...args: unknown[]) => mockUpdateSpaceMemberByUuid(...args),
    removeSpaceMemberByUuid: (...args: unknown[]) => mockRemoveSpaceMemberByUuid(...args),
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
  useAuthenticatedUserIdOptional: () => 'actor',
  useCurrentUserOptional: () => ({
    name: 'Nathan',
    email: 'nathan@appflowy.io',
    avatar: '',
    uid: OWN_UID,
    uuid: OWN_UUID,
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
    PaperProps?: { 'data-testid'?: string; style?: CSSProperties };
    showActions?: boolean;
  }) =>
    open ? (
      <div data-testid={PaperProps?.['data-testid']} style={PaperProps?.style}>
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
    onAddButtonClick,
    onInputKeyDown,
  }: {
    addableMembers: WorkspaceMember[];
    inputDisabled?: boolean;
    addButtonDisabled?: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    onAddMember: (member: WorkspaceMember) => void;
    onAddButtonClick?: () => void;
    onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  }) => (
    <div>
      <input
        data-testid='inline-member-search'
        disabled={inputDisabled}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={onInputKeyDown}
      />
      <button
        data-testid='inline-member-add'
        disabled={addButtonDisabled || addableMembers.length === 0}
        onClick={() => onAddMember(addableMembers[0])}
      >
        add
      </button>
      {/* The real component's Add people or groups button. */}
      {onAddButtonClick && (
        <button data-testid='inline-member-browse' disabled={addButtonDisabled} onClick={onAddButtonClick}>
          browse
        </button>
      )}
      {addableMembers.map((member) => (
        <div key={member.uid} data-testid={`inline-member-result-${member.uid}`}>
          {member.name}
        </div>
      ))}
    </div>
  ),
}));

jest.mock('@/components/app/view-actions/SpaceIconButton', () => ({
  __esModule: true,
  default: () => <div data-testid='space-icon-button' />,
}));

jest.mock('@/components/ui/dropdown-menu', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  // Menus render open; clicking a trigger reports the menu as opened to menus that listen.
  const OpenChangeContext = React.createContext<((open: boolean) => void) | undefined>(undefined);

  return {
  DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => (
    <OpenChangeContext.Provider value={onOpenChange}>
      <div>{children}</div>
    </OpenChangeContext.Provider>
  ),
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
  DropdownMenuTrigger: ({ children }: { children: React.ReactElement<{ onClick?: (event: unknown) => void }> }) => {
    const onOpenChange = React.useContext(OpenChangeContext);

    if (!onOpenChange) return <>{children}</>;
    return React.cloneElement(children, {
      onClick: (event: unknown) => {
        children.props.onClick?.(event);
        onOpenChange(true);
      },
    });
  },
  };
});

jest.mock('@/components/ui/progress', () => ({
  Progress: () => <span data-testid='progress' />,
}));

// Tooltip text is rendered inline so the explanations can be asserted.
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
    <div role='tooltip' data-testid={testId}>
      {children}
    </div>
  ),
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
    TabLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
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

// What the HTTP layer rejects with: the server's own text names internal IDs.
const SPACE_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const deniedApiError = {
  code: 1012,
  httpStatus: 403,
  message: `user 42 cannot manage members for space ${SPACE_UUID}`,
};
const notFoundApiError = {
  code: -2,
  httpStatus: 404,
  message: `Record not found:space member 42 not found in space ${SPACE_UUID}`,
};
const networkApiError = { code: -1, message: 'Network Error' };

function expectNoServerTextInToasts() {
  for (const [message] of [...(toast.error as jest.Mock).mock.calls, ...(toast.success as jest.Mock).mock.calls]) {
    expect(String(message)).not.toMatch(/\b42\b|3fa85f64|Network Error|Record not found/);
  }
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
    mockAddSpaceMemberByUuid.mockResolvedValue(undefined);
    mockUpdateSpaceMemberByUuid.mockResolvedValue(undefined);
    mockSetOverride.mockResolvedValue(undefined);
    mockFetchOwnAccessDetails.mockResolvedValue(null);
    mockUpdateSpaceMember.mockResolvedValue(undefined);
    mockRemoveSpaceMember.mockResolvedValue(undefined);
    mockAddSpaceGroupPermission.mockResolvedValue(undefined);
    mockUpdateSpaceGroupPermission.mockResolvedValue(undefined);
    mockRemoveSpaceGroupPermission.mockResolvedValue(undefined);
  });

  describe('ordinary member access overrides', () => {
    const memberUuid = '12345678-1234-4123-8123-123456789abc';
    const inheritEditLabel = 'space.memberOverride.defaultSuffix:{"level":"space.memberOverride.levels.canEdit"}';

    function supportedPermission(permission: SpacePermissionSettings = customPermission) {
      return { ...permissionResponse({ permission }), member_access_overrides_supported: true };
    }

    function assignedMember(overrides: Partial<SpaceMember> = {}): SpaceMember {
      return {
        ...manualMember(),
        user_uuid: memberUuid,
        access_level_override: null,
        effective_access_level: AccessLevel.ReadAndWrite,
        ...overrides,
      };
    }

    // The roster read after a save reflects what the server stored.
    function storeOverridesInRoster(member: SpaceMember) {
      mockSetOverride.mockImplementation(async (_workspace, _space, _principal, override) => {
        const updated = {
          ...member,
          access_level_override: override,
          effective_access_level: override ?? AccessLevel.ReadAndWrite,
        };

        mockGetSpaceMembers.mockResolvedValue({ members: [updated], groups: [] });
        return updated;
      });
    }

    async function openMembersTab() {
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
      await waitForSettingsLoaded();
      // The Members tab reads your own access explanation; let an immediate answer land in act.
      await act(async () => {
        fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
      });
    }

    function accessTrigger(uid: string) {
      return screen.getByTestId(`space-member-access-${uid}`);
    }

    describe('where your own extra access comes from', () => {
      const noEscape = { interpolation: { escapeValue: false } };

      function ownMember(overrides: Partial<SpaceMember> = {}): SpaceMember {
        return assignedMember({
          uid: OWN_UID,
          user_uuid: OWN_UUID,
          name: 'Nathan',
          email: 'nathan@appflowy.io',
          access_level_override: AccessLevel.ReadOnly,
          effective_access_level: AccessLevel.ReadOnly,
          ...overrides,
        });
      }

      function marketingGroup(): WorkspaceGroupSpacePermission {
        return {
          ...group('group-marketing', 'Marketing'),
          access_level_override: null,
          effective_access_level: AccessLevel.ReadAndWrite,
        };
      }

      function ownDetails(overrides: Record<string, unknown> = {}) {
        return {
          space_id: 'space-1',
          uid: OWN_UID,
          access_level: AccessLevel.ReadAndWrite,
          source: 'workspace_group',
          member_default_access_level: AccessLevel.ReadAndWrite,
          direct_member_access_level: AccessLevel.ReadOnly,
          group_member_access_level: AccessLevel.ReadAndWrite,
          group_space_coverage_access_level: null,
          explicit_page_access_level: null,
          ...overrides,
        };
      }

      it('reads it once your own row is shown, so your menu already explains it when it opens', async () => {
        const other = assignedMember();

        mockGetSpacePermission.mockResolvedValue(supportedPermission());
        mockGetSpaceMembers.mockResolvedValue({ members: [ownMember(), other], groups: [marketingGroup()] });
        mockFetchOwnAccessDetails.mockResolvedValue(ownDetails());
        render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
        await waitForSettingsLoaded();
        await waitFor(() => expect(accessTrigger(OWN_UID).disabled).toBe(false));
        await act(async () => undefined);
        // Nothing is read while the General tab is shown.
        expect(mockFetchOwnAccessDetails).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
        const expected = mockTranslate('space.memberOverride.extraAccess.edit', {
          source: mockTranslate('space.memberOverride.extraAccessSource.group', { name: 'Marketing', ...noEscape }),
          ...noEscape,
        });

        // The line is there before any menu opens (menus render open in these tests).
        expect((await screen.findByTestId(`space-member-access-${OWN_UID}-note`)).textContent).toBe(expected);
        // One read, for the signed-in user: the server only explains their own access.
        expect(mockFetchOwnAccessDetails).toHaveBeenCalledTimes(1);
        expect(mockFetchOwnAccessDetails).toHaveBeenCalledWith('workspace-1', 'space-1', OWN_UID);
        expect(screen.queryByTestId(`space-member-access-${other.uid}-note`)).toBeNull();

        // Opening menus reads nothing more.
        fireEvent.click(accessTrigger(other.uid));
        fireEvent.click(accessTrigger(OWN_UID));
        await act(async () => undefined);
        expect(mockFetchOwnAccessDetails).toHaveBeenCalledTimes(1);
      });

      it('reads nothing when your own row has no access menu', async () => {
        mockGetSpacePermission.mockResolvedValue(supportedPermission());
        mockGetSpaceMembers.mockResolvedValue({
          members: [ownMember({ role: SpaceMemberRole.Owner }), assignedMember()],
          groups: [marketingGroup()],
        });
        mockFetchOwnAccessDetails.mockResolvedValue(ownDetails());
        await openMembersTab();
        await screen.findByTestId(`space-member-access-${manualMember().uid}`);
        await act(async () => undefined);

        expect(mockFetchOwnAccessDetails).not.toHaveBeenCalled();
      });

      it('says Access to all spaces, naming the only group that gives it', async () => {
        mockGetSpacePermission.mockResolvedValue(supportedPermission());
        mockGetSpaceMembers.mockResolvedValue({ members: [ownMember()], groups: [] });
        mockGetWorkspaceGroups.mockResolvedValue({
          groups: [
            { ...engineeringWorkspaceGroup, space_coverage_supported: true, space_coverage_access_level: null },
            {
              group_id: 'group-users',
              name: 'Users',
              member_count: 40,
              space_coverage_supported: true,
              space_coverage_access_level: AccessLevel.ReadAndWrite,
            },
          ],
        });
        mockFetchOwnAccessDetails.mockResolvedValue(
          ownDetails({ group_member_access_level: null, group_space_coverage_access_level: AccessLevel.ReadAndWrite })
        );
        await openMembersTab();

        const expected = mockTranslate('space.memberOverride.extraAccess.edit', {
          source: mockTranslate('space.memberOverride.extraAccessSource.allSpaces', { name: 'Users', ...noEscape }),
          ...noEscape,
        });

        await waitFor(() =>
          expect(screen.getByTestId(`space-member-access-${OWN_UID}-note`).textContent).toBe(expected)
        );
      });

      it('names a share of the space page that replaces what a group gives', async () => {
        // Can view on the row, Can edit through Marketing, and the space page shared at Can
        // comment: the server lets the share replace the group, so the share is the reason.
        mockGetSpacePermission.mockResolvedValue(supportedPermission());
        mockGetSpaceMembers.mockResolvedValue({ members: [ownMember()], groups: [marketingGroup()] });
        mockFetchOwnAccessDetails.mockResolvedValue(
          ownDetails({
            access_level: AccessLevel.ReadAndComment,
            source: 'explicit_page_share',
            explicit_page_access_level: AccessLevel.ReadAndComment,
          })
        );
        await openMembersTab();
        await waitFor(() => expect(accessTrigger(OWN_UID).disabled).toBe(false));
        fireEvent.click(accessTrigger(OWN_UID));

        const expected = mockTranslate('space.memberOverride.extraAccess.comment', {
          source: mockTranslate('space.memberOverride.extraAccessSource.pageShare'),
          ...noEscape,
        });

        expect((await screen.findByTestId(`space-member-access-${OWN_UID}-note`)).textContent).toBe(expected);
      });

      it('keeps quiet when nothing gives more', async () => {
        mockGetSpacePermission.mockResolvedValue(supportedPermission());
        mockGetSpaceMembers.mockResolvedValue({
          members: [ownMember({ access_level_override: AccessLevel.ReadAndWrite, effective_access_level: AccessLevel.ReadAndWrite })],
          groups: [marketingGroup()],
        });
        mockFetchOwnAccessDetails.mockResolvedValue(ownDetails());
        await openMembersTab();
        await waitFor(() => expect(mockFetchOwnAccessDetails).toHaveBeenCalledTimes(1));
        await act(async () => undefined);

        // The group gives Can edit, which the row already gives.
        expect(screen.queryByTestId(`space-member-access-${OWN_UID}-note`)).toBeNull();
      });

      it('keeps quiet when the server cannot explain', async () => {
        // An older server without the route, or a failed read: the row keeps its own level.
        mockGetSpacePermission.mockResolvedValue(supportedPermission());
        mockGetSpaceMembers.mockResolvedValue({ members: [ownMember()], groups: [marketingGroup()] });
        mockFetchOwnAccessDetails.mockResolvedValue(null);
        await openMembersTab();
        await waitFor(() => expect(mockFetchOwnAccessDetails).toHaveBeenCalledTimes(1));
        await act(async () => undefined);

        expect(screen.queryByTestId(`space-member-access-${OWN_UID}-note`)).toBeNull();
        expect(toast.error).not.toHaveBeenCalled();
      });

      it('follows a pending choice and reads it again after a permission change, keeping the last answer meanwhile', async () => {
        const own = ownMember({ access_level_override: null, effective_access_level: AccessLevel.ReadAndWrite });
        const save = deferred<SpaceMember>();
        const reread = deferred<ReturnType<typeof ownDetails> | null>();

        mockGetSpacePermission.mockResolvedValue(supportedPermission());
        mockGetSpaceMembers.mockResolvedValue({ members: [own], groups: [marketingGroup()] });
        mockFetchOwnAccessDetails
          .mockResolvedValueOnce(ownDetails({ direct_member_access_level: AccessLevel.ReadAndWrite }))
          .mockReturnValueOnce(reread.promise);
        mockSetOverride.mockReturnValue(save.promise);
        await openMembersTab();
        await waitFor(() => expect(mockFetchOwnAccessDetails).toHaveBeenCalledTimes(1));
        await act(async () => undefined);
        // Can edit by default: the group adds nothing yet.
        expect(screen.queryByTestId(`space-member-access-${OWN_UID}-note`)).toBeNull();

        // Choosing Can view for yourself shows at once that the group still lets you edit.
        fireEvent.click(screen.getByTestId(`space-member-access-${OWN_UID}-option-${AccessLevel.ReadOnly}`));
        expect(await screen.findByTestId(`space-member-access-${OWN_UID}-note`)).toBeTruthy();

        // A permission change reads it again in the background; the last answer stays meanwhile.
        act(() => {
          mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
        });
        await waitFor(() => expect(mockFetchOwnAccessDetails).toHaveBeenCalledTimes(2));
        expect(screen.getByTestId(`space-member-access-${OWN_UID}-note`)).toBeTruthy();

        // The group no longer gives more, so the line goes away with the new answer.
        await act(async () => {
          reread.resolve(ownDetails({ access_level: AccessLevel.ReadOnly, group_member_access_level: null }));
        });
        expect(screen.queryByTestId(`space-member-access-${OWN_UID}-note`)).toBeNull();
        await act(async () => {
          save.resolve({ ...own, access_level_override: AccessLevel.ReadOnly, effective_access_level: AccessLevel.ReadOnly });
        });
      });
    });

    it('lays the table out as Name | Access | Role with one explanation in the Access header', async () => {
      const member = assignedMember();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      await openMembersTab();
      await screen.findByTestId(`space-member-access-${member.uid}`);
      const header = screen.getByTestId('space-member-table-header');

      expect(header.children).toHaveLength(3);
      expect(header.children[0].textContent).toBe('space.permissionManager.name');
      expect(within(header.children[1] as HTMLElement).getByTestId('space-member-access-header').textContent).toBe(
        'space.memberOverride.label'
      );
      expect(screen.getByTestId('space-member-access-header-hint').textContent).toBe('space.memberOverride.explanation');
      expect(header.children[2].textContent).toBe('space.permissionManager.role');
      // No native select and no helper lines under each row.
      expect(document.querySelector('select')).toBeNull();
      expect(screen.queryByTestId('space-member-overrides-description')).toBeNull();
      expect(screen.queryByText(/space\.memberOverride\.(defaultAccess|assignmentAccess|inherit\b)/)).toBeNull();
      expect(screen.getAllByText('space.memberOverride.explanation')).toHaveLength(1);
    });

    it('lines the Access and Role headers up with the end of the menus below them', async () => {
      const member = assignedMember();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      await openMembersTab();
      await screen.findByTestId(`space-member-access-${member.uid}`);
      const header = screen.getByTestId('space-member-table-header');

      // The menus are ghost buttons with 8px of padding after their chevron; the headers end there too.
      expect((header.children[1] as HTMLElement).className.split(/\s+/)).toContain('pr-2');
      expect((header.children[2] as HTMLElement).className.split(/\s+/)).toContain('pr-2');
    });

    // jsdom has no layout, so this pins the rule that keeps the columns apart:
    // rows are separate grids, so no track may depend on its content.
    it('keeps the role control inside its column when the dialog is narrow', async () => {
      const member = assignedMember();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      await openMembersTab();
      const row = await screen.findByTestId(`space-member-row-${member.uid}`);

      // The Role track fits "Space member" plus its chevron, measured in a wide fallback font
      // (DejaVu Sans needs 146px); a narrow dialog shrinks the Name column.
      expect(row.style.gridTemplateColumns).toBe('minmax(0, 1fr) min(196px, 32%) 152px');
      // Three columns get a dialog wide enough to keep a name's email readable next to them.
      expect(screen.getByTestId('manage-space-modal').style.width).toBe('760px');
      expect(screen.getByTestId('space-member-table-header').style.gridTemplateColumns).toBe(
        row.style.gridTemplateColumns
      );
      // A label wider than its column is cut short instead of covering the Access menu.
      const roleTrigger = within(row).getByRole('button', { name: 'space.permissionManager.member' });

      expect(roleTrigger.className).toContain('max-w-full');
      expect(roleTrigger.className).not.toContain('w-fit');
      expect(within(roleTrigger).getByText('space.permissionManager.member').className).toContain('truncate');
    });

    it('keeps the space default separate from an explicit equal-to-default Edit and preserves role controls', async () => {
      const member = assignedMember();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      storeOverridesInRoster(member);
      await openMembersTab();
      const row = await screen.findByTestId(`space-member-row-${member.uid}`);
      const trigger = accessTrigger(member.uid);

      expect(trigger.textContent).toBe(inheritEditLabel);
      expect(within(row).getByTestId('space-member-access-control').getAttribute('data-value')).toBe('inherit');
      expect(trigger.getAttribute('aria-label')).toContain('space.memberOverride.accessFor');
      expect(trigger.getAttribute('aria-label')).toContain('Manual member');
      expect(screen.getByTestId(`space-member-access-${member.uid}-option-default`).textContent).toBe(
        'space.memberOverride.spaceDefault:{"level":"space.memberOverride.levels.canEdit"}selected'
      );
      expect(
        screen.getAllByTestId(new RegExp(`^space-member-access-${member.uid}-option-`)).map((option) => option.textContent)
      ).toEqual([
        'space.memberOverride.spaceDefault:{"level":"space.memberOverride.levels.canEdit"}selected',
        'space.memberOverride.levels.canView',
        'space.memberOverride.levels.canComment',
        'space.memberOverride.levels.canEdit',
      ]);
      expect(within(row).getByRole('button', { name: 'space.permissionManager.member' })).toBeTruthy();

      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-${AccessLevel.ReadAndWrite}`));
      await waitFor(() =>
        expect(mockSetOverride).toHaveBeenCalledWith(
          'workspace-1',
          'space-1',
          { type: 'user', uuid: memberUuid },
          AccessLevel.ReadAndWrite,
          expect.any(Function)
        )
      );
      await waitFor(() => expect(trigger.textContent).toBe('space.memberOverride.levels.canEdit'));
      await waitFor(() => expect(trigger.disabled).toBe(false));
      expect(within(row).getByTestId('space-member-access-control').getAttribute('data-value')).toBe('30');

      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-default`));
      await waitFor(() =>
        expect(mockSetOverride).toHaveBeenLastCalledWith(
          'workspace-1',
          'space-1',
          { type: 'user', uuid: memberUuid },
          null,
          expect.any(Function)
        )
      );
      await waitFor(() => expect(trigger.textContent).toBe(inheritEditLabel));
      expect(mockUpdateSpaceMember).not.toHaveBeenCalled();
      expect(mockUpdateSpaceMemberByUuid).not.toHaveBeenCalled();
    });

    it('shows the chosen access while it saves, then confirms it with a toast', async () => {
      const member = assignedMember();
      const save = deferred<SpaceMember>();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      mockSetOverride.mockReturnValue(save.promise);
      await openMembersTab();
      const row = await screen.findByTestId(`space-member-row-${member.uid}`);
      const trigger = accessTrigger(member.uid);

      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-${AccessLevel.ReadOnly}`));

      // The choice does not snap back while the request is in flight.
      await waitFor(() => expect(trigger.textContent).toBe('space.memberOverride.levels.canView'));
      expect(trigger.getAttribute('aria-busy')).toBe('true');
      expect(trigger.disabled).toBe(true);
      expect(within(row).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(
        true
      );
      // A second choice while saving is ignored.
      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-${AccessLevel.ReadAndWrite}`));
      expect(mockSetOverride).toHaveBeenCalledTimes(1);
      expect(toast.success).not.toHaveBeenCalled();

      const saved = { ...member, access_level_override: AccessLevel.ReadOnly, effective_access_level: AccessLevel.ReadOnly };

      mockGetSpaceMembers.mockResolvedValue({ members: [saved], groups: [] });
      await act(async () => {
        save.resolve(saved);
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.memberOverride.updated'));
      await waitFor(() => expect(trigger.disabled).toBe(false));
      expect(trigger.textContent).toBe('space.memberOverride.levels.canView');
      expect(trigger.getAttribute('aria-busy')).toBeNull();
      // Only this list is revalidated; the dialog is not reloaded.
      expect(mockGetSpacePermission).toHaveBeenCalledTimes(1);
      expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2);
    });

    it('shows the access the server confirmed as soon as the save returns, before the list is read again', async () => {
      const member = assignedMember();
      const saved = { ...member, access_level_override: AccessLevel.ReadOnly, effective_access_level: AccessLevel.ReadOnly };
      const rosterRead = deferred<{ members: SpaceMember[]; groups: WorkspaceGroupSpacePermission[] }>();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValueOnce({ members: [member], groups: [] }).mockReturnValueOnce(rosterRead.promise);
      mockSetOverride.mockResolvedValue(saved);
      await openMembersTab();
      const row = await screen.findByTestId(`space-member-row-${member.uid}`);
      const trigger = accessTrigger(member.uid);

      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-${AccessLevel.ReadOnly}`));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.memberOverride.updated'));
      await waitFor(() => expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2));
      // The list is still being read again, yet the row already shows the
      // stored choice rather than the old value.
      expect(trigger.getAttribute('aria-busy')).toBeNull();
      expect(trigger.textContent).toBe('space.memberOverride.levels.canView');
      expect(within(row).getByTestId('space-member-access-control').getAttribute('data-value')).toBe(
        String(AccessLevel.ReadOnly)
      );

      await act(async () => {
        rosterRead.resolve({ members: [saved], groups: [] });
      });

      await waitFor(() => expect(trigger.disabled).toBe(false));
      expect(trigger.textContent).toBe('space.memberOverride.levels.canView');
    });

    it('restores the last confirmed access after a failed save without reloading the dialog', async () => {
      const member = assignedMember();
      const save = deferred<SpaceMember>();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers
        .mockResolvedValueOnce({ members: [member], groups: [] })
        .mockRejectedValueOnce(new Error('offline'));
      mockSetOverride.mockReturnValue(save.promise);
      await openMembersTab();
      const trigger = await screen.findByTestId(`space-member-access-${member.uid}`);

      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-${AccessLevel.ReadOnly}`));
      await waitFor(() => expect(trigger.textContent).toBe('space.memberOverride.levels.canView'));

      await act(async () => {
        // Another owner removed this manager's rights while the save was in flight.
        save.reject(deniedApiError);
      });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.memberOverride.unavailable'));
      expectNoServerTextInToasts();
      await waitFor(() => expect(trigger.textContent).toBe(inheritEditLabel));
      await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
      // The roster is reconciled quietly in the background; the rows never leave the screen.
      expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId(`space-member-row-${member.uid}`)).toBeTruthy();
      expect(mockGetSpacePermission).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.success).not.toHaveBeenCalled();
      expect(mockSetOverride).toHaveBeenCalledTimes(1);
    });

    it('falls back to a plain failure message when the error has no text', async () => {
      const member = assignedMember();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      mockSetOverride.mockRejectedValue({});
      await openMembersTab();
      await screen.findByTestId(`space-member-access-${member.uid}`);

      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-${AccessLevel.ReadAndComment}`));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.memberOverride.updateFailed'));
      await waitFor(() => expect(accessTrigger(member.uid).textContent).toBe(inheritEditLabel));
    });

    it.each([
      ['a lost right', deniedApiError, 'space.memberOverride.unavailable'],
      ['a removed member', notFoundApiError, 'space.memberOverride.unavailable'],
      ['a network failure', networkApiError, 'space.memberOverride.updateFailed'],
      ['a server failure', { code: 500, httpStatus: 500, message: 'Internal error: pool timed out' }, 'space.memberOverride.updateFailed'],
      // The service's own checks already speak plainly.
      ['a stale capability', new Error('space.memberOverride.contextChanged'), 'space.memberOverride.contextChanged'],
    ])('shows plain copy instead of server text after %s', async (_case, error, expected) => {
      const member = assignedMember();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      mockSetOverride.mockRejectedValue(error);
      await openMembersTab();
      await screen.findByTestId(`space-member-access-${member.uid}`);

      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-${AccessLevel.ReadOnly}`));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expected));
      expect(toast.error).toHaveBeenCalledTimes(1);
      expectNoServerTextInToasts();
      await waitFor(() => expect(accessTrigger(member.uid).textContent).toBe(inheritEditLabel));
    });

    it('sends nothing when the current access is chosen again', async () => {
      const explicit = assignedMember({
        access_level_override: AccessLevel.ReadAndComment,
        effective_access_level: AccessLevel.ReadAndComment,
      });
      const inherited = {
        ...assignedMember(),
        uid: '6789012345678901',
        user_uuid: '22345678-1234-4123-8123-123456789abc',
        name: 'Second member',
      };

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [explicit, inherited], groups: [] });
      await openMembersTab();
      await screen.findByTestId(`space-member-access-${explicit.uid}`);

      fireEvent.click(screen.getByTestId(`space-member-access-${explicit.uid}-option-${AccessLevel.ReadAndComment}`));
      fireEvent.click(screen.getByTestId(`space-member-access-${inherited.uid}-option-default`));

      expect(mockSetOverride).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows a group with No access by default and saves its choice through the group path', async () => {
      const assigned = { ...group('group-1', 'Engineering'), access_level_override: null, effective_access_level: null };

      mockGetSpacePermission.mockResolvedValue(supportedPermission({ ...customPermission, member_default_access_level: null }));
      mockGetSpaceMembers.mockResolvedValue({ members: [], groups: [assigned] });
      mockSetOverride.mockImplementation(async (_workspace, _space, _principal, override) => {
        const updated = { ...assigned, access_level_override: override, effective_access_level: override };

        mockGetSpaceMembers.mockResolvedValue({ members: [], groups: [updated] });
        return updated;
      });
      await openMembersTab();
      const trigger = (await screen.findByTestId('space-group-access-group-1'));

      expect(trigger.textContent).toBe(
        'space.memberOverride.defaultSuffix:{"level":"space.memberOverride.levels.noAccess"}'
      );
      expect(screen.getByTestId('space-group-access-group-1-option-default').textContent).toBe(
        'space.memberOverride.spaceDefault:{"level":"space.memberOverride.levels.noAccess"}selected'
      );
      expect(screen.getByTestId('manage-space-members-no-access-hint').textContent).toBe(
        'space.memberOverride.inheritedNoAccess'
      );

      fireEvent.click(screen.getByTestId(`space-group-access-group-1-option-${AccessLevel.ReadAndComment}`));
      await waitFor(() =>
        expect(mockSetOverride).toHaveBeenCalledWith(
          'workspace-1',
          'space-1',
          { type: 'group', uuid: 'group-1' },
          AccessLevel.ReadAndComment,
          expect.any(Function)
        )
      );
      await waitFor(() => expect(trigger.textContent).toBe('space.memberOverride.levels.canComment'));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.memberOverride.updated'));
      expect(mockUpdateSpaceGroupPermission).not.toHaveBeenCalled();
    });

    it('keeps the Name | Role table and no Access column on servers without per-person access', async () => {
      const member = manualMember();

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      await openMembersTab();
      await screen.findByTestId(`space-member-row-${member.uid}`);

      expect(screen.getByTestId('space-member-table-header').children).toHaveLength(2);
      expect(screen.queryByTestId('space-member-access-header')).toBeNull();
      expect(screen.queryByTestId('space-member-access-control')).toBeNull();
      expect(screen.queryByTestId('space-member-access-fixed')).toBeNull();
      // Old servers stay usable: no message about what the server lacks (the
      // General tab still names access levels).
      expect(screen.queryByText(/space\.memberOverride\.(?!levels\.)/)).toBeNull();
      expect(mockSetOverride).not.toHaveBeenCalled();
    });

    it('explains rows whose access cannot be changed and never offers Full access', async () => {
      const editable = assignedMember();
      const withoutUuid: SpaceMember = {
        ...manualMember(),
        uid: '7890123456789012',
        name: 'No identity',
        access_level_override: null,
        effective_access_level: AccessLevel.ReadAndWrite,
      };
      const owner = {
        ...creatorMember(),
        user_uuid: '32345678-1234-4123-8123-123456789abc',
        access_level_override: null,
        effective_access_level: AccessLevel.FullAccess,
      };
      const shared = {
        ...pageShareMember(),
        user_uuid: '42345678-1234-4123-8123-123456789abc',
        access_level_override: null,
        effective_access_level: AccessLevel.ReadAndWrite,
      };
      const ownerGroup = {
        ...group('group-owners', 'Leads', SpaceMemberRole.Owner),
        access_level_override: null,
        effective_access_level: AccessLevel.FullAccess,
      };

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [owner, editable, withoutUuid, shared], groups: [ownerGroup] });
      await openMembersTab();
      const editableRow = await screen.findByTestId(`space-member-row-${editable.uid}`);
      const withoutUuidRow = screen.getByTestId(`space-member-row-${withoutUuid.uid}`);
      const ownerRow = screen.getByTestId(`space-member-row-${owner.uid}`);
      const sharedRow = screen.getByTestId(`space-member-row-${shared.uid}`);
      const ownerGroupRow = screen.getByTestId('space-group-row-group-owners');

      expect(within(editableRow).getByTestId(`space-member-access-${editable.uid}`)).toBeTruthy();
      expect(screen.queryAllByTestId(new RegExp(`^space-(member|group)-access-.*-option-${AccessLevel.FullAccess}$`))).toHaveLength(0);
      expect(screen.getAllByTestId(new RegExp(`^space-(member|group)-access-.*-option-`))).toHaveLength(4);

      // Owners have full access as plain text.
      expect(within(ownerRow).getByTestId('space-member-access-fixed').textContent).toBe(
        'space.memberOverride.levels.fullAccess'
      );
      expect(within(ownerRow).queryByRole('tooltip')).toBeNull();
      expect(within(ownerGroupRow).getByTestId('space-member-access-fixed').textContent).toBe(
        'space.memberOverride.levels.fullAccess'
      );

      // A row without its account identity explains how to recover instead of a silent disabled control.
      expect(screen.queryByTestId(`space-member-access-${withoutUuid.uid}`)).toBeNull();
      const unavailable = within(withoutUuidRow).getByTestId('space-member-access-control');

      expect(unavailable.getAttribute('data-value')).toBe('inherit');
      expect(unavailable.textContent).toContain(inheritEditLabel);
      expect(within(unavailable).getByRole('tooltip').textContent).toBe('space.memberOverride.identityUnavailable');

      // People who only have shared pages are not given a space level.
      const sharedAccess = within(sharedRow).getByTestId('space-member-access-fixed');

      expect(sharedAccess.textContent).toContain('space.memberOverride.sharedPagesOnly');
      expect(within(sharedAccess).getByRole('tooltip').textContent).toBe('space.memberOverride.sharedPagesReason');
      expect(within(sharedRow).getAllByText('space.memberOverride.sharedPagesReason')).toHaveLength(2);
    });

    it('keeps the member table on screen while a permission notification is rechecked', async () => {
      const member = assignedMember();
      const recheck = deferred<ReturnType<typeof supportedPermission>>();

      mockGetSpacePermission.mockResolvedValueOnce(supportedPermission()).mockReturnValueOnce(recheck.promise);
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      await openMembersTab();
      const trigger = (await screen.findByTestId(`space-member-access-${member.uid}`));

      await waitFor(() => expect(trigger.disabled).toBe(false));
      act(() => {
        // The server sends this to everyone, including after the user's own change.
        mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space-1' });
      });
      await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));

      expect(screen.getByTestId(`space-member-row-${member.uid}`)).toBeTruthy();
      expect(trigger.textContent).toBe(inheritEditLabel);
      expect(trigger.disabled).toBe(true);
      expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false);

      await act(async () => {
        recheck.resolve(supportedPermission());
      });

      await waitFor(() => expect(trigger.disabled).toBe(false));
      expect(mockGetSpaceMembers).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId(`space-member-row-${member.uid}`)).toBeTruthy();
    });

    it('still confirms a save whose permission notification arrives before the response', async () => {
      const member = assignedMember();
      const save = deferred<SpaceMember>();

      mockGetSpacePermission.mockResolvedValue(supportedPermission());
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      mockSetOverride.mockReturnValue(save.promise);
      await openMembersTab();
      const trigger = (await screen.findByTestId(`space-member-access-${member.uid}`));

      fireEvent.click(screen.getByTestId(`space-member-access-${member.uid}-option-${AccessLevel.ReadOnly}`));
      await waitFor(() => expect(mockSetOverride).toHaveBeenCalledTimes(1));

      const saved = { ...member, access_level_override: AccessLevel.ReadOnly, effective_access_level: AccessLevel.ReadOnly };

      mockGetSpaceMembers.mockResolvedValue({ members: [saved], groups: [] });
      act(() => {
        mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space-1' });
      });
      await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
      await act(async () => {
        save.resolve(saved);
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.memberOverride.updated'));
      await waitFor(() => expect(trigger.disabled).toBe(false));
      expect(trigger.textContent).toBe('space.memberOverride.levels.canView');
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('member and group changes on servers with per-person access', () => {
    const memberUuid = '52345678-1234-4123-8123-123456789abc';
    const candidateUuid = '62345678-1234-4123-8123-123456789abc';

    beforeEach(() => {
      mockGetSpacePermission.mockResolvedValue({
        ...permissionResponse({ permission: customPermission }),
        member_access_overrides_supported: true,
      });
    });

    it('adds a workspace member by UUID so the new member keeps the space default', async () => {
      mockGetMembers.mockResolvedValue([{ ...workspaceCandidate, user_uuid: candidateUuid }]);
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(screen.getByTestId('inline-member-add').disabled).toBe(false));
      fireEvent.click(screen.getByTestId('inline-member-add'));

      await waitFor(() => expect(mockAddSpaceMemberByUuid).toHaveBeenCalledTimes(1));
      // No access is chosen for them, and the Custom space ignores the level. Can view, not the
      // space's Can edit, is sent: if the space became Public without this dialog noticing, the
      // server stores the level sent, and Public spaces already give every member their level.
      expect(mockAddSpaceMemberByUuid.mock.calls[0]).toStrictEqual([
        'workspace-1',
        'space-1',
        candidateUuid,
        { role: SpaceMemberRole.Member, access_level: AccessLevel.ReadOnly },
      ]);
      expect(mockAddSpaceMember).not.toHaveBeenCalled();
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.permissionManager.addSpaceMemberSuccess'));
    });

    it('adds people and groups to a space type it does not know at the space member level, never the server default', async () => {
      // Outside Custom spaces the server stores the level sent with the add; a missing one would
      // become Can edit even though this space's members only view.
      const unknownTypePermission: SpacePermissionSettings = {
        ...customPermission,
        visibility: 'restricted' as SpaceVisibility,
        member_default_access_level: AccessLevel.ReadOnly,
        everyone_else_access_level: null,
      };

      mockGetSpacePermission.mockResolvedValue({
        ...permissionResponse({ permission: unknownTypePermission }),
        member_access_overrides_supported: true,
      });
      mockGetMembers.mockResolvedValue([{ ...workspaceCandidate, user_uuid: candidateUuid }]);
      mockAddSpaceGroupPermission.mockResolvedValue({
        ...group('group-engineering', 'Engineering'),
        access_level_override: null,
        effective_access_level: AccessLevel.ReadOnly,
      });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(screen.getByTestId('inline-member-add').disabled).toBe(false));
      fireEvent.click(screen.getByTestId('inline-member-add'));
      await waitFor(() => expect(mockAddSpaceMemberByUuid).toHaveBeenCalledTimes(1));
      expect(mockAddSpaceMemberByUuid.mock.calls[0]).toEqual([
        'workspace-1',
        'space-1',
        candidateUuid,
        { role: SpaceMemberRole.Member, access_level: AccessLevel.ReadOnly },
      ]);

      await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1'));
      fireEvent.change(screen.getByTestId('inline-member-search'), { target: { value: 'engin' } });
      fireEvent.click(
        within(await screen.findByTestId('space-group-inline-search-result-group-engineering')).getByTestId(
          'space-group-inline-search-result-add'
        )
      );
      await waitFor(() => expect(mockAddSpaceGroupPermission).toHaveBeenCalledTimes(1));
      expect(mockAddSpaceGroupPermission.mock.calls[0]).toEqual([
        'workspace-1',
        'space-1',
        'group-engineering',
        { role: SpaceMemberRole.Member, access_level: AccessLevel.ReadOnly },
      ]);
    });

    it('refuses to add a candidate without a UUID instead of using the legacy route', async () => {
      mockGetMembers.mockResolvedValue([workspaceCandidate]);
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(screen.getByTestId('inline-member-add').disabled).toBe(false));
      fireEvent.click(screen.getByTestId('inline-member-add'));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.memberOverride.identityUnavailable'));
      expect(mockAddSpaceMemberByUuid).not.toHaveBeenCalled();
      expect(mockAddSpaceMember).not.toHaveBeenCalled();
    });

    it('changes a role and removes a member by UUID without sending an access level', async () => {
      const member: SpaceMember = {
        ...manualMember(),
        user_uuid: memberUuid,
        access_level_override: AccessLevel.ReadAndComment,
        effective_access_level: AccessLevel.ReadAndComment,
      };

      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const row = await screen.findByTestId(`space-member-row-${member.uid}`);

      // The role menu describes how a Space member's access is decided here.
      expect(
        within(row).getByRole('button', { name: /^space\.permissionManager\.member space\.permissionManager\.memberRoleWithAccessDescription/ })
      ).toBeTruthy();
      await waitFor(() =>
        expect(within(row).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(
          false
        )
      );
      fireEvent.click(
        within(row).getByRole('button', {
          name: 'space.permissionManager.owner space.permissionManager.ownerRoleDescription',
        })
      );

      await waitFor(() =>
        expect(mockUpdateSpaceMemberByUuid).toHaveBeenCalledWith('workspace-1', 'space-1', memberUuid, {
          role: SpaceMemberRole.Owner,
        })
      );
      expect(mockUpdateSpaceMember).not.toHaveBeenCalled();
      expect(mockAddSpaceMemberByUuid).not.toHaveBeenCalled();

      const removeButton = within(row).getByRole('button', { name: 'space.permissionManager.remove' });

      await waitFor(() => expect(removeButton.hasAttribute('disabled')).toBe(false));
      fireEvent.click(removeButton);

      await waitFor(() => expect(mockRemoveSpaceMemberByUuid).toHaveBeenCalledWith('workspace-1', 'space-1', memberUuid));
      expect(mockRemoveSpaceMember).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('space.permissionManager.removeSpaceMemberSuccess')
      );
    });

    it('reports a missing member UUID on role change and removal without calling the server', async () => {
      const member: SpaceMember = { ...manualMember(), access_level_override: null, effective_access_level: 30 };

      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const row = await screen.findByTestId(`space-member-row-${member.uid}`);

      await waitFor(() =>
        expect(within(row).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(
          false
        )
      );
      fireEvent.click(
        within(row).getByRole('button', {
          name: 'space.permissionManager.owner space.permissionManager.ownerRoleDescription',
        })
      );
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.memberOverride.identityUnavailable'));

      const removeButton = within(row).getByRole('button', { name: 'space.permissionManager.remove' });

      await waitFor(() => expect(removeButton.hasAttribute('disabled')).toBe(false));
      fireEvent.click(removeButton);
      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
      expect(mockUpdateSpaceMemberByUuid).not.toHaveBeenCalled();
      expect(mockAddSpaceMemberByUuid).not.toHaveBeenCalled();
      expect(mockRemoveSpaceMemberByUuid).not.toHaveBeenCalled();
      expect(mockUpdateSpaceMember).not.toHaveBeenCalled();
      expect(mockRemoveSpaceMember).not.toHaveBeenCalled();
    });

    it('adds groups at Can view and promotes them without choosing an access level', async () => {
      const memberGroup = { ...group('group-1', 'Design'), access_level_override: null, effective_access_level: 30 };
      const grantedGroup = { ...group('group-engineering', 'Engineering'), access_level_override: null, effective_access_level: 30 };

      mockGetSpaceMembers
        .mockResolvedValueOnce({ members: [], groups: [memberGroup] })
        .mockResolvedValue({ members: [], groups: [memberGroup, grantedGroup] });
      mockAddSpaceGroupPermission.mockResolvedValue(grantedGroup);
      mockUpdateSpaceGroupPermission.mockResolvedValue({ ...memberGroup, role: SpaceMemberRole.Owner });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));
      await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1'));
      fireEvent.change(screen.getByTestId('inline-member-search'), { target: { value: 'engin' } });
      fireEvent.click(
        within(await screen.findByTestId('space-group-inline-search-result-group-engineering')).getByTestId(
          'space-group-inline-search-result-add'
        )
      );

      await waitFor(() => expect(mockAddSpaceGroupPermission).toHaveBeenCalledTimes(1));
      // As for people: the Custom space ignores the level, which only guards a missed type switch.
      expect(mockAddSpaceGroupPermission.mock.calls[0]).toStrictEqual([
        'workspace-1',
        'space-1',
        'group-engineering',
        { role: SpaceMemberRole.Member, access_level: AccessLevel.ReadOnly },
      ]);

      const row = await screen.findByTestId('space-group-row-group-1');

      await waitFor(() =>
        expect(within(row).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(
          false
        )
      );
      fireEvent.click(
        within(row).getByRole('button', {
          name: 'space.permissionManager.owner space.permissionManager.ownerRoleDescription',
        })
      );
      confirmPending();

      await waitFor(() => expect(mockUpdateSpaceGroupPermission).toHaveBeenCalledTimes(1));
      expect(mockUpdateSpaceGroupPermission.mock.calls[0]).toEqual([
        'workspace-1',
        'space-1',
        'group-1',
        { role: SpaceMemberRole.Owner },
      ]);
    });
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
      expect(screen.getByTestId('manage-space-custom-members-access').textContent).toContain('space.memberOverride.levels.canEdit');
      expect(screen.getByTestId('manage-space-everyone-else-access').textContent).toContain('space.memberOverride.levels.canView');

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
        'space.memberOverride.levels.noAccess'
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
      expect(screen.getByTestId('manage-space-workspace-owners-row').textContent).toContain('space.memberOverride.levels.fullAccess');
      expect(screen.getByTestId('manage-space-workspace-members-row').textContent).toContain(
        'space.permissionManager.workspaceMembersDescription'
      );
      expect(screen.getByTestId('manage-space-switch-to-custom-banner').textContent).toContain(
        'space.permissionManager.switchToCustomDescription'
      );
      // Full access / Can edit / Can view, no "No access" on a public space.
      expect(
        screen.getAllByTestId(/^manage-space-workspace-members-access-option-/).map((el) => el.textContent)
      ).toEqual(['space.memberOverride.levels.fullAccess', 'space.memberOverride.levels.canEditselected', 'space.memberOverride.levels.canView']);

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
      expect(screen.getByTestId('manage-space-workspace-members-access').textContent).toContain('space.memberOverride.levels.canEdit');
      confirmPending();
      expect(screen.getByTestId('manage-space-workspace-members-access').textContent).toContain(
        'space.memberOverride.levels.fullAccess'
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
      expect(screen.getByTestId('manage-space-custom-owners-row').textContent).toContain('space.memberOverride.levels.fullAccess');
      expect(screen.getByTestId('manage-space-custom-members-row').textContent).toContain(
        'space.permissionManager.customMembersDescription'
      );
      expect(screen.getByTestId('manage-space-everyone-else-row').textContent).toContain(
        'space.permissionManager.everyoneElse:{"workspace":"Acme"}'
      );
      expect(screen.getByTestId('manage-space-everyone-else-row').textContent).toContain(
        'space.permissionManager.everyoneElseDescription'
      );
      // Every level (PRD §17/§39, including Can comment) plus No access, for
      // both audiences, named as in the Members tab and on Desktop.
      expect(screen.getAllByTestId(/^manage-space-custom-members-access-option-/).map((el) => el.textContent)).toEqual([
        'space.memberOverride.levels.fullAccess',
        'space.memberOverride.levels.canEditselected',
        'space.memberOverride.levels.canComment',
        'space.memberOverride.levels.canView',
        'space.memberOverride.levels.noAccess',
      ]);
      expect(screen.getAllByTestId(/^manage-space-everyone-else-access-option-/).map((el) => el.textContent)).toEqual([
        'space.memberOverride.levels.fullAccess',
        'space.memberOverride.levels.canEdit',
        'space.memberOverride.levels.canComment',
        'space.memberOverride.levels.canViewselected',
        'space.memberOverride.levels.noAccess',
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
      expect(screen.getByTestId('manage-space-custom-members-access').textContent).toContain('space.memberOverride.levels.canEdit');

      fireEvent.click(screen.getByTestId(`manage-space-everyone-else-access-option-${AccessLevel.FullAccess}`));
      expect(confirmDialog().textContent).toContain('space.permissionManager.fullAccessEveryoneElseTitle');
      expect(confirmDialog().textContent).toContain('space.permissionManager.fullAccessEveryoneElseDescription');
      expect(screen.getByTestId('manage-space-confirm-ok').textContent).toBe('space.permissionManager.grantFullAccess');
      confirmPending();
      expect(screen.getByTestId('manage-space-everyone-else-access').textContent).toContain('space.memberOverride.levels.fullAccess');

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
      expect(screen.getByTestId('manage-space-everyone-else-access').textContent).toContain('space.memberOverride.levels.canView');
      fireEvent.click(screen.getByTestId(`manage-space-custom-members-access-option-${AccessLevel.ReadOnly}`));

      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(structuredUpdatePermission()).toEqual({
        ...customPermission,
        member_default_access_level: AccessLevel.ReadOnly,
        everyone_else_access_level: AccessLevel.ReadOnly,
      });
    });
  });

  it('says which space it manages, in a sentence-case title', async () => {
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();
    const title = screen.getByTestId('manage-space-modal-title');

    expect(within(title).getByText('space.manageSpace')).toBeTruthy();
    expect(within(title).getByText('Space one')).toBeTruthy();
    // A name being typed in General is not the space's name until it is saved.
    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Renamed' } });
    expect(within(title).getByText('Space one')).toBeTruthy();
    expect(within(title).queryByText('Renamed')).toBeNull();
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

  it('preserves a loaded sidebar policy on open/rename and changes it only through its selector', async () => {
    const permission = { ...privatePermission, visibility: SpaceVisibility.Custom, sidebar_edit_policy: SpaceSidebarEditPolicy.MembersAndOwners };

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission }));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();
    const trigger = screen.getByTestId('space-sidebar-policy');
    const row = screen.getByTestId('space-sidebar-policy-row');

    expect(trigger.textContent).toBe('workspacePermissions.sidebarMembers');
    expect(row.textContent).toContain('workspacePermissions.sidebarPolicy');
    expect(row.textContent).toContain('workspacePermissions.sidebarExplanation');
    expect(document.querySelector('select')).toBeNull();
    expect(
      screen.getAllByTestId(/^space-sidebar-policy-option-/).map((option) => option.textContent)
    ).toEqual(['workspacePermissions.sidebarOwners', 'workspacePermissions.sidebarMembersselected']);
    expect(mockUpdateStructuredSpace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), { target: { value: 'Rename only' } });
    fireEvent.blur(screen.getByPlaceholderText('space.spaceNamePlaceholder'));
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', { name: 'Rename only' }));
    await waitFor(() => expect(trigger.disabled).toBe(false));
    // Choosing the policy that is already set sends nothing.
    fireEvent.click(screen.getByTestId(`space-sidebar-policy-option-${SpaceSidebarEditPolicy.MembersAndOwners}`));
    expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId(`space-sidebar-policy-option-${SpaceSidebarEditPolicy.OwnersOnly}`));
    expect(trigger.textContent).toBe('workspacePermissions.sidebarOwners');
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledWith('workspace-1', 'space-1', {
      permission: { ...permission, sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly },
    }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.success.updateSpace'));
  });

  it('confirms a sidebar policy change whose permission notification arrives before the response', async () => {
    const permission = { ...customPermission, sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly };
    const saved = { ...permission, sidebar_edit_policy: SpaceSidebarEditPolicy.MembersAndOwners };
    const save = deferred<{ view_id: string }>();

    mockGetSpacePermission
      .mockResolvedValueOnce(permissionResponse({ permission }))
      .mockResolvedValue(permissionResponse({ permission: saved }));
    mockUpdateStructuredSpace.mockReturnValueOnce(save.promise);
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();

    fireEvent.click(screen.getByTestId(`space-sidebar-policy-option-${SpaceSidebarEditPolicy.MembersAndOwners}`));
    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space-1' });
    });
    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    await act(async () => {
      save.resolve({ view_id: 'space-1' });
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('space.success.updateSpace'));
    expect(screen.getByTestId('space-sidebar-policy').textContent).toBe('workspacePermissions.sidebarMembers');
    await waitFor(() => expect(screen.getByTestId('space-sidebar-policy').disabled).toBe(false));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('restores the confirmed sidebar policy when saving it fails', async () => {
    const permission = { ...customPermission, sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly };

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission }));
    mockUpdateStructuredSpace.mockRejectedValueOnce(new Error('policy save failed'));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();

    fireEvent.click(screen.getByTestId(`space-sidebar-policy-option-${SpaceSidebarEditPolicy.MembersAndOwners}`));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('policy save failed'));
    expect(screen.getByTestId('space-sidebar-policy').textContent).toBe('workspacePermissions.sidebarOwners');
    await waitFor(() => expect((screen.getByTestId('space-sidebar-policy')).disabled).toBe(false));
  });

  it('shows plain copy when the server rejects a settings save', async () => {
    const permission = { ...customPermission, sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly };

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission }));
    mockUpdateStructuredSpace.mockRejectedValueOnce({
      ...deniedApiError,
      message: `user 42 cannot update policy for space ${SPACE_UUID}`,
    });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();

    fireEvent.click(screen.getByTestId(`space-sidebar-policy-option-${SpaceSidebarEditPolicy.MembersAndOwners}`));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.error.updateSpace'));
    expectNoServerTextInToasts();
    expect(screen.getByTestId('space-sidebar-policy').textContent).toBe('workspacePermissions.sidebarOwners');
  });

  it('shows plain copy when the settings or the member list cannot be loaded', async () => {
    mockGetSpacePermission.mockRejectedValueOnce({ ...deniedApiError, message: `user 42 cannot read space ${SPACE_UUID}` });
    const { unmount } = render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.permissionManager.loadSpaceSettingsFailed'));
    unmount();

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
    mockGetSpaceMembers.mockRejectedValueOnce({ ...deniedApiError, message: `user 42 cannot list members for space ${SPACE_UUID}` });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.permissionManager.loadSpaceMembersFailed'));
    expectNoServerTextInToasts();
  });

  // A permission notification can arrive while a save is in flight, e.g. the
  // concurrent demotion that also makes the save fail. The rejection must
  // still be reported, and the rejected value must never stay on screen.
  describe('when a permission notification arrives while a settings save is in flight', () => {
    const permission = { ...customPermission, sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly };

    function policyTrigger() {
      return screen.getByTestId('space-sidebar-policy');
    }

    async function chooseAnyoneWhoCanEdit() {
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
      await waitForSettingsLoaded();
      fireEvent.click(screen.getByTestId(`space-sidebar-policy-option-${SpaceSidebarEditPolicy.MembersAndOwners}`));
      await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
      expect(policyTrigger().textContent).toBe('workspacePermissions.sidebarMembers');
      act(() => {
        mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'unrelated-change' });
      });
      await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    }

    it('reports the failure after the recheck has shown the server settings', async () => {
      const save = deferred<{ view_id: string }>();

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission }));
      mockUpdateStructuredSpace.mockReturnValueOnce(save.promise);
      await chooseAnyoneWhoCanEdit();
      // The recheck reads the server's settings, which never included the change.
      await waitFor(() => expect(policyTrigger().textContent).toBe('workspacePermissions.sidebarOwners'));

      await act(async () => {
        save.reject(new Error('policy save failed'));
      });

      expect(toast.error).toHaveBeenCalledWith('policy save failed');
      expect(toast.success).not.toHaveBeenCalled();
      expect(policyTrigger().textContent).toBe('workspacePermissions.sidebarOwners');
      await waitFor(() => expect(policyTrigger().disabled).toBe(false));
    });

    it('restores the last confirmed value while the recheck is still running', async () => {
      const save = deferred<{ view_id: string }>();
      const recheck = deferred<ReturnType<typeof permissionResponse>>();

      mockGetSpacePermission
        .mockResolvedValueOnce(permissionResponse({ permission }))
        .mockReturnValueOnce(recheck.promise);
      mockUpdateStructuredSpace.mockReturnValueOnce(save.promise);
      await chooseAnyoneWhoCanEdit();

      await act(async () => {
        save.reject(new Error('policy save failed'));
      });

      expect(toast.error).toHaveBeenCalledWith('policy save failed');
      expect(policyTrigger().textContent).toBe('workspacePermissions.sidebarOwners');

      await act(async () => {
        recheck.resolve(permissionResponse({ permission }));
      });

      expect(policyTrigger().textContent).toBe('workspacePermissions.sidebarOwners');
      await waitFor(() => expect(policyTrigger().disabled).toBe(false));
    });

    it('never leaves a rejected value on screen when the recheck fails too', async () => {
      const save = deferred<{ view_id: string }>();

      mockGetSpacePermission
        .mockResolvedValueOnce(permissionResponse({ permission }))
        .mockRejectedValueOnce(new Error('recheck failed'));
      mockUpdateStructuredSpace.mockReturnValueOnce(save.promise);
      await chooseAnyoneWhoCanEdit();
      // The failed recheck blocks every change until access is confirmed again.
      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

      await act(async () => {
        save.reject(new Error('policy save failed'));
      });

      expect(toast.error).toHaveBeenCalledWith('policy save failed');
      expect(policyTrigger().textContent).toBe('workspacePermissions.sidebarOwners');
      expect(policyTrigger().disabled).toBe(true);
    });
  });

  it('shows a sidebar policy from a newer server neutrally and keeps it in unrelated saves', async () => {
    const permission = {
      ...customPermission,
      sidebar_edit_policy: 'editors_and_owners' as SpaceSidebarEditPolicy,
    };

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission }));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();

    expect(screen.getByTestId('space-sidebar-policy').textContent).toBe('workspacePermissions.sidebarUnknown');
    // Neither known option is ticked for a value this client does not know.
    expect(screen.getAllByTestId(/^space-sidebar-policy-option-/).map((option) => option.textContent)).toEqual([
      'workspacePermissions.sidebarOwners',
      'workspacePermissions.sidebarMembers',
    ]);
    fireEvent.click(screen.getByTestId(`manage-space-custom-members-access-option-${AccessLevel.ReadOnly}`));

    await waitFor(() => expect(mockUpdateStructuredSpace).toHaveBeenCalledTimes(1));
    expect(structuredUpdatePermission().sidebar_edit_policy).toBe('editors_and_owners');
  });

  // The server lets space members with edit access add pages: people and groups added to a
  // Custom space, every workspace member (not guests) in a Public space.
  it.each([
    ['Custom', SpaceVisibility.Custom, 'workspacePermissions.sidebarMembers'],
    ['Public', SpaceVisibility.Public, 'workspacePermissions.sidebarWorkspaceMembers'],
    ['newer-server', 'invite_only' as SpaceVisibility, 'workspacePermissions.sidebarMembers'],
  ])('names the people who can add pages to a %s space by who its members are', async (_case, visibility, label) => {
    const permission = {
      ...customPermission,
      visibility,
      sidebar_edit_policy: SpaceSidebarEditPolicy.MembersAndOwners,
    };

    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission }));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();

    expect(screen.getByTestId('space-sidebar-policy').textContent).toBe(label);
    expect(screen.getAllByTestId(/^space-sidebar-policy-option-/).map((option) => option.textContent)).toEqual([
      'workspacePermissions.sidebarOwners',
      `${label}selected`,
    ]);
    expect(screen.getByTestId('space-sidebar-policy-row').textContent).toContain(
      'workspacePermissions.sidebarExplanation'
    );
  });

  it('has no page setting for a private space, where only its owner adds pages', async () => {
    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: privatePermission }));
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);
    await waitForSettingsLoaded();

    expect(screen.queryByTestId('space-sidebar-policy-row')).toBeNull();
    expect(screen.queryByTestId('space-sidebar-policy')).toBeNull();
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

  it('revalidates live permissions and member groups in the background, then fails closed after sidebar access is revoked', async () => {
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

    const initialRow = await screen.findByTestId('space-group-row-group-1');

    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false);
    await waitFor(() =>
      expect(within(initialRow).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(
        false
      )
    );

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
    // While authority is rechecked the last confirmed roster stays visible but
    // cannot be changed, and the name being typed is not interrupted.
    expect(screen.getByTestId('space-group-row-group-1')).toBeTruthy();
    expect(within(initialRow).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(
      true
    );
    expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false);

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

  describe('when access to the dialog cannot be confirmed', () => {
    function permissionNotice() {
      return screen.getByTestId('manage-space-permission-notice');
    }

    function checkAgain() {
      fireEvent.click(within(permissionNotice()).getByRole('button', { name: 'space.permissionManager.checkAgain' }));
    }

    it('keeps the last confirmed settings, says why changes are paused, and checks again on request', async () => {
      const member = manualMember();
      const retry = deferred<ReturnType<typeof permissionResponse>>();

      mockGetSpacePermission
        .mockResolvedValueOnce(permissionResponse({ permission: customPermission }))
        .mockRejectedValueOnce(networkApiError)
        .mockReturnValueOnce(retry.promise);
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const row = await screen.findByTestId(`space-member-row-${member.uid}`);

      await waitForSettingsLoaded();
      expect(screen.queryByTestId('manage-space-permission-notice')).toBeNull();
      act(() => {
        mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('space.permissionManager.loadSpaceSettingsFailed'));
      // A failure worth retrying keeps the confirmed data on screen but blocks changes...
      expect(screen.getByTestId(`space-member-row-${member.uid}`)).toBe(row);
      expectSelectedVisibility(SpaceVisibility.Custom);
      expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(true);
      expect(within(row).getByRole('button', { name: 'space.permissionManager.member' }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
      expect(mockGetSpaceMembers).toHaveBeenCalledTimes(1);
      // ...and the dialog keeps saying why after the toast is gone.
      expect(permissionNotice().textContent).toContain('space.permissionManager.accessCheckFailed');

      checkAgain();
      await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(3));
      // The confirmed data stays on screen while access is checked again.
      expect(screen.getByTestId(`space-member-row-${member.uid}`)).toBe(row);
      expect(within(permissionNotice()).getByRole('button', { name: 'space.permissionManager.checkAgain' }).disabled).toBe(
        true
      );

      await act(async () => {
        retry.resolve(permissionResponse({ permission: customPermission }));
      });

      await waitFor(() => expect(screen.queryByTestId('manage-space-permission-notice')).toBeNull());
      await waitFor(() => expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(false));
      expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(false);
      expect(screen.getByTestId(`space-member-row-${member.uid}`)).toBeTruthy();
    });

    it('clears other people from the dialog when a recheck finds that access was removed', async () => {
      const member = manualMember();

      mockGetSpacePermission
        .mockResolvedValueOnce(permissionResponse({ permission: customPermission }))
        .mockRejectedValueOnce({ ...deniedApiError, message: `user 42 cannot read space ${SPACE_UUID}` })
        .mockResolvedValueOnce(permissionResponse({ permission: customPermission }));
      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [group('group-1', 'Finance')] });
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await screen.findByTestId(`space-member-row-${member.uid}`);
      await waitForSettingsLoaded();
      act(() => {
        mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      });

      await waitFor(() => expect(screen.queryByTestId(`space-member-row-${member.uid}`)).toBeNull());
      // Nobody's name or email stays visible to someone who lost access.
      expect(screen.queryByText('Manual member')).toBeNull();
      expect(screen.queryByText(/manual-member@appflowy\.io/)).toBeNull();
      expect(screen.queryByTestId('space-group-row-group-1')).toBeNull();
      expect(permissionNotice().textContent).toContain('space.permissionManager.accessLost');
      expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(true);
      expect(screen.getByPlaceholderText('space.spaceNamePlaceholder').hasAttribute('disabled')).toBe(true);
      expectNoServerTextInToasts();

      // Access given back: checking again loads the dialog from the server.
      checkAgain();
      await screen.findByTestId(`space-member-row-${member.uid}`);
      expect(screen.queryByTestId('manage-space-permission-notice')).toBeNull();
      await waitForSettingsLoaded();
    });

    it('explains a failed first load and loads the dialog when checked again', async () => {
      mockGetSpacePermission
        .mockRejectedValueOnce(networkApiError)
        .mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(permissionNotice().textContent).toContain('space.permissionManager.accessCheckFailed'));
      expect(visibilityOption(SpaceVisibility.Public).disabled).toBe(true);

      checkAgain();

      await waitForSettingsLoaded();
      expect(screen.queryByTestId('manage-space-permission-notice')).toBeNull();
      expect(mockGetSpacePermission).toHaveBeenCalledTimes(2);
    });
  });

  it('shows groups with the group icon used everywhere else, not a letter like a person', async () => {
    mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
    mockGetSpaceMembers.mockResolvedValue({ members: [creatorMember()], groups: [group('group-hr', 'HR')] });
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    const row = await screen.findByTestId('space-group-row-group-hr');

    expect(within(row).getByTestId('workspace-group-icon-settings-row')).toBeTruthy();
    expect(within(row).queryByText('H')).toBeNull();

    fireEvent.change(screen.getByTestId('inline-member-search'), { target: { value: 'Eng' } });
    const addable = await screen.findByTestId('space-group-inline-search-result-group-engineering');

    expect(within(addable).getByTestId('workspace-group-icon-settings-row')).toBeTruthy();
    expect(within(addable).queryByText('E')).toBeNull();
  });

  it('drops people and groups to add when a background recheck withdraws the right to add them', async () => {
    mockGetSpacePermission
      .mockResolvedValueOnce(permissionResponse({ permission: customPermission }))
      .mockResolvedValueOnce(
        permissionResponse({ permission: customPermission, canManageMembers: false, canInviteMembers: false })
      );
    render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

    await waitForSettingsLoaded();
    fireEvent.change(screen.getByTestId('inline-member-search'), { target: { value: 'Eng' } });
    await screen.findByTestId(`inline-member-result-${workspaceCandidate.uid}`);
    expect(screen.getByTestId('space-group-inline-search-result-group-engineering')).toBeTruthy();

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space-1' });
    });
    await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(screen.queryByTestId(`inline-member-result-${workspaceCandidate.uid}`)).toBeNull());
    expect(screen.queryByTestId('space-group-inline-search-result-group-engineering')).toBeNull();
    // Nothing is fetched for adding what this user can no longer add.
    expect(mockGetMembers).toHaveBeenCalledTimes(1);
    expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(1);
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

  it('keeps an authoritative permission refresh but still reports an older mutation that later fails', async () => {
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

    // The refreshed settings are newer than the failed request's baseline, so
    // they stay; the owner is still told their change did not go through.
    expectSelectedVisibility(SpaceVisibility.Public);
    expect(toast.error).toHaveBeenCalledWith('older mutation failed');
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
      expect(within(memberRow).queryByText('space.memberOverride.levels.canEdit')).toBeNull();
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
      // The trigger hugs its label but never grows past its column.
      const roleTriggerClasses = roleTrigger.className.split(/\s+/);

      expect(roleTriggerClasses).toContain('max-w-full');
      expect(roleTriggerClasses.filter((name) => name === 'w-full' || name.startsWith('min-w-['))).toEqual([]);
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

    it.each([
      ['a lost right', deniedApiError, 'space.permissionManager.updateSpaceMemberFailed'],
      [
        'the last owner rule',
        { code: 1008, httpStatus: 400, message: 'Invalid request:space must keep at least one explicit owner' },
        'space.permissionManager.lastOwnerRequired',
      ],
    ])('explains a rejected role change after %s without server text', async (_case, error, expected) => {
      const member = creatorMember();

      mockGetSpaceMembers.mockResolvedValue({ members: [member], groups: [] });
      mockUpdateSpaceMember.mockRejectedValueOnce(error);
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      const row = await screen.findByTestId(`space-member-row-${member.uid}`);

      fireEvent.click(
        within(row).getByRole('button', {
          name: 'space.permissionManager.member space.permissionManager.memberRoleDescription',
        })
      );

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expected));
      expectNoServerTextInToasts();
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

    it('lists people and groups to add as soon as Add people or groups is pressed', async () => {
      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

      await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));
      await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1'));
      expect(screen.queryByTestId('space-group-inline-search-result-group-engineering')).toBeNull();
      expect(mockUseAddableWorkspaceMembers).toHaveBeenLastCalledWith(expect.objectContaining({ listAllWhenEmpty: false }));

      fireEvent.click(screen.getByTestId('inline-member-browse'));

      // Without typing a name: everyone who can be added, and the groups not in the space.
      expect(mockUseAddableWorkspaceMembers).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: '', listAllWhenEmpty: true })
      );
      expect(await screen.findByTestId('space-group-inline-search-result-group-engineering')).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByTestId('inline-member-search'));

      // Escape closes the list and is used up, so the dialog stays open.
      expect(fireEvent.keyDown(screen.getByTestId('inline-member-search'), { key: 'Escape' })).toBe(false);
      expect(screen.queryByTestId('space-group-inline-search-result-group-engineering')).toBeNull();
      // With the list closed, Escape is left for the dialog.
      expect(fireEvent.keyDown(screen.getByTestId('inline-member-search'), { key: 'Escape' })).toBe(true);

      fireEvent.click(screen.getByTestId('inline-member-browse'));
      expect(await screen.findByTestId('space-group-inline-search-result-group-engineering')).toBeTruthy();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByTestId('space-group-inline-search-result-group-engineering')).toBeNull();
    });

    it('says so when everyone who can be added is already in the space', async () => {
      const addable = mockUseAddableWorkspaceMembers.getMockImplementation();

      mockGetSpacePermission.mockResolvedValue(permissionResponse({ permission: customPermission }));
      mockGetWorkspaceGroups.mockResolvedValue({ groups: [] });
      mockUseAddableWorkspaceMembers.mockImplementation(() => []);
      try {
        render(<ManageSpace open onClose={jest.fn()} viewId='space-1' />);

        await waitFor(() => expect(screen.getByTestId('inline-member-search').disabled).toBe(false));
        await waitFor(() => expect(mockGetMembers).toHaveBeenCalledWith('workspace-1'));
        fireEvent.click(screen.getByTestId('inline-member-browse'));
        expect(await screen.findByText('space.permissionManager.nothingToAdd')).toBeTruthy();
      } finally {
        // clearAllMocks keeps implementations; later tests need the real filter back.
        if (addable) mockUseAddableWorkspaceMembers.mockImplementation(addable);
      }
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
      // A shared-pages row explains where that access is managed instead of pointing to General.
      expect(within(inheritedRow).getByText('space.memberOverride.sharedPagesReason')).toBeTruthy();
      expect(screen.queryByText('space.permissionManager.inheritedAccessManagedFromGeneral')).toBeNull();
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
