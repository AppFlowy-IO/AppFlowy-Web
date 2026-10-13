import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  AccessLevel,
  Role,
  SpaceInvitePolicy,
  SpaceMemberRole,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
  ViewLayout,
  WorkspaceMember,
} from '@/application/types';
import { SpaceCreationIntentStore } from '@/application/services/js-services/space-creation-intent';
import { notify } from '@/components/_shared/notify';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';

import type { KeyboardEventHandler, ReactNode } from 'react';

const mockCreateSpace = jest.fn();
const mockCreateSpaceWithInitialPage = jest.fn();
const mockGetMembers = jest.fn();
const mockGetView = jest.fn();

jest.mock('@/application/services/js-services/http/view-api', () => ({ getView: (...args: unknown[]) => mockGetView(...args) }));
const mockGetSpacePermission = jest.fn();
const mockAddSpaceMember = jest.fn();
const mockAddSpaceMemberByUuid = jest.fn();
const mockMoveToTrash = jest.fn();
const mockDeleteTrash = jest.fn();
const mockRefreshCreationPermission = jest.fn();
const mockGetSpaceCreationCapabilities = jest.fn();
let mockCanCreateSpace = true;
let mockCapabilityStatus: 'loading' | 'ready' | 'unsupported' | 'error' = 'ready';
let mockUuidIndex = 0;

jest.mock('uuid', () => ({ v4: () => ['space-id', 'page-id'][mockUuidIndex++] ?? `generated-${mockUuidIndex}` }));
jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: 'test-user' } }) }));

jest.mock('@/components/app/hooks/useSpaceCreationCapability', () => ({
  useSpaceCreationCapability: () => ({
    status: mockCapabilityStatus,
    canCreateSpace: mockCanCreateSpace,
    capability: mockCapabilityStatus === 'ready' ? { can_create_space: mockCanCreateSpace } : undefined,
    refresh: mockRefreshCreationPermission,
  }),
}));

const candidateOne: WorkspaceMember = {
  uid: 'member-1',
  name: 'Annie',
  email: 'annie@appflowy.io',
  avatar_url: '',
  role: Role.Member,
};
const candidateTwo: WorkspaceMember = {
  uid: 'member-2',
  name: 'Eva',
  email: 'eva@appflowy.io',
  avatar_url: '',
  role: Role.Member,
};

const customPermission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Custom,
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'space.defaultSpaceName' ? 'General' : key),
  }),
}));

jest.mock('@/application/services/domains', () => ({
  PageService: {
    moveToTrash: (...args: unknown[]) => mockMoveToTrash(...args),
    deleteTrash: (...args: unknown[]) => mockDeleteTrash(...args),
  },
  WorkspaceService: {
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
    getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockGetSpaceCreationCapabilities(...args),
    addSpaceMember: (...args: unknown[]) => mockAddSpaceMember(...args),
    addSpaceMemberByUuid: (...args: unknown[]) => mockAddSpaceMemberByUuid(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({
    createSpace: mockCreateSpace,
    createSpaceWithInitialPage: mockCreateSpaceWithInitialPage,
  }),
  useCurrentWorkspaceId: () => 'workspace-1',
  useUserWorkspaceInfo: () => ({
    userId: 'current-user',
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

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    children,
    open,
    onOk,
    onClose,
    title,
    okText,
    okButtonProps,
    PaperProps,
    showActions = true,
  }: {
    children: ReactNode;
    open: boolean;
    onOk?: () => void;
    onClose?: () => void;
    title: ReactNode;
    okText?: ReactNode;
    okButtonProps?: { disabled?: boolean; 'data-testid'?: string };
    PaperProps?: { 'data-testid'?: string };
    showActions?: boolean;
  }) =>
    open ? (
      <div
        data-testid={PaperProps?.['data-testid']}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onOk?.();
        }}
      >
        <div data-testid={PaperProps?.['data-testid'] === 'create-space-modal' ? 'create-space-title' : 'modal-title'}>
          {title}
        </div>
        <button
          data-testid={PaperProps?.['data-testid'] === 'create-space-modal' ? 'create-space-close' : 'modal-close'}
          onClick={onClose}
        >
          close
        </button>
        {showActions && (
          <button
            data-testid={okButtonProps?.['data-testid'] ?? 'modal-ok-button'}
            disabled={okButtonProps?.disabled}
            onClick={onOk}
          >
            {okText}
          </button>
        )}
        {children}
      </div>
    ) : null,
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: jest.fn() },
}));

jest.mock('@/components/app/share/WorkspaceMemberInlineSearch', () => ({
  getWorkspaceMemberUid: (member: WorkspaceMember) => member.uid || null,
  workspaceMemberDisplayName: (member: WorkspaceMember) => member.name || member.email,
  useAddableWorkspaceMembers: ({
    workspaceMembers,
    search,
    excludedUids,
  }: {
    workspaceMembers: WorkspaceMember[];
    search: string;
    excludedUids: Set<string>;
  }) => {
    const normalized = search.trim().toLowerCase();

    if (!normalized) return [];
    return workspaceMembers.filter(
      (member) =>
        !excludedUids.has(String(member.uid)) && `${member.name} ${member.email}`.toLowerCase().includes(normalized)
    );
  },
  WorkspaceMemberInlineSearch: ({
    search,
    onSearchChange,
    addableMembers,
    onAddMember,
    inputDisabled,
    onInputKeyDown,
  }: {
    search: string;
    onSearchChange: (value: string) => void;
    addableMembers: WorkspaceMember[];
    onAddMember: (member: WorkspaceMember) => void;
    inputDisabled?: boolean;
    onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  }) => (
    <div>
      <input
        data-testid='draft-member-search'
        value={search}
        disabled={inputDisabled}
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={onInputKeyDown}
      />
      {addableMembers.map((member) => (
        <button
          key={String(member.uid)}
          data-testid={`draft-member-add-${member.uid}`}
          onClick={() => onAddMember(member)}
        >
          add {member.name}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('@/components/app/view-actions/SpaceIconButton', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (icon: string, color: string) => void }) => (
    <button data-testid='space-icon-button' onClick={() => onChange('star', '#ffbf00')}>
      icon
    </button>
  ),
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    'data-testid': testId,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    'data-testid'?: string;
  }) => (
    <button data-testid={testId} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuItemTick: () => <span>selected</span>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/progress', () => ({
  Progress: ({ variant: _variant, ...props }: { variant?: string; role?: string; 'aria-label'?: string }) => (
    <span data-testid='progress' {...props} />
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
      ...props
    }: {
      children: ReactNode;
      onValueChange?: (value: string) => void;
      value: string;
      'data-testid'?: string;
    }) => (
      <TabsContext.Provider value={{ value, onValueChange: onValueChange ?? (() => undefined) }}>
        <div {...props}>{children}</div>
      </TabsContext.Provider>
    ),
    TabsContent: ({ children, value }: { children: ReactNode; value: string }) => {
      const tabs = React.useContext(TabsContext);

      return tabs.value === value ? <div>{children}</div> : null;
    },
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, disabled, value }: { children: ReactNode; disabled?: boolean; value: string }) => {
      const tabs = React.useContext(TabsContext);

      return (
        <button
          role='tab'
          disabled={disabled}
          aria-selected={tabs.value === value}
          onClick={() => tabs.onValueChange(value)}
        >
          {children}
        </button>
      );
    },
  };
});

describe('CreateSpaceModal draft controller', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    sessionStorage.clear();
    mockUuidIndex = 0;
    mockCanCreateSpace = true;
    mockCapabilityStatus = 'ready';
    mockGetView.mockResolvedValue({ view_id: 'page-id', parent_view_id: 'space-id' });
    mockRefreshCreationPermission.mockResolvedValue({ can_create_space: true });
    mockGetMembers.mockResolvedValue([candidateOne, candidateTwo]);
    mockGetSpacePermission.mockImplementation(async (_workspaceId: string, spaceId: string) => {
      if (spaceId === 'space-id') return { space_id: spaceId, permission: customPermission };
      throw Object.assign(new Error('Space not found'), { code: -2, httpStatus: 404 });
    });
    // Servers echo the client-owned identity of a created space.
    mockCreateSpace.mockImplementation(async (payload: { view_id: string }) => payload.view_id);
    mockCreateSpaceWithInitialPage.mockResolvedValue({
      space: { view_id: 'space-id' },
      page: { view_id: 'page-id' },
    });
    mockAddSpaceMember.mockResolvedValue(undefined);
    mockAddSpaceMemberByUuid.mockResolvedValue(undefined);
    mockMoveToTrash.mockResolvedValue(undefined);
    mockDeleteTrash.mockResolvedValue(undefined);
  });

  function visibilityOption(visibility: SpaceVisibility) {
    return screen.getByTestId(`manage-space-visibility-option-${visibility}`);
  }

  it('keeps the draft when a fresh permission read revokes creation before submit', async () => {
    mockRefreshCreationPermission.mockResolvedValue({ can_create_space: false });
    render(<CreateSpaceModal open onClose={jest.fn()} />);
    enterSpaceName('Keep this draft');
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('workspacePermissions.denied'));
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect((screen.getByTestId('space-name-input')).value).toBe('Keep this draft');
  });

  it('includes the explicitly chosen sidebar policy in the create payload', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);
    enterSpaceName('Editors can add pages');
    fireEvent.change(screen.getByTestId('space-sidebar-policy'), { target: { value: SpaceSidebarEditPolicy.MembersAndOwners } });
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(mockCreateSpace).toHaveBeenCalledWith(expect.objectContaining({
      permission: expect.objectContaining({ sidebar_edit_policy: SpaceSidebarEditPolicy.MembersAndOwners }),
    })));
  });

  it('disables new creation but leaves draft fields editable after a live revocation', () => {
    const { rerender } = render(<CreateSpaceModal open onClose={jest.fn()} />);

    enterSpaceName('Keep this draft');
    mockCanCreateSpace = false;
    rerender(<CreateSpaceModal open onClose={jest.fn()} />);
    expect((screen.getByTestId('create-space-submit')).disabled).toBe(true);
    expect((screen.getByTestId('space-name-input')).value).toBe('Keep this draft');
    expect(screen.getByText('workspacePermissions.denied')).toBeTruthy();
  });

  function enterSpaceName(name = 'General') {
    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: name } });
  }

  async function selectCustomAndAdd(member: WorkspaceMember) {
    enterSpaceName();
    fireEvent.click(visibilityOption(SpaceVisibility.Custom));
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledWith('workspace-1'));
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    fireEvent.change(screen.getByTestId('draft-member-search'), { target: { value: member.email } });
    fireEvent.click(await screen.findByTestId(`draft-member-add-${member.uid}`));
  }

  it('renders the shared Create Space panel and a deferred Create action', () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    expect(screen.getByTestId('create-space-modal')).toBeTruthy();
    expect(screen.getByTestId('space-settings-panel')).toBeTruthy();
    expect(screen.getByTestId('create-space-title').textContent).toBe('space.createSpace');
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.create');
    expect(screen.getByTestId('space-name-input').value).toBe('');
    expect(screen.getByTestId('create-space-submit').getAttribute('disabled')).not.toBeNull();
    expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }).getAttribute('disabled')).toBeNull();
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });

  it('keeps name, icon, access, type and member edits local until Create', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Launch plans' } });
    fireEvent.click(screen.getByTestId('space-icon-button'));
    fireEvent.click(visibilityOption(SpaceVisibility.Custom));
    fireEvent.click(screen.getByTestId(`manage-space-custom-members-access-option-${AccessLevel.ReadOnly}`));
    fireEvent.click(screen.getByTestId('manage-space-everyone-else-access-option-none'));
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    fireEvent.change(screen.getByTestId('draft-member-search'), { target: { value: 'annie' } });
    fireEvent.click(await screen.findByTestId('draft-member-add-member-1'));

    expect(screen.getByTestId('create-space-draft-member-member-1')).toBeTruthy();
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.generalTab' }));
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() =>
      expect(mockCreateSpace).toHaveBeenCalledWith({
        name: 'Launch plans',
        space_icon: 'star',
        space_icon_color: '#ffbf00',
        view_id: expect.any(String),
        client_generated_view_id: true,
        permission: {
          ...customPermission,
          member_default_access_level: AccessLevel.ReadOnly,
          everyone_else_access_level: null,
        },
      })
    );
    await waitFor(() =>
      expect(mockAddSpaceMember).toHaveBeenCalledWith('workspace-1', 'space-id', {
        uid: 'member-1',
        role: SpaceMemberRole.Member,
        access_level: AccessLevel.ReadOnly,
      })
    );
    expect(mockCreateSpace.mock.invocationCallOrder[0]).toBeLessThan(mockAddSpaceMember.mock.invocationCallOrder[0]);
  });

  it('does not submit Create when Enter is pressed in the draft member search', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.click(visibilityOption(SpaceVisibility.Custom));
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledWith('workspace-1'));
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    const search = screen.getByTestId('draft-member-search');

    fireEvent.change(search, { target: { value: candidateOne.email } });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });

    expect(screen.getByTestId('create-space-modal')).toBeTruthy();
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });

  it.each([SpaceVisibility.Public, SpaceVisibility.Private])(
    'does not apply queued explicit members when the final type is %s',
    async (visibility) => {
      render(<CreateSpaceModal open onClose={jest.fn()} />);

      await selectCustomAndAdd(candidateOne);
      fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.generalTab' }));
      fireEvent.click(visibilityOption(visibility));
      fireEvent.click(screen.getByTestId('create-space-submit'));

      await waitFor(() => expect(mockCreateSpace).toHaveBeenCalledTimes(1));
      expect(mockCreateSpace).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: expect.objectContaining({ visibility }),
        })
      );
      expect(mockAddSpaceMember).not.toHaveBeenCalled();
    }
  );

  it('renders a Private owner-only card and locked current-user roster without draft writes', () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.click(visibilityOption(SpaceVisibility.Private));
    expect(screen.getByTestId('manage-space-private-access-card').textContent).toContain(
      'space.permissionManager.privateAccessTitle'
    );
    expect(screen.getByTestId('manage-space-private-access-card').textContent).toContain(
      'space.permissionManager.privateOwnerDescription'
    );
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    expect(screen.getByTestId('private-space-members-info').textContent).toBe(
      'space.permissionManager.privateMembersDescription'
    );
    const ownerRow = screen.getByTestId('private-space-owner-row');

    expect(ownerRow.textContent).toContain('Nathan');
    expect(ownerRow.textContent).toContain('space.permissionManager.workspaceOwner');
    expect(screen.getByTestId('private-space-owner-locked-role').textContent).toBe('space.permissionManager.owner');
    expect(within(ownerRow).queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('draft-member-search')).toBeNull();
    expect(screen.queryByTestId('draft-add-member')).toBeNull();
    expect(mockGetMembers).not.toHaveBeenCalled();
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });

  it('uses the initial-page API only after Create and returns both committed IDs', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const initialPage = { layout: ViewLayout.Document, name: 'First page' };

    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} initialPage={initialPage} />);

    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() =>
      expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledWith({
        name: 'General',
        space_icon: '',
        space_icon_color: '',
        view_id: expect.any(String),
        client_generated_view_id: true,
        permission: {
          ...customPermission,
          visibility: SpaceVisibility.Public,
          everyone_else_access_level: null,
        },
        initial_page: { ...initialPage, view_id: expect.any(String) },
      })
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', 'page-id'));
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reopens with an empty fresh draft after creating a space from a persistent host', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const initialPage = { layout: ViewLayout.Document };
    const { rerender } = render(
      <CreateSpaceModal open onClose={onClose} onCreated={onCreated} initialPage={initialPage} />
    );

    enterSpaceName('Previously created space');
    fireEvent.click(visibilityOption(SpaceVisibility.Private));
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', 'page-id'));

    rerender(<CreateSpaceModal open={false} onClose={onClose} onCreated={onCreated} initialPage={initialPage} />);
    rerender(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} initialPage={initialPage} />);

    expect(screen.getByTestId('space-name-input').value).toBe('');
    expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('create-space-submit').getAttribute('disabled')).not.toBeNull();
    expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledTimes(1);
  });

  it('preserves an edited Public access level in the structured creation payload', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    enterSpaceName();
    fireEvent.click(screen.getByTestId(`manage-space-workspace-members-access-option-${AccessLevel.ReadOnly}`));
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() =>
      expect(mockCreateSpace).toHaveBeenCalledWith({
        name: 'General',
        space_icon: '',
        space_icon_color: '',
        view_id: expect.any(String),
        client_generated_view_id: true,
        permission: {
          ...customPermission,
          visibility: SpaceVisibility.Public,
          member_default_access_level: AccessLevel.ReadOnly,
          everyone_else_access_level: null,
        },
      })
    );
  });

  it('guards duplicate Create clicks while the request is in flight', async () => {
    const creation = deferred<string>();

    mockCreateSpace.mockReturnValue(creation.promise);
    render(<CreateSpaceModal open onClose={jest.fn()} />);
    enterSpaceName();
    const submit = screen.getByTestId('create-space-submit');

    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(mockCreateSpace).toHaveBeenCalledTimes(1));

    creation.resolve('space-id');
    await waitFor(() => expect(submit.getAttribute('disabled')).not.toBeNull());
    expect(screen.getByTestId('space-name-input').value).toBe('');
  });

  it('shows an in-panel loading indicator while creation is in flight', async () => {
    const creation = deferred<string>();

    mockCreateSpace.mockReturnValue(creation.promise);
    render(<CreateSpaceModal open onClose={jest.fn()} />);
    enterSpaceName();

    fireEvent.click(screen.getByTestId('create-space-submit'));

    const panel = screen.getByTestId('space-settings-panel');
    const loadingIndicator = within(screen.getByTestId('create-space-modal')).getByTestId(
      'create-space-loading-indicator'
    );

    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(within(loadingIndicator).getByRole('status').getAttribute('aria-label')).toBe('loading');

    creation.resolve('space-id');
    await waitFor(() => expect(screen.queryByTestId('create-space-loading-indicator')).toBeNull());
  });

  it('keeps an ambiguous create draft open, frozen, and checks again with the same client-owned ID', async () => {
    mockCreateSpace.mockRejectedValueOnce(new Error('could not create space'));
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('could not create space'));
    expect(screen.getByTestId('create-space-modal')).toBeTruthy();
    expect(screen.getByTestId('space-name-input').value).toBe('Keep this draft');
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('spaceCreation.checkAgain');
    expect(screen.getByTestId('space-creation-recovery-unconfirmed').textContent).toContain('spaceCreation.unconfirmed');
    expect(screen.getByTestId('space-creation-discard')).toBeTruthy();
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);

    const firstAttemptId = mockCreateSpace.mock.calls[0][0].view_id;

    mockGetSpacePermission.mockRejectedValueOnce({ httpStatus: 404 });
    mockCreateSpace.mockResolvedValueOnce(firstAttemptId);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(mockCreateSpace).toHaveBeenCalledTimes(2));
    expect(mockCreateSpace.mock.calls[1][0].view_id).toBe(firstAttemptId);
  });

  it.each([
    ['a validation rejection', { code: 422, httpStatus: 422, message: 'invalid space name' }, 'invalid space name'],
    ['a B denial that lands after the pre-check', { code: 1012, httpStatus: 403, message: 'forbidden' }, 'forbidden'],
  ])('releases the draft for editing after %s and forgets the saved request', async (_case, rejection, message) => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(rejection);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Rejected draft' } });
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(message));
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('space-name-input').value).toBe('Rejected draft');
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.create');
    expect(screen.queryByTestId('space-creation-recovery-unconfirmed')).toBeNull();
    expect(sessionStorage.length).toBe(0);

    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Fixed name' } });
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreateSpace).toHaveBeenCalledTimes(2);
    expect(mockCreateSpace.mock.calls[1][0].name).toBe('Fixed name');
    // The rejected identity is never reused for an edited request.
    expect(mockCreateSpace.mock.calls[1][0].view_id).not.toBe(mockCreateSpace.mock.calls[0][0].view_id);
    expect(onCreated).toHaveBeenCalledWith(mockCreateSpace.mock.calls[1][0].view_id, undefined);
    expect(mockGetSpacePermission).not.toHaveBeenCalled();
    expect(mockMoveToTrash).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('releases a definitively rejected first-page request and keeps its page payload with a fresh identity', async () => {
    const onCreated = jest.fn();

    mockCreateSpaceWithInitialPage
      .mockRejectedValueOnce({ code: 1008, httpStatus: 400, message: 'invalid page' })
      .mockImplementationOnce(async (payload: { view_id: string; initial_page: { view_id: string } }) => ({
        space: { view_id: payload.view_id },
        page: { view_id: payload.initial_page.view_id },
      }));
    render(<CreateSpaceModal open onClose={jest.fn()} onCreated={onCreated}
      initialPage={{ layout: ViewLayout.Document, name: 'First page' }} />);

    enterSpaceName('With a page');
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('invalid page'));
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const [first, second] = mockCreateSpaceWithInitialPage.mock.calls.map(([payload]) => payload);

    expect(second.initial_page).toEqual({ layout: ViewLayout.Document, name: 'First page', view_id: expect.any(String) });
    expect(second.view_id).not.toBe(first.view_id);
    expect(second.initial_page.view_id).not.toBe(first.initial_page.view_id);
  });

  it('keeps an unconfirmed request after closing and forgets it only after Discard is confirmed', async () => {
    const onClose = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    const first = render(<CreateSpaceModal open onClose={onClose} />);

    enterSpaceName('Maybe created');
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    fireEvent.click(screen.getByTestId('create-space-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(1);
    first.unmount();

    render(<CreateSpaceModal open onClose={onClose} />);
    expect(screen.getByTestId('space-name-input').value).toBe('Maybe created');
    fireEvent.click(screen.getByTestId('space-creation-discard'));
    expect(screen.getByTestId('modal-title').textContent).toBe('spaceCreation.discardTitle');
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(sessionStorage.length).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('space-creation-discard'));
    fireEvent.click(screen.getByTestId('discard-space-request-confirm'));
    expect(sessionStorage.length).toBe(0);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(mockGetSpacePermission).not.toHaveBeenCalled();
  });

  it('shows unreadable saved data with Discard and continues with a fresh draft once it is discarded', () => {
    const key = `space-creation:v1:${new SpaceCreationIntentStore('workspace-1').scopeKey}`;

    sessionStorage.setItem(key, '{invalid');
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    expect(screen.getByTestId('space-creation-recovery-invalid').textContent).toContain('spaceCreation.invalidRecovery');
    enterSpaceName('New space');
    expect(screen.getByTestId('create-space-submit').getAttribute('disabled')).not.toBeNull();
    fireEvent.click(screen.getByTestId('space-creation-discard'));
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(screen.queryByTestId('space-creation-recovery-invalid')).toBeNull();
    expect(screen.getByTestId('create-space-submit').getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.create');
  });

  it('lets a server without the capability route decide instead of disabling creation', async () => {
    const onCreated = jest.fn();

    mockCapabilityStatus = 'unsupported';
    mockCanCreateSpace = false;
    mockRefreshCreationPermission.mockResolvedValue(undefined);
    mockGetSpaceCreationCapabilities.mockRejectedValue({ code: 404, httpStatus: 404, message: 'Not Found' });
    render(<CreateSpaceModal open onClose={jest.fn()} onCreated={onCreated} />);

    expect(screen.queryByTestId('space-creation-notice')).toBeNull();
    enterSpaceName('Legacy server space');
    expect(screen.getByTestId('create-space-submit').getAttribute('disabled')).toBeNull();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', undefined));
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
  });

  it('does not send when the permission check fails for another reason', async () => {
    mockRefreshCreationPermission.mockResolvedValue(undefined);
    mockGetSpaceCreationCapabilities.mockRejectedValue({ code: -1, message: 'Network error' });
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    enterSpaceName('Offline draft');
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('workspacePermissions.loadError'));
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).toBeNull();
  });

  it('shows why creation is unavailable with a retry when permissions cannot be loaded', () => {
    mockCapabilityStatus = 'error';
    mockCanCreateSpace = false;
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    expect(screen.getByTestId('space-creation-notice').textContent).toContain('workspacePermissions.loadError');
    fireEvent.click(within(screen.getByTestId('space-creation-notice')).getByRole('button'));
    expect(mockRefreshCreationPermission).toHaveBeenCalledTimes(1);
  });

  it('hands off a committed standalone space and its queued roster when Retry reconciles a lost response', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    mockGetSpacePermission.mockResolvedValue({ permission: customPermission });
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(clientOwnedSpaceId, undefined));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId);
    expect(mockAddSpaceMember).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId, {
      uid: 'member-1',
      role: SpaceMemberRole.Member,
      access_level: AccessLevel.ReadAndWrite,
    });
    expect(mockAddSpaceMember.mock.invocationCallOrder[0]).toBeLessThan(onCreated.mock.invocationCallOrder[0]);
    expect(mockMoveToTrash).not.toHaveBeenCalled();
    expect(mockDeleteTrash).not.toHaveBeenCalled();
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
  });

  it('reloads a submitted identity while B denies, then recovers the original held commit without another POST', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const commit = deferred<void>();
    let persistedSpaceId: string | undefined;
    let serverWrite!: Promise<void>;

    mockCreateSpace.mockImplementationOnce(async (payload) => {
      expect(sessionStorage.length).toBe(1);
      serverWrite = commit.promise.then(() => { persistedSpaceId = payload.view_id; });
      throw new Error('client timed out before commit');
    });
    mockGetSpacePermission.mockImplementation(async () => {
      if (!persistedSpaceId) throw Object.assign(new Error('not committed yet'), { httpStatus: 404 });
      return { space_id: persistedSpaceId, permission: customPermission };
    });
    const first = render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    enterSpaceName('Original submitted name');
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('client timed out before commit'));
    const originalId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    first.unmount();
    mockCanCreateSpace = false;
    mockRefreshCreationPermission.mockResolvedValue({ can_create_space: false });
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);
    expect(screen.getByTestId('space-name-input').value).toBe('Original submitted name');
    expect(screen.getByTestId('space-name-input').disabled).toBe(true);
    expect(screen.getByTestId('create-space-submit').disabled).toBe(false);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('workspacePermissions.denied'));
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', originalId);
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(1);
    commit.resolve();
    await serverWrite;
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(originalId, undefined));
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
    expect(mockMoveToTrash).not.toHaveBeenCalled();
    expect(mockDeleteTrash).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', new Error('reconcile unavailable'), 'reconcile unavailable'],
    ['a 403', { httpStatus: 403, message: 'forbidden' }, 'forbidden'],
    ['a transient 503', { httpStatus: 503, message: 'service unavailable' }, 'service unavailable'],
  ])('preserves the frozen standalone draft when reconciliation returns %s', async (_case, error, message) => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    mockGetSpacePermission.mockRejectedValueOnce(error);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(message));
    expect(onClose).not.toHaveBeenCalled();
    expect(mockMoveToTrash).not.toHaveBeenCalled();
    expect(mockDeleteTrash).not.toHaveBeenCalled();
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).not.toBeNull();

    mockGetSpacePermission.mockRejectedValueOnce({ httpStatus: 404 });
    mockCreateSpace.mockResolvedValueOnce(clientOwnedSpaceId);
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(clientOwnedSpaceId, undefined));
    expect(mockCreateSpace).toHaveBeenCalledTimes(2);
    expect(mockCreateSpace.mock.calls[1][0].view_id).toBe(clientOwnedSpaceId);
  });

  it('restores the original initial page and frozen roster after reload despite a different host draft', async () => {
    mockCreateSpaceWithInitialPage.mockRejectedValueOnce(new Error('response lost'));
    const first = render(<CreateSpaceModal open onClose={jest.fn()}
      initialPage={{ layout: ViewLayout.Document, name: 'Original page' }} />);

    enterSpaceName('Original space');
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    first.unmount();
    const onCreated = jest.fn();

    mockCanCreateSpace = false;
    mockRefreshCreationPermission.mockResolvedValue({ can_create_space: false });
    render(<CreateSpaceModal open onClose={jest.fn()} onCreated={onCreated}
      initialPage={{ layout: ViewLayout.Grid, name: 'Different host page' }} />);
    expect(screen.getByTestId('space-name-input').value).toBe('Original space');
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', 'page-id'));
    expect(mockGetView).toHaveBeenCalledWith('workspace-1', 'page-id', 0);
    expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });

  it('releases a checked-again request after a definitive rejection and never reuses its identity', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const definitiveRetryRejection = { httpStatus: 422, message: 'validation rejected' };

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost')).mockRejectedValueOnce(definitiveRetryRejection);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    expect(screen.getByTestId('draft-member-search').getAttribute('disabled')).not.toBeNull();
    mockGetSpacePermission.mockRejectedValueOnce({ httpStatus: 404 });
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('validation rejected'));
    expect(mockCreateSpace.mock.calls[1][0].view_id).toBe(clientOwnedSpaceId);
    // The identical request was refused, so the draft is editable again instead of frozen.
    expect(screen.getByTestId('draft-member-search').getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('create-space-draft-member-member-1')).toBeTruthy();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.create');
    expect(sessionStorage.length).toBe(0);

    mockGetSpacePermission.mockResolvedValue({ permission: customPermission });
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const nextSpaceId = mockCreateSpace.mock.calls[2][0].view_id;

    expect(nextSpaceId).not.toBe(clientOwnedSpaceId);
    expect(onCreated).toHaveBeenCalledWith(nextSpaceId, undefined);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember).toHaveBeenCalledWith('workspace-1', nextSpaceId, {
      uid: 'member-1',
      role: SpaceMemberRole.Member,
      access_level: AccessLevel.ReadAndWrite,
    });
    expect(mockCreateSpace).toHaveBeenCalledTimes(3);
  });

  it('keeps Close usable when the remaining people still cannot be added, leaving the request resumable', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockAddSpaceMember.mockRejectedValue(new Error('member add unavailable'));
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add unavailable'));
    expect(screen.getByTestId('space-creation-recovery-membersPending').textContent).toContain('spaceCreation.membersPending');
    expect(screen.getByTestId('create-space-submit').textContent).toBe('spaceCreation.tryAgain');

    fireEvent.click(screen.getByTestId('create-space-close'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockAddSpaceMember).toHaveBeenCalledTimes(2);
    expect(onCreated).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(1);
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
  });

  it('finishes without the remaining people when Add later is chosen', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockAddSpaceMember.mockRejectedValue(new Error('member add unavailable'));
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add unavailable'));
    fireEvent.click(screen.getByTestId('space-creation-add-later'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', undefined));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
    expect(mockAddSpaceMember).toHaveBeenCalledTimes(1);
  });

  it('restores a committed request with its remaining people instead of creating it again', async () => {
    const onCreated = jest.fn();

    mockAddSpaceMember.mockRejectedValueOnce(new Error('member add unavailable'));
    const first = render(<CreateSpaceModal open onClose={jest.fn()} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add unavailable'));
    first.unmount();

    render(<CreateSpaceModal open onClose={jest.fn()} onCreated={onCreated} />);
    expect(screen.getByTestId('space-creation-recovery-membersPending')).toBeTruthy();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', undefined));
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember).toHaveBeenCalledTimes(2);
    expect(sessionStorage.length).toBe(0);
  });

  it('does not let repeated Close bypass a pending roster after standalone reconciliation', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    mockGetSpacePermission.mockResolvedValue({ permission: customPermission });
    mockAddSpaceMember.mockRejectedValueOnce(new Error('member add unavailable')).mockResolvedValueOnce(undefined);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add unavailable'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockMoveToTrash).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(clientOwnedSpaceId, undefined));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember).toHaveBeenCalledTimes(2);
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
  });

  it('retries a pending post-create roster on Close without recreating the committed space', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockAddSpaceMember.mockRejectedValueOnce(new Error('member add unavailable')).mockResolvedValueOnce(undefined);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add unavailable'));
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', undefined));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember).toHaveBeenCalledTimes(2);
  });

  it('retries only pending member adds after creation has committed', async () => {
    const onCreated = jest.fn();

    mockAddSpaceMember.mockImplementation((_workspaceId: string, _spaceId: string, payload: { uid: string }) =>
      payload.uid === 'member-2' &&
      mockAddSpaceMember.mock.calls.filter((call) => call[2].uid === 'member-2').length === 1
        ? Promise.reject(new Error('member add failed'))
        : Promise.resolve()
    );
    render(<CreateSpaceModal open onClose={jest.fn()} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.change(screen.getByTestId('draft-member-search'), { target: { value: 'eva' } });
    fireEvent.click(await screen.findByTestId('draft-member-add-member-2'));
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.generalTab' }));
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add failed'));
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('create-space-submit').textContent).toBe('spaceCreation.tryAgain');
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).not.toBeNull();

    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', undefined));
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember.mock.calls.filter((call) => call[2].uid === 'member-1')).toHaveLength(1);
    expect(mockAddSpaceMember.mock.calls.filter((call) => call[2].uid === 'member-2')).toHaveLength(2);
  });

  it('new Custom assignments use exact UUIDs and inherit instead of freezing the collective default', async () => {
    const userUuid = '12345678-1234-4123-8123-123456789abc';
    const candidate = { ...candidateOne, user_uuid: userUuid };
    const onCreated = jest.fn();

    mockGetMembers.mockResolvedValue([candidate]);
    mockGetSpacePermission.mockResolvedValue({ permission: customPermission, member_access_overrides_supported: true });
    render(<CreateSpaceModal open onClose={jest.fn()} onCreated={onCreated} />);
    await selectCustomAndAdd(candidate);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mockAddSpaceMemberByUuid).toHaveBeenCalledWith('workspace-1', 'space-id', userUuid, { role: SpaceMemberRole.Member });
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });

  it('keeps a committed roster draft when a supported server omits the exact member identity', async () => {
    const onCreated = jest.fn();

    mockGetSpacePermission.mockResolvedValue({ permission: customPermission, member_access_overrides_supported: true });
    render(<CreateSpaceModal open onClose={jest.fn()} onCreated={onCreated} />);
    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('space.memberOverride.identityUnavailable'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
    expect(mockAddSpaceMemberByUuid).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('spaceCreation.tryAgain');
  });

  it('cancels a draft without any mutation request', () => {
    const onClose = jest.fn();

    render(<CreateSpaceModal open onClose={onClose} />);
    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Discard me' } });
    fireEvent.click(visibilityOption(SpaceVisibility.Private));
    fireEvent.click(screen.getByTestId('create-space-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });
});
